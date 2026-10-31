"""Bounded precision experiment; no production setting changes."""
import os
from pathlib import Path
import sys
import time
import json
import contextlib
os.environ['NEXUS_TTS_ROOT'] = str(Path(os.environ['LOCALAPPDATA'])/'NexusDeck'/'tts')
sys.path.insert(0,str(Path(__file__).parent/'tts'))
import worker
engine=worker.Engine('chatterbox')
voice=worker.VOICES['chatterbox-en']
results=[]
for precision in ['default','fp16','default','fp16','fp16']:
    start=time.perf_counter()
    try:
        with engine.torch.autocast('cuda',dtype=engine.torch.float16) if precision=='fp16' else contextlib.nullcontext():
            chunks=list(engine.synthesize(voice,'The tests are ready.'))
        engine.torch.cuda.synchronize()
        elapsed=(time.perf_counter()-start)*1000
        import numpy as np
        audio=np.concatenate([samples for samples,rate in chunks])
        file=Path('.local/voice-es')/('precision-'+str(len(results))+'-'+precision+'.wav')
        file.write_bytes(worker.wav_bytes(audio,chunks[0][1]))
        results.append(dict(precision=precision,ms=elapsed,seconds=len(audio)/chunks[0][1],finite=bool(np.isfinite(audio).all()),file=str(file)))
    except Exception as error:
        results.append(dict(precision=precision,error=str(error)))
    print(json.dumps(results[-1]),file=sys.stderr,flush=True)
Path('.local/voice-es/precision.json').write_text(json.dumps(results,indent=2))
