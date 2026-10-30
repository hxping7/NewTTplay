// 精确提取 DeepSeek 官方 logo (老板提供的原图) → 带 alpha 的 PNG
// 难点: 白色既是【外部背景】也是【腹部镂空/眼窝】, 必须用洪水填充区分
const path = require('path');
const sharp = require('sharp');

const SRC = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-29T12-39-41-842Z-63ac5e40.png';
const OUT = 'D:/TTPlayer/.workbuddy/imgtool/whale_preview';

(async () => {
  const { width, height } = await sharp(SRC).metadata();
  const { data } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);

  const R = (x, y) => data[(y * width + x) * ch];
  const G = (x, y) => data[(y * width + x) * ch + 1];
  const B = (x, y) => data[(y * width + x) * ch + 2];

  // 取纯蓝参考色(最靠中心的蓝像素)
  let pr = 0, pg = 0, pb = 0, pc = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const r = R(x, y), g = G(x, y), b = B(x, y);
    if (b > 200 && b - r > 120 && g > 80 && g < 160) { pr += r; pg += g; pb += b; pc++; }
  }
  pr = Math.round(pr / pc); pg = Math.round(pg / pc); pb = Math.round(pb / pc);
  console.log(`纯蓝参考色: rgb(${pr},${pg},${pb})`);

  // 蓝色判定(宽松, 让边缘半透明像素也保留)
  const isBlue = (x, y) => (B(x, y) - R(x, y)) > 40;

  // 洪水填充: 从图像边界出发, 穿过所有非蓝像素 → 标记为"外部背景"
  const outer = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      if (!isBlue(x, y) && !outer[y * width + x]) { outer[y * width + x] = 1; stack.push([x, y]); }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      if (!isBlue(x, y) && !outer[y * width + x]) { outer[y * width + x] = 1; stack.push([x, y]); }
    }
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (outer[ny * width + nx]) continue;
      if (isBlue(nx, ny)) continue;
      outer[ny * width + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  let outerCount = 0;
  for (let i = 0; i < outer.length; i++) outerCount += outer[i];
  console.log(`外部背景像素: ${outerCount}`);

  // 生成变体:
  //  A) 忠实还原: 外部背景透明, 蓝色身体实心, 内部白色(腹部镂空/眼窝)保留为白色
  //  B) 负空间版: 内部白色也透明(露出深蓝底)
  const mk = (keepBelly) => {
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch, o = (y * width + x) * 4;
      const r = R(x, y), g = G(x, y), b = B(x, y);
      if (outer[y * width + x]) {
        rgba[o + 3] = 0;                       // 外部背景 → 全透明
      } else if (isBlue(x, y)) {
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      } else {
        // 内部白色 = 腹部镂空 / 眼窝 / 眼珠底
        if (!keepBelly) {
          rgba[o + 3] = 0;
        } else {
          // 纯白 → 实心白; 靠近蓝色的抗锯齿边缘 → 半透明
          const whiteness = Math.min(r, g, b);
          if (whiteness > 245) {
            rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = 255;
          } else {
            // 蓝白混合的边缘像素: 按混合比例算出 alpha, 颜色用纯蓝
            const alpha = Math.round((255 - whiteness) / Math.max(1, 255 - Math.min(pr, pg, pb)) * 255);
            rgba[o] = pr; rgba[o + 1] = pg; rgba[o + 2] = pb;
            rgba[o + 3] = Math.max(0, Math.min(255, alpha));
          }
        }
      }
    }
    return rgba;
  };

  const bbox = (rgba) => {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { minX, maxX, minY, maxY };
  };

  for (const [name, keep] of [['A_keepbelly', true], ['B_cutbelly', false]]) {
    const rgba = mk(keep);
    const b = bbox(rgba);
    const L = b.minX, T = b.minY, W = b.maxX - b.minX + 1, H = b.maxY - b.minY + 1;
    console.log(`${name}: 本体 ${W}x${H} 比例 ${(W / H).toFixed(3)}`);
    await sharp(rgba, { raw: { width, height, channels: 4 } })
      .extract({ left: L, top: T, width: W, height: H })
      .png().toFile(path.join(OUT, `ds_logo_${name}.png`));
    console.log('  →', path.join(OUT, `ds_logo_${name}.png`));
  }
})();
