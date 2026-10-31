"""Pin and audit the official MIT Whisper checkpoint; no credentials required."""
import hashlib
import json
import os
from pathlib import Path
from huggingface_hub import snapshot_download

repo = 'openai/whisper-large-v3-turbo'
root = Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'asr' / 'whisper-large-v3-turbo'
revision = '41f01f3fe87f28c78e2fbf8b568835947dd65ed9'
snapshot_download(repo, revision=revision, local_dir=root, token=False,
    allow_patterns=['*.json', '*.txt', 'model.safetensors', 'README.md'], max_workers=4)
files = []
for file in sorted(root.iterdir()):
    if not file.is_file():
        continue
    digest = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
    files.append(dict(file=file.name, bytes=file.stat().st_size, sha256=digest,
        source=f'https://huggingface.co/{repo}/resolve/{revision}/{file.name}', license='MIT'))
(root.parent / 'provenance.json').write_text(json.dumps(dict(repository=repo, revision=revision, files=files), indent=2), encoding='utf-8')
print(json.dumps(dict(revision=revision, bytes=sum(f['bytes'] for f in files), files=len(files))))
