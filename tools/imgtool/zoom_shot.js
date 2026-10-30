// 放大实跑截图里的鲸鱼区域(自动夹紧边界)
const sharp = require('sharp');
(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const meta = await sharp(src).metadata();
  const left = Math.min(250, meta.width - 140);
  const top = Math.min(240, meta.height - 79);
  const width = Math.min(140, meta.width - left);
  const height = Math.min(79, meta.height - top);
  await sharp(src).extract({ left, top, width, height })
    .resize({ width: width * 4, kernel: 'nearest' })
    .png().toFile(out);
  console.log(`裁剪 (${left},${top}) ${width}x${height} → 放大完成: ${out}`);
})();
