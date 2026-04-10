const fs = require('fs');
const buf = fs.readFileSync('D:\\AI\\product\\ImageCollector\\v1.0.0\\dist-new\\win-unpacked\\图片搜集器.exe');

// 搜索 ICO header (00 00 01 00)
let count = 0;
for (let i = 0; i < buf.length - 6; i++) {
  if (buf.readUInt16LE(i) === 0 && buf.readUInt16LE(i + 2) === 1) {
    const num = buf.readUInt16LE(i + 4);
    if (num >= 2 && num <= 10) {
      let sizes = [];
      for (let j = 0; j < num; j++) {
        const off = i + 6 + j * 16;
        const w = buf.readUInt8(off) || 256;
        const h = buf.readUInt8(off + 1) || 256;
        sizes.push(w + 'x' + h);
      }
      console.log('ICO at offset ' + i + ': ' + num + ' images [' + sizes.join(', ') + ']');
      count++;
    }
  }
}
console.log('Total ICO headers found:', count);

// 也检查 PNG (256x256)
const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
let pngCount = 0;
for (let i = 0; i < buf.length - 24; i++) {
  if (buf.compare(pngSig, 0, 4, i, i + 4) === 0) {
    const w = buf.readUInt32BE(i + 16);
    const h = buf.readUInt32BE(i + 20);
    if (w === 256 && h === 256) {
      console.log('256x256 PNG at offset ' + i);
      pngCount++;
    }
  }
}
console.log('256x256 PNG count:', pngCount);
