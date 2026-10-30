// 通用抠图：边缘自适应泛洪（自动采样背景色，支持渐变白背景）
// 修 skin_build 用固定 bg 色导致渐变白背景抠不干净的问题
const sharp = require('sharp');

/** 从图像四边采样，聚类出背景色候选 */
function collectBgColors(data, W, H, ch) {
  const pts = [];
  const add = (x, y) => {
    const i = (y * W + x) * ch;
    pts.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < W; x++) { add(x, 0); add(x, 1); add(x, H - 1); add(x, H - 2); }
  for (let y = 0; y < H; y++) { add(0, y); add(1, y); add(W - 1, y); add(W - 2, y); }
  // 量化后聚类，保留出现次数 >= 阈值的簇
  const map = new Map();
  for (const [r, g, b] of pts) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (!map.has(key)) map.set(key, { n: 0, r: 0, g: 0, b: 0 });
    const c = map.get(key);
    c.n++; c.r += r; c.g += g; c.b += b;
  }
  const minN = Math.max(4, Math.floor(pts.length * 0.01));
  const out = [];
  for (const c of map.values()) {
    if (c.n < minN) continue;
    const col = { r: c.r / c.n, g: c.g / c.n, b: c.b / c.n };
    if (!out.some(o => Math.hypot(o.r - col.r, o.g - col.g, o.b - col.b) < 14)) out.push(col);
  }
  return out;
}

/** 边缘泛洪：只删与边缘连通且颜色属于背景候选簇的像素 */
function floodBg(data, W, H, ch, bgColors, tol) {
  const n = W * H;
  const bg = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  const isBg = (i) => {
    const p = i * ch;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    for (const c of bgColors) {
      if (Math.abs(r - c.r) <= tol && Math.abs(g - c.g) <= tol && Math.abs(b - c.b) <= tol) return true;
    }
    return false;
  };
  const push = (i) => { if (bg[i]) return; if (!isBg(i)) return; bg[i] = 1; q[qt++] = i; };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  return bg;
}

/**
 * 抠图：返回 { buffer(PNG RGBA), width, height }
 * @param srcPath 源图路径或 Buffer
 * @param opts.bgColor 固定背景色（可选）；不传则边缘自适应采样
 * @param opts.tol 容差（欧氏距离上限）
 */
async function cutoutAdaptive(srcPath, opts = {}) {
  const tol = opts.tol ?? 24;
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });  const { width: W, height: H, channels: ch } = info;
  let bgColors;
  if (opts.bgColor) bgColors = [opts.bgColor];
  else bgColors = collectBgColors(data, W, H, ch);
  if (!bgColors.length) bgColors = [{ r: 255, g: 255, b: 255 }];
  const bg = floodBg(data, W, H, ch, bgColors, tol);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const s = i * ch, d = i * 4;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
    out[d + 3] = bg[i] ? 0 : 255;
  }
  return {
    buffer: await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(),
    width: W, height: H,
  };
}

module.exports = { cutoutAdaptive, collectBgColors, floodBg };
