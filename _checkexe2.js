const fs = require('fs');
const buf = fs.readFileSync('D:\\AI\\product\\ImageCollector\\v1.0.0\\dist-new\\win-unpacked\\图片搜集器.exe');

// 精确搜索: 找 "16x16, 48x48, 32x32, 256x256" 这 4 个特定尺寸组合的 ICO
// 正确的 ICO header 后面应该是 16x16(bpp), 32x32(bpp), 48x48(bpp), 256x256(bpp)
let found = false;
for (let i = 0; i < buf.length - 70; i++) {
  // Check ICO header
  if (buf.readUInt16LE(i) !== 0 || buf.readUInt16LE(i + 2) !== 1 || buf.readUInt16LE(i + 4) !== 4) continue;

  // Check 4 entries for exact sizes 16, 32, 48, 256
  const s0 = buf.readUInt8(i + 6) || 256;
  const s1 = buf.readUInt8(i + 22) || 256;
  const s2 = buf.readUInt8(i + 38) || 256;
  const s3 = buf.readUInt8(i + 54) || 256;

  if (s0 === 16 && s1 === 32 && s2 === 48 && s3 === 256) {
    console.log('FOUND correct ICO at offset', i);
    for (let j = 0; j < 4; j++) {
      const off = i + 6 + j * 16;
      const w = buf.readUInt8(off) || 256;
      const h = buf.readUInt8(off + 1) || 256;
      const bpp = buf.readUInt16LE(off + 6);
      const sz = buf.readUInt32LE(off + 8);
      console.log(`  Entry ${j}: ${w}x${h} ${bpp}bpp data_size=${sz}`);
    }
    found = true;
  }
}

if (!found) {
  console.log('Standard 4-size ICO NOT found in exe');

  // 退而求其次，看是否有 256x256 PNG (electron-builder 的方式)
  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
  for (let i = buf.length - 200000; i < buf.length - 24; i++) {
    if (buf.compare(pngSig, 0, 4, i, i + 4) === 0) {
      const w = buf.readUInt32BE(i + 16);
      const h = buf.readUInt32BE(i + 20);
      if (w >= 16 && w <= 256 && h >= 16 && h <= 256) {
        console.log(`PNG icon near end: ${w}x${h} at offset ${i}`);
      }
    }
  }
}
