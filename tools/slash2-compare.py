from pathlib import Path
from PIL import Image, ImageDraw

root = Path('docs/shots/slash2')
for width in (1568, 440):
    for screen in ('picker', 'filtered', 'confirm', 'ran'):
        a = Image.open(root / 'reference' / f'{width}-{screen}.png').convert('RGB')
        b = Image.open(root / 'nexus' / f'{width}-{screen}.png').convert('RGB')
        canvas = Image.new('RGB', (a.width + b.width + 12, max(a.height, b.height) + 32), '#172332')
        canvas.paste(a, (0, 32))
        canvas.paste(b, (a.width + 12, 32))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), 'V0 REFERENCE / SAMPLE CATALOG', fill='white')
        draw.text((a.width + 24, 10), 'NEXUS / REAL CATALOG, ISOLATED SESSION', fill='white')
        canvas.save(root / f'compare-{width}-{screen}.jpg', quality=90)
