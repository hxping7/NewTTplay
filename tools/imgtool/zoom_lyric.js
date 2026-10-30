// 按已标定的坐标映射精确裁出歌词窗装饰区
// x: 1:1 (位图 x → 截图 x)
// y: sy = 1.7345 * by - 23.18
const sharp = require('sharp');
const KY = 1.7345, OFF = 23.18;
(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const meta = await sharp(src).metadata();
  // 位图区域: x 246..400, y 30..180
  const bx = 246, by = 30, bw = 154, bh = 150;
  const sx = bx, sy = Math.round(KY * by - OFF);
  const sw = bw, sh = Math.round(KY * bh - OFF) - sy;
  const L = Math.max(0, Math.min(sx, meta.width - 1));
  const T = Math.max(0, Math.min(sy, meta.height - 1));
  const W = Math.min(sw, meta.width - L);
  const H = Math.min(sh, meta.height - T);
  console.log(`位图(${bx},${by}) → 截图(${L},${T}) ${W}x${H}`);
  await sharp(src).extract({ left: L, top: T, width: W, height: H })
    .resize({ width: W * 3, kernel: 'nearest' })
    .png().toFile(out);
  console.log('放大完成:', out);
})();
