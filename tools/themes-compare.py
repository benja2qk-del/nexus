from pathlib import Path
from PIL import Image, ImageDraw

root = Path('docs/shots/themes')
for width, screen, reference, variant in [
    (1568, 'theme', 'theme', 'mixed'),
    (1568, 'home', 'home', 'mixed'),
    (1568, 'copilot', 'copilot', 'single'),
    (1568, 'theme', 'single-theme', 'single'),
    (440, 'home', 'home', 'mixed'),
    (440, 'themes', 'themes', 'mixed'),
    (440, 'sessions', 'sessions', 'mixed'),
]:
    a = Image.open(root / 'reference' / f'{width}-{reference}.png').convert('RGB')
    b = Image.open(root / variant / f'{width}-{screen}.png').convert('RGB')
    canvas = Image.new('RGB', (a.width+b.width+12, max(a.height,b.height)+32), '#172332')
    canvas.paste(a, (0,32)); canvas.paste(b, (a.width+12,32))
    draw = ImageDraw.Draw(canvas)
    draw.text((12,10), 'V0 DESIGN REFERENCE / SAMPLE DATA', fill='white')
    draw.text((a.width+24,10), f'NEXUS / {variant.upper()} ISOLATED FIXTURE', fill='white')
    canvas.save(root / f'compare-{variant}-{width}-{screen}.jpg', quality=90)
