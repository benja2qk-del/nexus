"""Retain and hash the exact platform distributions behind the Python inventories."""
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess
from download import ROOT, download, fetch_json


def main():
    primary = {'torch', 'torchaudio', 'kokoro', 'qwen-tts', 'piper-tts', 'onnxruntime-gpu',
               'en-core-web-sm', 'chatterbox-tts', 'resemble-perth', 'espeakng-loader'}
    packages = {}
    code = '''import importlib.metadata as m,json
out=[]
for d in m.distributions():
 tags=[s[5:] for s in (d.read_text('WHEEL') or '').splitlines() if s.startswith('Tag: ')]
 out.append({'name':d.metadata['Name'],'version':d.version,'tags':tags})
print(json.dumps(out))'''
    for runtime in ['neural', 'chatterbox', 'piper', 'piper-gpu']:
        data = subprocess.check_output([str(ROOT / runtime / 'Scripts' / 'python.exe'), '-c', code], creationflags=subprocess.CREATE_NO_WINDOW)
        for item in json.loads(data):
            name = item['name'].lower().replace('_', '-')
            if name not in primary:
                packages[(name, item['version'])] = item

    def audit(item):
        name, version = item['name'], item['version']
        info = fetch_json('https://pypi.org/pypi/' + name + '/' + version + '/json')

        def compatible(file):
            if not file['filename'].endswith('.whl'):
                return False
            tags = file['filename'][:-4].rsplit('-', 3)[-3:]
            return any(all(t in options.split('.') for t, options in zip(tag.split('-'), tags)) for tag in item['tags'])

        options = [f for f in info['urls'] if compatible(f)]
        if not options:
            options = [f for f in info['urls'] if f['packagetype'] == 'sdist']
        if not options:
            raise ValueError('No matching distribution: ' + name)
        artifact = options[0]
        meta = info['info']
        license_name = meta.get('license_expression')
        if not license_name:
            classifiers = [s.split(' :: ')[-1] for s in meta.get('classifiers', []) if s.startswith('License ::') and s.split(' :: ')[-1] != 'OSI Approved']
            license_name = '; '.join(classifiers) or (meta.get('license') or 'See distribution license').splitlines()[0][:100]
        result = download((artifact['url'], 'dependencies/' + artifact['filename'], license_name, artifact['digests']['sha256']))
        return {**result, 'package': name, 'version': version}

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        audited = list(pool.map(audit, packages.values()))
    audited.sort(key=lambda x: (x['package'].lower(), x['version']))
    Path(__file__).with_name('dependencies.json').write_text(json.dumps(audited, indent=2), encoding='utf-8')
    doc = Path(__file__).parents[2] / 'docs' / 'NEXUS_VOICES.md'
    text = doc.read_text(encoding='utf-8')
    text = re.sub(r'\n<!-- BEGIN GENERATED DEPENDENCIES -->[\s\S]*?<!-- END GENERATED DEPENDENCIES -->\n?', '\n', text)
    lines = ['<!-- BEGIN GENERATED DEPENDENCIES -->', '### Additional Python distributions', '',
        'Matching wheel tags were read from each installed distribution. For packages',
        'built from source, the source distribution is retained. These downloads were',
        'also locally rehashed against PyPI metadata; licenses below are the publisher',
        'metadata, with full notices in the downloaded distribution. Primary packages',
        'already listed above are not duplicated.', '',
        '| Package | Bytes | License / exact source | SHA256 |', '| --- | ---: | --- | --- |']
    for item in audited:
        license_name = item['license'].replace('|', '/')
        lines.append(f"| {item['package']} {item['version']} | {item['bytes']} | [{license_name}]({item['url']}) | `{item['sha256']}` |")
    lines += ['', '<!-- END GENERATED DEPENDENCIES -->']
    doc.write_text(text.rstrip() + '\n\n' + '\n'.join(lines) + '\n', encoding='utf-8')
    print('Audited', len(audited), 'additional distributions;', sum(x['bytes'] for x in audited), 'bytes')


if __name__ == '__main__':
    main()
