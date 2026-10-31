"""Generate the fixed audition set and measure real engine inference locally."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

ROOT = Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'tts'
CATALOG = json.loads(Path(__file__).with_name('catalog.json').read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('engine', choices=['kokoro', 'qwen', 'chatterbox', 'piper'])
    parser.add_argument('--gpu', action='store_true', help='Evaluate Piper with ONNX CUDA')
    parser.add_argument('--language', choices=['es','en'], help='Regenerate only one language')
    args = parser.parse_args()
    runtime = 'neural' if args.engine in ['kokoro', 'qwen'] else args.engine
    if args.engine == 'piper' and args.gpu:
        runtime = 'piper-gpu'
    dest = ROOT / 'samples'
    dest.mkdir(exist_ok=True)
    log = (ROOT / (args.engine + '-samples.log')).open('w', encoding='utf-8')
    started = time.perf_counter()
    p = subprocess.Popen([str(ROOT / runtime / 'Scripts' / 'python.exe'), '-u',
        str(Path(__file__).with_name('worker.py')), args.engine], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=log, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW,
        env={**os.environ, 'NEXUS_TTS_ROOT': str(ROOT), 'PYTHONIOENCODING': 'utf-8'})
    measurements = ROOT / ((runtime if args.gpu else args.engine) + '-benchmarks.json')
    results = json.loads(measurements.read_text(encoding='utf-8')) if measurements.exists() else {}

    def request(data):
        p.stdin.write(json.dumps(data) + '\n')
        p.stdin.flush()
        out = []
        while True:
            line = p.stdout.readline()
            if not line:
                raise RuntimeError('Worker stopped; see ' + log.name)
            msg = json.loads(line)
            if msg['type'] == 'error':
                raise RuntimeError(msg['error'])
            out.append(msg)
            if msg['type'] == 'done':
                return out

    try:
        for voice in [v for v in CATALOG['voices'] if v['engine'] == args.engine]:
            if args.language and voice['lang'] != args.language:
                continue
            print('Warming ' + voice['id'], flush=True)
            cold = time.perf_counter()
            request({'voice': voice['id'], 'warm': True})
            result = {'warmupMs': (time.perf_counter() - cold) * 1000, 'samples': []}
            for i, text in enumerate(CATALOG['phrases'][voice['lang']]):
                messages = request({'voice': voice['id'], 'text': text})
                # Fixed phrases fit one chunk for all candidates; merge valid WAVs if split.
                import io
                import wave
                chunks = [base64.b64decode(m['audio']) for m in messages if m['type'] == 'audio']
                pcm = []
                for chunk in chunks:
                    with wave.open(io.BytesIO(chunk), 'rb') as wav:
                        params = wav.getparams()
                        pcm.append(wav.readframes(wav.getnframes()))
                folder = dest / CATALOG['spanishSampleSet'] if voice['lang'] == 'es' else dest
                folder.mkdir(parents=True, exist_ok=True)
                file = folder / (voice['id'] + '-' + str(i) + '.wav')
                with wave.open(str(file), 'wb') as wav:
                    wav.setparams(params)
                    wav.writeframes(b''.join(pcm))
                measured = {**messages[-1], 'index': i, 'text': text,
                    'file': file.relative_to(dest).as_posix(), 'bytes': file.stat().st_size,
                    'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                result['samples'].append(measured)
                print(voice['id'], i, round(measured['ttfaMs']), 'ms', round(measured['rtf'], 3), 'RTF', flush=True)
            result['ttfaMs'] = statistics.median(s['ttfaMs'] for s in result['samples'])
            result['rtf'] = statistics.median(s['rtf'] for s in result['samples'])
            results[voice['id']] = result
            (ROOT / ((runtime if args.gpu else args.engine) + '-benchmarks.json')).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    finally:
        p.kill()
        p.wait()
        log.close()
    print('Finished in', round(time.perf_counter() - started, 1), 'seconds')


if __name__ == '__main__':
    main()
