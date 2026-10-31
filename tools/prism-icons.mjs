import fs from 'node:fs';
import { browser } from './polish-browser.mjs';
const b = await browser();
try {
  await b.navigate('/pair.html'); await b.until('document.readyState === "complete"');
  for(const size of [32,180,192,256,512]) {
    const src = size === 32 ? '/favicon.svg' : '/icon.svg';
    const data = await b.js(`await (async()=>{const im=new Image();im.src='${src}';await im.decode();const c=document.createElement('canvas');c.width=c.height=${size};c.getContext('2d').drawImage(im,0,0,${size},${size});return c.toDataURL('image/png').split(',')[1]})()`);
    fs.writeFileSync('public/'+(size===180?'apple-touch-icon.png':`icon-${size}.png`),Buffer.from(data,'base64'));
  }
  const data=await b.js(`await (async()=>{const im=new Image();im.src='/icon-maskable.svg';await im.decode();const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(im,0,0,512,512);return c.toDataURL('image/png').split(',')[1]})()`);
  fs.writeFileSync('public/icon-maskable-512.png',Buffer.from(data,'base64'));
} finally { await b.close(); }
