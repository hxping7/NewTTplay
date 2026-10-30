// 最终对比: 官方原图 vs 矢量重绘版 (同尺寸并排)
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUT = path.join('D:/TTPlayer/.workbuddy/imgtool', 'whale_preview');
const SRC = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-29T12-39-41-842Z-63ac5e40.png';
const SVG = path.join(OUT, 'ds_logo_vector.svg');

(async () => {
  // 原图裁出 logo 本体
  const orig = await sharp(SRC).extract({ left: 124, top: 217, width: 737, height: 563 })
    .resize({ width: 400, height: Math.round(400 * 563 / 737), fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' }).png().toBuffer();
  const om = await sharp(orig).metadata();

  // 矢量版
  const vec = await sharp(fs.readFileSync(SVG)).resize({ width: om.width, height: om.height, fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' }).png().toBuffer();

  // 并排
  const W = om.width * 2 + 30, H = om.height + 40;
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 245, g: 245, b: 248 } } })
    .composite([
      { input: orig, top: 20, left: 10 },
      { input: vec, top: 20, left: om.width + 20 },
    ])
    .png().toFile(path.join(OUT, 'final_side_by_side.png'));
  console.log('并排对比(左原图/右矢量):', path.join(OUT, 'final_side_by_side.png'));

  // 130px 实际尺寸对比
  const o130 = await sharp(SRC).extract({ left: 124, top: 217, width: 737, height: 563 })
    .resize({ width: 130, height: 99, fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const v130 = await sharp(fs.readFileSync(SVG)).resize({ width: 130, height: 99, fit: 'fill', kernel: 'lanczos3' })
    .png().toBuffer();
  const cmpr = await sharp({ create: { width: 130 * 6 * 2 + 30, height: 99 * 6 + 40, channels: 3, background: { r: 20, g: 32, b: 90 } } })
    .composite([
      { input: await sharp(o130).resize({ width: 130 * 6, height: 99 * 6, kernel: 'nearest' }).png().toBuffer(), top: 20, left: 10 },
      { input: await sharp(v130).resize({ width: 130 * 6, height: 99 * 6, kernel: 'nearest' }).png().toBuffer(), top: 20, left: 130 * 6 + 20 },
    ])
    .png().toFile(path.join(OUT, 'final_130_compare.png'));
  console.log('130px对比(左原图/右矢量):', path.join(OUT, 'final_130_compare.png'));
})();
