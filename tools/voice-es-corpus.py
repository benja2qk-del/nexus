"""Synthetic bilingual listening corpus; output is private and never committed."""
import json
import os
from pathlib import Path
import sys
import wave
import numpy as np

ROOT = Path(os.environ['LOCALAPPDATA']) / 'NexusDeck' / 'tts'
os.environ['NEXUS_TTS_ROOT'] = str(ROOT)
sys.path.insert(0, str(Path(__file__).parent / 'tts'))
import worker

out = Path('.local/voice-es')
out.mkdir(parents=True, exist_ok=True)
engine_name = sys.argv[1] if len(sys.argv) > 1 else 'piper'
engine = None
manifest_file = out / (engine_name + '-corpus.json')
previous = {row['id']: row for row in json.loads(manifest_file.read_text(encoding='utf-8'))} if manifest_file.exists() else {}
cases = [
    ('es-short', 'es', 'Dale, al tiro.'),
    ('es-chile', 'es', 'Oye, cachai si los tests pasaron?'),
    ('es-neutral', 'es', 'Hola, puedes revisar las pruebas y contarme si todo funciona bien?'),
    ('es-colloquial', 'es', 'Bacán, po. Está fome esperar tanto, pero avanzamos harto con las pruebas.'),
    ('es-mixed', 'es', 'Abre la sesión de beacon y run the tests.'),
    ('en-short', 'en', 'Okay, go ahead.'),
    ('en-medium', 'en', 'Please check the current session and tell me whether all the tests passed.'),
    ('en-mixed', 'en', 'Run the tests for beacon and then dime si pasaron.'),
    ('es-medium', 'es', 'Necesito que revises las pruebas de esta sesión y me cuentes cuáles pasaron. Después podemos revisar juntos los cambios pendientes.'),
    ('en-longer', 'en', 'Please check the current session and tell me whether all the tests passed. Then we can review the remaining changes together.'),
]
if engine_name == 'chatterbox':
    cases = [cases[1], cases[4], cases[6]]
elif engine_name == 'qwen':
    cases = [cases[1], cases[2]]
manifest = []
for key, lang, text in cases:
    voice_id = ('piper-daniela' if lang == 'es' else 'piper-lj') if engine_name == 'piper' else 'chatterbox-' + lang if engine_name == 'chatterbox' else 'qwen-ar-f'
    voice = dict(worker.VOICES[voice_id])
    saved = previous.get(engine_name+'-'+key)
    if saved and saved['reference'] == text and Path(saved['file']).exists():
        manifest.append(saved)
        continue
    if engine_name == 'qwen':
        voice['prompt'] = 'Voz femenina adulta de Chile, natural y cercana. Español latinoamericano, ritmo conversacional chileno suave, sin caricatura ni voseo rioplatense.'
    if engine is None:
        engine = worker.Engine(engine_name)
    chunks = list(engine.synthesize(voice, text))
    rate = chunks[0][1]
    samples = np.concatenate([x for x, _ in chunks])
    # Capture normalization matches the browser: 16 kHz mono PCM.
    target = np.interp(np.arange(round(len(samples) * 16000 / rate)) * rate / 16000, np.arange(len(samples)), samples)
    file = out / (engine_name + '-' + key + '.wav')
    file.write_bytes(worker.wav_bytes(target, 16000))
    manifest.append(dict(id=engine_name+'-'+key, language=lang, reference=text, seconds=len(target)/16000, file=str(file), voice=voice_id))
    print('CORPUS ' + key, file=sys.stderr, flush=True)
(out / (engine_name + '-corpus.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
