const fs = require('fs');
const buf = fs.readFileSync('D:\\AI\\product\\ImageCollector\\v1.0.0\\icon.ico');
console.log('ICO size:', buf.length, 'bytes');
console.log('ICO header: reserved=' + buf.readUInt16LE(0) + ' type=' + buf.readUInt16LE(2) + ' count=' + buf.readUInt16LE(4));
for (let i = 0; i < buf.readUInt16LE(4); i++) {
  const off = 6 + i * 16;
  const w = buf.readUInt8(off) || 256;
  const h = buf.readUInt8(off + 1) || 256;
  const bpp = buf.readUInt16LE(off + 6);
  const sz = buf.readUInt32LE(off + 8);
  console.log(`  ${w}x${h} ${bpp}bpp size=${sz}`);
}
