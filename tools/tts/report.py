"""Refresh measured voice/sample tables without committing the generated audio."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'tts'
REPO = Path(__file__).parents[2]


def main():
    catalog = json.loads(Path(__file__).with_name('catalog.json').read_text(encoding='utf-8'))
    lines = ['<!-- BEGIN GENERATED MEASUREMENTS -->',
        '| Voice | Language | Engine / execution | Warm first audio (median ms) | RTF (median) |',
        '| --- | --- | --- | ---: | ---: |']
    samples = []
    for voice in catalog['voices']:
        engine = voice['engine']
        runtime = 'piper-gpu' if engine == 'piper' else engine
        data = json.loads((ROOT / (runtime + '-benchmarks.json')).read_text(encoding='utf-8'))[voice['id']]
        lines.append(f"| {voice['name']} | {voice['lang']} | {engine} / GPU | {data['ttfaMs']:.0f} | {data['rtf']:.3f} |")
        for sample in data['samples']:
            relative = Path(sample['file'])
            if voice['lang'] == 'es' and relative.parts[0] != catalog['spanishSampleSet']:
                relative = Path(catalog['spanishSampleSet']) / relative
            file = ROOT / 'samples' / relative
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            if digest != sample['sha256']:
                raise ValueError('Sample changed since measurement: ' + file.name)
            samples.append((relative.as_posix(), sample['bytes'], digest))
    cpu = json.loads((ROOT / 'piper-benchmarks.json').read_text(encoding='utf-8'))
    for name, data in cpu.items():
        lines.append(f"| {name} (historical fallback) | {'es' if 'daniela' in name else 'en'} | Piper / CPU, 6 threads | {data['ttfaMs']:.0f} | {data['rtf']:.3f} |")
    lines += ['', 'RTF is generation seconds / audio seconds; lower is faster. Each median is',
        'over the same three fixed phrases in that language, after one warmup. First',
        'audio is the first complete WAV chunk. Piper can yield multiple chunks per',
        'phrase. All other candidates currently return sentence-sized chunks.', '',
        'Historical CPU fallback rows use the earlier audition scripts. In the original',
        'installation, the first engine process (imports and kernel execution) took',
        '29.7 s for Kokoro, 33.8 s for Qwen, 44.2 s for Chatterbox, 2.2 s for CPU Piper,',
        'and 53.5 s for the first ONNX CUDA initialization. Subsequent voices sharing',
        'a process were much faster. Cold calls use device speech until ready.', '',
        'Sample files are local generated assets, excluded from Git:', '',
        '| Sample (under `samples/`) | Bytes | SHA256 |', '| --- | ---: | --- |']
    lines += [f'| `{name}` | {size} | `{digest}` |' for name, size, digest in samples]
    lines += ['', '<!-- END GENERATED MEASUREMENTS -->']
    doc = REPO / 'docs' / 'NEXUS_VOICES.md'
    import re
    text = doc.read_text(encoding='utf-8')
    block = '\n'.join(lines)
    pattern = r'<!-- BEGIN GENERATED MEASUREMENTS -->[\s\S]*?<!-- END GENERATED MEASUREMENTS -->'
    text = re.sub(pattern, lambda _: block, text) if re.search(pattern, text) else text.rstrip()+'\n\n'+block+'\n'
    doc.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
