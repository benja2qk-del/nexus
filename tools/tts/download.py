"""Explicit, resumable installation downloads. Never run from a web request."""
import concurrent.futures
import hashlib
import json
import os
import time
from pathlib import Path
import urllib.request

ROOT = Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'tts'
ROOT.mkdir(parents=True, exist_ok=True)


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def download(item):
    url, relative, license_name, expected = item
    dest = ROOT / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        partial = dest.with_name(dest.name + '.partial')
        for attempt in range(4):
            offset = partial.stat().st_size if partial.exists() else 0
            try:
                request = urllib.request.Request(url, headers={'Range': 'bytes=' + str(offset) + '-'} if offset else {})
                with urllib.request.urlopen(request, timeout=120) as response:
                    append = offset and response.status == 206 and response.headers.get('Content-Range', '').startswith('bytes ' + str(offset) + '-')
                    with partial.open('ab' if append else 'wb') as out:
                        while chunk := response.read(4 * 1024 * 1024):
                            out.write(chunk)
                break
            except (TimeoutError, OSError):
                if attempt == 3:
                    raise
                time.sleep(1)
        partial.replace(dest)
    digest = hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest()
    if expected and digest != expected:
        raise ValueError('Hash mismatch: ' + relative)
    print('Verified ' + relative, flush=True)
    return {'file': relative, 'url': url, 'bytes': dest.stat().st_size,
            'license': license_name, 'sha256': digest}


def main():
    jobs = []
    repos = [
        ('hexgrad/Kokoro-82M', 'kokoro', 'Apache-2.0', lambda f: f in ['config.json', 'kokoro-v1_0.pth', 'README.md', 'LICENSE', 'VOICES.md'] or f in ['voices/' + v + '.pt' for v in ['af_heart', 'am_michael', 'ef_dora', 'em_alex']]),
        ('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'qwen', 'Apache-2.0', lambda f: not f.startswith('.') and not f.endswith(('.wav', '.mp3'))),
        ('rhasspy/piper-voices', 'piper', 'MIT repository; see individual MODEL_CARD', lambda f: f.startswith(('es/es_AR/daniela/high/', 'en/en_US/ljspeech/high/')) and f.endswith(('.onnx', '.onnx.json', 'MODEL_CARD'))),
        ('ResembleAI/chatterbox', 'chatterbox', 'MIT', lambda f: f in ['ve.pt', 's3gen.pt', 't3_mtl23ls_v3.safetensors', 'grapheme_mtl_merged_expanded_v1.json', 'conds.pt', 'Cangjie5_TC.json', 'README.md', 'LICENSE']),
    ]
    for repo, folder, license_name, include in repos:
        info = fetch_json('https://huggingface.co/api/models/' + repo + '?blobs=true')
        revision = info['sha']
        for f in info['siblings']:
            name = f['rfilename']
            if include(name):
                leaf = Path(name).name
                if folder == 'piper' and leaf == 'MODEL_CARD':
                    leaf = '-'.join(name.split('/')[1:4]) + '-MODEL_CARD'
                relative = 'models/' + folder + '/' + (leaf if folder == 'piper' else name)
                jobs.append(('https://huggingface.co/' + repo + '/resolve/' + revision + '/' + name,
                             relative, license_name, f.get('lfs', {}).get('sha256')))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(download, jobs))
    (ROOT / 'downloads.json').write_text(json.dumps(results, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
