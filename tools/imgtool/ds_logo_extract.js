// 从老板提供的 DeepSeek 官方 logo 图中提取精确轮廓
// 策略: 1) 去白底 → 得到 alpha  2) 提取蓝色区域  3) 输出放大预览供核对
const path = require('path');
const sharp = require('sharp');

const SRC = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-29T12-39-41-842Z-63ac5e40.png';
const OUT = 'D:/TTPlayer/.workbuddy/imgtool/whale_preview';

(async () => {
  const img = sharp(SRC);
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);

  // 蓝色像素判定: B 明显大于 R, 且不是白
  const isBlue = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return b > 150 && b - r > 50;
  };

  // 1) 生成带 alpha 的抠图
  const rgba = Buffer.alloc(width * height * 4);
  let blueCount = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const o = (y * width + x) * 4;
      if (isBlue(i)) {
        rgba[o] = data[i]; rgba[o + 1] = data[i + 1]; rgba[o + 2] = data[i + 2]; rgba[o + 3] = 255;
        blueCount++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      } else {
        rgba[o + 3] = 0;
      }
    }
  }
  console.log(`蓝色像素: ${blueCount}  包围盒: x ${minX}..${maxX}  y ${minY}..${maxY}`);

  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png().toFile(path.join(OUT, 'ds_logo_cutout.png'));
  console.log('抠图:', path.join(OUT, 'ds_logo_cutout.png'));

  // 2) 裁出 logo 本体(带少量留白)
  const pad = 8;
  const L = Math.max(0, minX - pad), T = Math.max(0, minY - pad);
  const W = Math.min(width - L, maxX - minX + pad * 2);
  const H = Math.min(height - T, maxY - minY + pad * 2);
  console.log(`logo 本体: (${L},${T}) ${W}x${H}  比例 ${(W / H).toFixed(3)}`);

  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left: L, top: T, width: W, height: H })
    .png().toFile(path.join(OUT, 'ds_logo_body.png'));
  console.log('本体:', path.join(OUT, 'ds_logo_body.png'));

  // 3) 输出每行/每列的蓝色占比 → 帮助我理解形状结构(尾部/头部位置)
  const rowProfile = [];
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) {
      const o = ((T + y) * width + (L + x)) * 4;
      if (rgba[o + 3] > 0) c++;
    }
    rowProfile.push(c);
  }
  // 打印每 10 行的占比
  console.log('\n行分布(每 10 行, 蓝色像素数):');
  for (let y = 0; y < H; y += Math.max(1, Math.floor(H / 20))) {
    console.log(`  y=${y} (${(y / H * 100).toFixed(0)}%): ${rowProfile[y]}`);
  }

  // 4) 眼睛位置探测: 在蓝色区域内找白色像素(镂空) + 黑点
  console.log('\n镂空/眼睛探测:');
  // 找内部白色区域(被蓝色包围的白)
  for (let y = 0; y < H; y += Math.max(1, Math.floor(H / 25))) {
    for (let x = 0; x < W; x += Math.max(1, Math.floor(W / 25))) {
      const o = ((T + y) * width + (L + x)) * 4;
      if (rgba[o + 3] === 0) {
        // 检查周围是否是蓝
        let blueAround = 0;
        for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
          const yy = T + y + dy, xx = L + x + dx;
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) {
            const oo = (yy * width + xx) * 4;
            if (rgba[oo + 3] > 0) blueAround++;
          }
        }
        if (blueAround >= 24) {
          console.log(`  白色镂空 @ 本体(${x},${y}) 比例(${(x/W*100).toFixed(0)}%,${(y/H*100).toFixed(0)}%)`);
        }
      }
    }
  }
})();
