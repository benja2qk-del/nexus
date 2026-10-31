from pathlib import Path
from PIL import Image, ImageDraw

root = Path('docs/shots/call')
for width in (1568, 1920, 440):
    for name in ('listening', 'working', 'speaking', 'question', 'pill', 'ended'):
        ref = root / 'reference' / f'{width}-{name}.png'
        actual = root / 'live' / str(width) / f'{name}.png'
        if not ref.exists() or not actual.exists():
            continue
        a, b = Image.open(ref).convert('RGB'), Image.open(actual).convert('RGB')
        canvas = Image.new('RGB', (a.width + b.width + 12, max(a.height, b.height) + 32), '#172332')
        canvas.paste(a, (0, 32)); canvas.paste(b, (a.width + 12, 32))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), 'V0 REFERENCE', fill='white')
        draw.text((a.width + 24, 10), 'NEXUS CALL / RECORDED FIXTURE', fill='white')
        canvas.save(root / f'compare-{width}-{name}.jpg', quality=88)
