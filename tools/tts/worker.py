"""Persistent engine worker. Only the parent service can supply catalog voices."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import time
import wave

ROOT = Path(os.environ['NEXUS_TTS_ROOT'])
os.environ.update(HF_HOME=str(ROOT / 'hf'), HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                  HF_HUB_DISABLE_TELEMETRY='1', NUMBA_CACHE_DIR=str(ROOT / 'numba'),
                  XDG_CACHE_HOME=str(ROOT / 'cache'), TORCH_HOME=str(ROOT / 'torch'),
                  PKUSEG_HOME=str(ROOT / 'pkuseg'))
CATALOG = json.loads(Path(__file__).with_name('catalog.json').read_text(encoding='utf-8'))
VOICES = {v['id']: v for v in CATALOG['voices']}
WIRE = sys.stdout
sys.stdout = sys.stderr  # Third-party prints must never corrupt framed audio.


def emit(value):
    WIRE.write(json.dumps(value, ensure_ascii=True) + '\n')
    WIRE.flush()


class Engine:
    def __init__(self, engine):
        self.engine = engine
        self.pipelines = {}
        self.model = None
        self.device = 'CPU' if engine == 'piper' else 'CUDA'
        if engine != 'piper':
            import torch
            torch.set_num_threads(6)
            if not torch.cuda.is_available():
                raise RuntimeError('CUDA is unavailable; use a light Piper voice.')
            self.torch = torch
        if engine == 'kokoro':
            import espeakng_loader
            from phonemizer.backend.espeak.wrapper import EspeakWrapper
            EspeakWrapper.set_library(espeakng_loader.get_library_path())
            os.environ['ESPEAK_DATA_PATH'] = espeakng_loader.get_data_path()
            from kokoro import KModel
            folder = ROOT / 'models' / 'kokoro'
            self.model = KModel(config=str(folder / 'config.json'), model=str(folder / 'kokoro-v1_0.pth')).to('cuda').eval()
        elif engine == 'qwen':
            from qwen_tts import Qwen3TTSModel
            self.model = Qwen3TTSModel.from_pretrained(str(ROOT / 'models' / 'qwen'),
                device_map='cuda:0', dtype=self.torch.bfloat16, attn_implementation='sdpa')
        elif engine == 'chatterbox':
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            self.model = ChatterboxMultilingualTTS.from_local(ROOT / 'models' / 'chatterbox', 'cuda', t3_model='v3')
        elif engine != 'piper':
            raise ValueError('Unknown engine')

    def prepare(self, voice):
        if voice['id'] in self.pipelines:
            return
        if self.engine == 'kokoro':
            from kokoro import KPipeline
            lang = 'a' if voice['lang'] == 'en' else 'e'
            if lang not in self.pipelines:
                self.pipelines[lang] = KPipeline(lang_code=lang, model=self.model, repo_id='hexgrad/Kokoro-82M')
            self.pipelines[voice['id']] = self.pipelines[lang]
        elif self.engine == 'piper':
            from piper import PiperVoice
            from piper.config import PiperConfig
            import onnxruntime as ort
            model_path = ROOT / 'models' / 'piper' / (voice['speaker'] + '.onnx')
            options = ort.SessionOptions()
            options.intra_op_num_threads = 6
            options.inter_op_num_threads = 1
            options.add_session_config_entry('session.intra_op.allow_spinning', '0')
            config = PiperConfig.from_dict(json.loads(Path(str(model_path) + '.json').read_text(encoding='utf-8')))
            providers = ['CPUExecutionProvider']
            if 'CUDAExecutionProvider' in ort.get_available_providers():
                ort.preload_dlls(directory=str(ROOT / 'neural' / 'Lib' / 'site-packages' / 'torch' / 'lib'))
                providers.insert(0, ('CUDAExecutionProvider', {'cudnn_conv_algo_search': 'HEURISTIC',
                    'cudnn_conv_use_max_workspace': '0', 'arena_extend_strategy': 'kSameAsRequested'}))
            self.pipelines[voice['id']] = PiperVoice(config=config,
                session=ort.InferenceSession(str(model_path), sess_options=options, providers=providers),
                download_dir=ROOT / 'models' / 'piper')
            self.device = 'CUDA + CPU' if 'CUDAExecutionProvider' in self.pipelines[voice['id']].session.get_providers() else 'CPU'

    def synthesize(self, voice, text):
        self.prepare(voice)
        if self.engine == 'piper':
            for chunk in self.pipelines[voice['id']].synthesize(text):
                yield chunk.audio_float_array, chunk.sample_rate
        else:
            with self.torch.inference_mode():
                if self.engine == 'kokoro':
                    speaker = str(ROOT / 'models' / 'kokoro' / 'voices' / (voice['speaker'] + '.pt'))
                    for result in self.pipelines[voice['id']](text, voice=speaker):
                        yield result.audio.detach().cpu().numpy(), 24000
                elif self.engine == 'qwen':
                    self.torch.manual_seed(voice['seed'])
                    waves, rate = self.model.generate_voice_design(text=text,
                        language='English' if voice['lang'] == 'en' else 'Spanish',
                        instruct=voice['prompt'], max_new_tokens=1024)
                    yield waves[0], rate
                else:
                    self.torch.manual_seed(46)
                    # Only the publisher's built-in conditionals. No reference file input.
                    audio = self.model.generate(text, language_id=voice['lang'],
                        exaggeration=voice['exaggeration'], cfg_weight=0.5)
                    yield audio.squeeze(0).detach().cpu().numpy(), self.model.sr


def wav_bytes(samples, rate):
    import numpy as np
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return out.getvalue()


def main():
    model = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            voice = VOICES[request['voice']]
            if voice['engine'] != sys.argv[1]:
                raise ValueError('Wrong engine')
            started = time.perf_counter()
            if model is None:
                model = Engine(voice['engine'])
            model.prepare(voice)
            if request.get('warm'):
                # Warm inference as well as model load: CUDA kernels are lazy.
                for _ in model.synthesize(voice, 'Hello.' if voice['lang'] == 'en' else 'Hola.'):
                    pass
                emit({'type': 'done', 'loadMs': (time.perf_counter() - started) * 1000})
                continue
            first = None
            duration = 0
            for samples, rate in model.synthesize(voice, request['text']):
                elapsed = (time.perf_counter() - started) * 1000
                if first is None:
                    first = elapsed
                duration += len(samples) / rate
                emit({'type': 'audio', 'audio': base64.b64encode(wav_bytes(samples, rate)).decode('ascii'),
                      'mime': 'audio/wav', 'sampleRate': rate, 'ttsMs': elapsed})
            total = (time.perf_counter() - started) * 1000
            emit({'type': 'done', 'ttfaMs': first, 'totalMs': total, 'audioSeconds': duration,
                  'rtf': total / 1000 / duration if duration else None, 'device': model.device})
        except Exception as error:
            import traceback
            traceback.print_exc()
            emit({'type': 'error', 'error': type(error).__name__ + ': ' + str(error)})


if __name__ == '__main__':
    main()
