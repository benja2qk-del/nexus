from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import sys
phase = sys.argv[1]
root = Path('docs/shots/redesign')
for width in (1568, 1920, 390):
    for shot in (root / phase / str(width)).glob('*.png'):
        name = shot.stem
        match = 'session' if name in ('session-top', 'question') else name
        reference = root / ('ref-round2' if phase == 'round2' else 'ref') / f'{width}-{match}.png'
        if not reference.exists():
            continue
        a, b = Image.open(reference).convert('RGB'), Image.open(shot).convert('RGB')
        height = max(a.height, b.height)
        canvas = Image.new('RGB', (a.width + b.width + 12, height + 32), '#172332')
        canvas.paste(a, (0, 32))
        canvas.paste(b, (a.width + 12, 32))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), 'APPROVED V0 REFERENCE', fill='white')
        draw.text((a.width + 24, 10), 'NEXUS / ' + phase.upper(), fill='white')
        canvas.save(root / f'compare-{phase}-{width}-{name}.jpg', quality=88)
