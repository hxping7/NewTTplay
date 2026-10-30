const sharp = require('sharp');
const fs = require('fs'), path = require('path');
const DIR = 'D:/TTPlayer/jingyu-niang-assets/frames';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
(async () => {
  console.log('帧名'.padEnd(16), '画布'.padEnd(12), '内容包围盒(x,y,w,h)'.padEnd(26), '高度占比', '底部基线y', '宽度占比');
  for (const f of files) {
    const p = path.join(DIR, f);
    const img = sharp(p);
    const m = await img.metadata();
    // 用 alpha 通道阈值提取包围盒
    const { data, info } = await img
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const a = data[(y * info.width + x) * 4 + 3];
        if (a > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    console.log(
      f.padEnd(16),
      (info.width + 'x' + info.height).padEnd(12),
      `${minX},${minY},${w},${h}`.padEnd(26),
      (h / info.height * 100).toFixed(1).padStart(6) + '%',
      String(maxY).padStart(8),
      (w / info.width * 100).toFixed(1).padStart(6) + '%'
    );
  }
})();
