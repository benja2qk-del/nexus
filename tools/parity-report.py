"""Compare actual screenshot regions in 100 * OKLab units (threshold 2).

The full ROI mean includes text/layout differences. The inset top strip measures
surface paint without the different transcript text. Both remain in the report.
"""
import json
import re
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(sys.argv[1])

def oklab(rgb):
    rgb = np.asarray(rgb, dtype=float) / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    lms = linear @ np.array([[.4122214708,.5363325363,.0514459929],[.2119034982,.6806995451,.1073969566],[.0883024619,.2817188376,.6299787005]]).T
    return np.cbrt(lms) @ np.array([[.2104542553,.793617785,-.0040720468],[1.9779984951,-2.428592205,.4505937099],[.0259040371,.7827717662,-.808675766]]).T * 100

def delta(a, b):
    return round(float(np.linalg.norm(oklab(a) - oklab(b))), 3)

def color(value):
    vals = [float(x) for x in re.findall(r'[-+]?\d*\.?\d+(?:e[-+]?\d+)?', value)]
    if value.startswith('oklch'):
        l,c,h = vals[:3]; h=np.deg2rad(h); lab=np.array([l,c*np.cos(h),c*np.sin(h)])
    elif value.startswith('oklab'):
        lab=np.array(vals[:3])
    elif value.startswith('lab'):
        l,a,b=vals[:3]; y=(l+16)/116
        xyz=np.array([y+a/500,y,y-b/200]); xyz=np.where(xyz>6/29,xyz**3,3*(6/29)**2*(xyz-4/29))*[.96422,1,.82521]
        xyz=np.array([[.9555766,-.0230393,.0631636],[-.0282895,1.0099416,.0210077],[.0122982,-.020483,1.3299098]]) @ xyz
        linear=np.array([[3.2404542,-1.5371385,-.4985314],[-.969266,1.8760108,.041556],[.0556434,-.2040259,1.0572252]]) @ xyz
        rgb=np.where(linear<=.0031308,12.92*linear,1.055*np.maximum(linear,0)**(1/2.4)-.055)
        return np.clip(rgb,0,1)*255
    elif value.startswith('rgb'):
        return np.array(vals[:3])
    else:
        return None
    l,a,b=lab
    lms=np.array([l+.3963377774*a+.2158037573*b,l-.1055613458*a-.0638541728*b,l-.0894841775*a-1.291485548*b])**3
    linear=np.array([[4.0767416621,-3.3077115913,.2309699292],[-1.2684380046,2.6097574011,-.3413193965],[-.0041960863,-.7034186147,1.707614701]]) @ lms
    rgb=np.where(linear<=.0031308,12.92*linear,1.055*np.maximum(linear,0)**(1/2.4)-.055)
    return np.clip(rgb,0,1)*255

def sample(image, region, dpr, strip=False):
    r=region['rect']; x,y,w,h=[r[k] for k in ['x','y','width','height']]
    if strip:
        # Stay clear of rounded corners, borders and the first text baseline.
        radius=min(float(re.findall(r'[\d.]+',region['style']['borderRadius'])[0]),w/2,h/2)
        x+=max(16,radius+4); w-=2*max(16,radius+4); y+=4; h=4
    x1,y1=max(0,round(x*dpr)),max(0,round(y*dpr))
    x2,y2=min(image.shape[1],round((x+w)*dpr)),min(image.shape[0],round((y+h)*dpr))
    if x2<=x1 or y2<=y1:return None
    return image[y1:y2,x1:x2,:3].mean(axis=(0,1)).tolist()

rows=[]
for width in ['1568','440']:
    ref_dir=root/'before'/'reference'/width
    for file in sorted(ref_dir.glob('*.json')):
        if not (ref_dir/(file.stem+'.png')).exists():continue
        ref=json.loads(file.read_text(encoding='utf-8'))
        ref_image=np.asarray(Image.open(file.with_suffix('.png')).convert('RGB'))
        for phase in ['before','after']:
            target=root/phase/'nexus'/width/file.name
            if not target.exists():continue
            actual=json.loads(target.read_text(encoding='utf-8'))
            actual_image=np.asarray(Image.open(target.with_suffix('.png')).convert('RGB'))
            for name in sorted(ref['regions'].keys() & actual['regions'].keys()):
                if name=='sidebar' and width=='440':continue
                a,b=ref['regions'][name],actual['regions'][name]
                av=sample(ref_image,a,ref['viewport']['dpr']); bv=sample(actual_image,b,actual['viewport']['dpr'])
                if av is None or bv is None:continue
                ap=sample(ref_image,a,ref['viewport']['dpr'],True);bp=sample(actual_image,b,actual['viewport']['dpr'],True)
                row={'phase':phase,'width':int(width),'state':file.stem,'region':name,'meanDeltaE':delta(av,bv),'referenceMeanRGB':av,'nexusMeanRGB':bv,'paintDeltaE':delta(ap,bp) if ap and bp else None,'referencePaintRGB':ap,'nexusPaintRGB':bp,'referenceStyle':a['style'],'nexusStyle':b['style'],'referenceAncestors':a['ancestors'],'nexusAncestors':b['ancestors']}
                for prop in ['color','backgroundColor','borderTopColor']:
                    ac,bc=color(a['style'][prop]),color(b['style'][prop])
                    row[prop+'DeltaE']=delta(ac,bc) if ac is not None and bc is not None else None
                rows.append(row)
(root/'measurements.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
lookup={(r['width'],r['state'],r['region'],r['phase']):r for r in rows}
lines=['| Size | View / region | Inset strip before | Inset strip after | Whole ROI before | Whole ROI after |','|---|---|---:|---:|---:|---:|']
for r in rows:
    if r['phase']!='before':continue
    a=lookup.get((r['width'],r['state'],r['region'],'after'))
    if not a:continue
    if max(r['paintDeltaE'] or 0,a['paintDeltaE'] or 0,r['meanDeltaE'],a['meanDeltaE'])>2:
        lines.append(f"| {r['width']} | {r['state']} / {r['region']} | {r['paintDeltaE']} | {a['paintDeltaE']} | {r['meanDeltaE']} | {a['meanDeltaE']} |")
(root/'mismatches.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('\n'.join(lines))
