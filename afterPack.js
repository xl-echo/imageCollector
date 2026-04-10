// afterPack.js
// electron-builder afterPack 钩子
// 在 electron-builder 打包 exe 后、生成 NSIS/portable 前，用 rcedit 补入多尺寸图标
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  const rceditPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign', '841205447', 'rcedit-x64.exe'
  );

  if (!fs.existsSync(rceditPath)) {
    console.warn('[afterPack] rcedit not found, skipping icon fix');
    return;
  }

  // 找到打包后的 exe（context.appOutDir = dist-new/win-unpacked）
  const exePath = path.join(context.appOutDir, '图片搜集器.exe');
  // icon.ico 在项目根目录（afterPack.js 同级）
  const icoPath = path.join(__dirname, 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found:', exePath);
    return;
  }
  if (!fs.existsSync(icoPath)) {
    console.warn('[afterPack] ico not found:', icoPath);
    return;
  }

  console.log('[afterPack] Setting multi-size icon with rcedit...');
  try {
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`, { stdio: 'inherit' });
    console.log('[afterPack] Icon set successfully!');
  } catch (e) {
    console.error('[afterPack] Failed to set icon:', e.message);
  }
};
