"""Offline CUDA ASR, owned by the Node parent's stdin. No listening port."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import time
import wave

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
WIRE = sys.stdout
sys.stdout = sys.stderr


def emit(value):
    WIRE.write(json.dumps(value, ensure_ascii=True) + '\n')
    WIRE.flush()


def main():
    import numpy as np
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    torch.set_num_threads(6)
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable')
    root = Path(os.environ.get('NEXUS_ASR_ROOT', str(Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'asr' / 'whisper-large-v3-turbo')))
    processor = WhisperProcessor.from_pretrained(root, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(root, local_files_only=True,
        torch_dtype=torch.float16, attn_implementation='sdpa').to('cuda').eval()
    lang_ids = [processor.tokenizer.convert_tokens_to_ids('<|'+lang+'|>') for lang in ('es', 'en')]

    @torch.inference_mode()
    def recognize(samples, prior=None, forced=None):
        features = processor.feature_extractor(samples, sampling_rate=16000, return_tensors='pt').input_features.to('cuda', dtype=torch.float16)
        encoded = model.model.encoder(features)
        decoder = torch.tensor([[model.config.decoder_start_token_id]], device='cuda')
        logits = model(encoder_outputs=encoded, decoder_input_ids=decoder).logits[0, -1].float()
        # Only these two language tokens participate in the argmax, never the
        # 99-language winner followed by a text heuristic.
        probs = logits[lang_ids].softmax(-1).tolist()
        winner = int(probs[1] > probs[0])
        detected = ('es', 'en')[winner]
        confidence = probs[winner]
        lang = forced if forced in ('es', 'en') else prior if prior in ('es', 'en') and confidence < .8 else detected
        tokens = model.generate(input_features=features, encoder_outputs=encoded, language=lang,
            task='transcribe', return_timestamps=False, do_sample=False, num_beams=1,
            max_new_tokens=220, condition_on_prev_tokens=False)
        text = processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
        return dict(text=text, language=detected, decodingLanguage=lang, confidence=confidence,
                    probabilities=dict(zip(('es','en'), probs)))

    recognize(np.zeros(16000 * 3, dtype=np.float32), forced='en')
    emit(dict(ready=True, backend='whisper-large-v3-turbo', device=torch.cuda.get_device_name()))
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            started = time.perf_counter()
            with wave.open(io.BytesIO(base64.b64decode(request['wav'], validate=True)), 'rb') as wav:
                if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                    raise ValueError('Expected 16 kHz mono PCM')
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
            if not 0 < len(samples) <= 16000 * 120:
                raise ValueError('Invalid duration')
            if float(np.max(np.abs(samples))) < .0001:
                emit(dict(id=request['id'], text='', language=request.get('prior') or 'en', confidence=0,
                          durationSeconds=len(samples)/16000, elapsedMs=0, backend='whisper-large-v3-turbo'))
                continue
            parts = [recognize(samples[i:i+320000], request.get('prior'), request.get('forced')) for i in range(0,len(samples),320000)]
            result = dict(parts[0])
            if len(parts) > 1:
                probability = sum(p['probabilities']['es'] for p in parts) / len(parts)
                result.update(language='es' if probability >= .5 else 'en', confidence=max(probability,1-probability), probabilities={'es':probability,'en':1-probability})
            result.update(text=' '.join(p['text'] for p in parts), id=request['id'], durationSeconds=len(samples)/16000,
                          elapsedMs=round((time.perf_counter()-started)*1000), backend='whisper-large-v3-turbo')
            emit(result)
        except Exception as error:
            emit(dict(id=request.get('id'), error=type(error).__name__))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(dict(error=type(error).__name__))
        sys.exit(1)
