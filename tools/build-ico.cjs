'use strict';
// Bundle PNG representations of the same SVG into the Windows shortcut icon, with no dependencies.
const fs = require('fs');
const sizes = [32, 256], images = sizes.map(n => fs.readFileSync(`public/icon-${n}.png`));
const header = Buffer.alloc(6 + images.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let n = 0; n < images.length; n++) {
  const at = 6 + n * 16, size = sizes[n];
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(images[n].length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += images[n].length;
}
fs.writeFileSync('nexus.ico', Buffer.concat([header, ...images]));
console.log('Wrote nexus.ico: 32px and 256px PNG representations of the new core.');
