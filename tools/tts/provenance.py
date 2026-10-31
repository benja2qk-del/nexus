"""Retain primary downloads and emit source/size/license/SHA256 documentation."""
import concurrent.futures
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request
from download import ROOT, download, fetch_json


def main():
    manifest = json.loads((ROOT / 'downloads.json').read_text(encoding='utf-8'))
    uv = json.loads((ROOT / 'uv-source.json').read_text(encoding='utf-8-sig'))
    manifest.append(download((uv['url'], 'uv.zip', 'MIT OR Apache-2.0', None)))
    for name in ['chatterbox', 'perth']:
        info = json.loads((ROOT / (name + '-source.json')).read_text(encoding='utf-8-sig'))
        manifest.append(download((info['url'], name + '-source.zip', info['license'], info['sha256'].lower())))
    python = fetch_json('https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20261026')
    asset = next(a for a in python['assets'] if a['name'] == 'cpython-3.11.18+20261026-x86_64-pc-windows-msvc-install_only_stripped.tar.gz')
    manifest.append(download((asset['browser_download_url'], 'archives/python-3.11.18.tar.gz', 'PSF-2.0; bundled notices in runtime LICENSE.txt', asset['digest'].split(':')[1])))
    manifest.append(download(('https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl', 'archives/en_core_web_sm-3.8.0-py3-none-any.whl', 'MIT', None)))
    manifest.append(download(('https://github.com/explosion/spacy-pkuseg/releases/download/v0.0.26/spacy_ontonotes.zip', 'pkuseg/spacy_ontonotes.zip', 'MIT spacy-pkuseg; upstream language model', 'b216e7f92de7ae285aeab8feba2faa8ea8216e5995ff6fb3d391cc8356db1bfe')))
    jobs = []
    for name in ['torch', 'torchaudio']:
        index = 'https://download.pytorch.org/whl/cu128/' + name + '/'
        with urllib.request.urlopen(index) as response:
            text = response.read().decode()
        link = next(html.unescape(m) for m in re.findall(r'href="([^"]+)"', text)
                    if name + '-2.10.0%2Bcu128-cp311-cp311-win_amd64.whl' in m)
        url, fragment = urllib.parse.urldefrag(urllib.parse.urljoin(index, link))
        jobs.append((url, 'archives/' + name + '-2.10.0+cu128-cp311-cp311-win_amd64.whl', 'BSD-3-Clause; CUDA bundled component notices', fragment.split('=')[1]))
    for name, version, license_name in [('kokoro', '0.9.4', 'Apache-2.0'), ('qwen-tts', '0.1.1', 'Apache-2.0'), ('piper-tts', '1.8.0', 'GPL-3.0-or-later'), ('espeakng-loader', '0.2.4', 'MIT wrapper; GPL-3.0 eSpeak NG'), ('onnxruntime-gpu', '1.23.2', 'MIT; bundled notices')]:
        info = fetch_json('https://pypi.org/pypi/' + name + '/' + version + '/json')
        candidates = [f for f in info['urls'] if f['filename'].endswith('.whl') and ('none-any' in f['filename'] or 'win_amd64' in f['filename'] and any(t in f['filename'] for t in ['cp311', 'cp39-abi3', 'cp310-abi3', 'py3-none']))]
        asset = candidates[0]
        jobs.append((asset['url'], 'archives/' + asset['filename'], license_name, asset['digests']['sha256']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        manifest += list(pool.map(download, jobs))
    # Exact installed dependency inventories; runtime-local URLs are replaced by
    # the corresponding pinned publisher URL, never an owner's absolute path.
    for runtime in ['neural', 'chatterbox', 'piper', 'piper-gpu']:
        code = 'import importlib.metadata as m,json;print(json.dumps(sorted([(d.metadata["Name"],d.version) for d in m.distributions()])))'
        result = subprocess.check_output([str(ROOT / runtime / 'Scripts' / 'python.exe'), '-c', code], creationflags=subprocess.CREATE_NO_WINDOW)
        packages = json.loads(result)
        output = Path(__file__).with_name(runtime + '-versions.txt')
        output.write_text('\n'.join(name + '==' + version for name, version in packages) + '\n', encoding='utf-8')
    (ROOT / 'provenance.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    Path(__file__).with_name('sources.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    lines = ['<!-- BEGIN GENERATED DOWNLOAD AUDIT -->',
        'Every SHA256 below was calculated over the retained local download. Model LFS files',
        'also matched Hugging Face metadata. All paths are relative to the TTS runtime folder.',
        '', '| Download | Bytes | License / source | SHA256 |', '| --- | ---: | --- | --- |']
    for item in manifest:
        lines.append('| `' + item['file'] + '` | ' + str(item['bytes']) + ' | [' + item['license'] + '](' + item['url'] + ') | `' + item['sha256'] + '` |')
    lines += ['', '<!-- END GENERATED DOWNLOAD AUDIT -->']
    doc = Path(__file__).parents[2] / 'docs' / 'NEXUS_VOICES.md'
    text = doc.read_text(encoding='utf-8') if doc.exists() else '# NEXUS voices\n'
    text = re.sub(r'\n<!-- BEGIN GENERATED DOWNLOAD AUDIT -->[\s\S]*?<!-- END GENERATED DOWNLOAD AUDIT -->\n?', '\n', text)
    doc.write_text(text.rstrip() + '\n\n' + '\n'.join(lines) + '\n', encoding='utf-8')
    print('Audited', len(manifest), 'primary artifacts; exact dependency inventories written.')


if __name__ == '__main__':
    main()
