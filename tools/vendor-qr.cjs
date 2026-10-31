'use strict';
// Copy the existing approved reference's standalone MIT QR encoder, without React or a package install.
const fs=require('fs'),path=require('path'),os=require('os');
const source=fs.readFileSync(path.join(os.tmpdir(),'nexus-v0-ref','node_modules','qrcode.react','lib','index.js'),'utf8');
const start=source.indexOf('// src/third-party/qrcodegen/index.ts'),end=source.indexOf('var qrcodegen_default');
if(start<0||end<start)throw Error('QR encoder source not found');
const license=`/* QR Code generator library, Copyright (c) Project Nayuki. MIT License.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE. Source: qrcode.react's bundled src/third-party/qrcodegen. */\n`;
const helpers=`const __publicField=(obj,key,value)=>(obj[key]=value);\n`;
fs.writeFileSync('public/qr.js',license+`(function(root){'use strict';\n`+helpers+source.slice(start,end)+`\nroot.NexusQR={svg(text){const qr=qrcodegen.QrCode.encodeText(text,qrcodegen.QrCode.Ecc.MEDIUM),n=qr.size+8;let d='';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))d+='M'+(x+4)+','+(y+4)+'h1v1h-1z';return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Scan to pair your phone" viewBox="0 0 '+n+' '+n+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#e7f0f7"/><path d="'+d+'" fill="#081421"/></svg>';}};\n})(typeof window==='object'?window:globalThis);\n`);
