// 表情差分表 → 8 张独立透明头像
// 思路：泛洪抠背景（保留角色内部白色）→ 按行带 + 列间隙切成 8 格 → 反合成去灰边 → 输出 RGBA
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUTDIR = process.argv[3];
const AVATAR = parseInt(process.argv[4] || '256', 10);
const TOL = 34;

const NAMES = ['E01_开心大笑', 'E02_生气鼓脸', 'E03_委屈含泪', 'E04_惊讶',
  'E05_害羞脸红', 'E06_困倦打哈欠', 'E07_歪头思考', 'E08_傲娇得意'];

(async () => {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const at = (x, y) => (y * W + x) * C;

  // ---- 背景色：四边中位数 ----
  const cols = [];
  for (let x = 0; x < W; x += 3) { cols.push([0, x]); cols.push([H - 1, x]); }
  for (let y = 0; y < H; y += 3) { cols.push([y, 0]); cols.push([y, W - 1]); }
  const rgb = cols.map(([y, x]) => { const i = at(x, y); return [data[i], data[i + 1], data[i + 2]]; });
  rgb.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const bg = rgb[Math.floor(rgb.length / 2)];
  console.log('背景色', bg);

  const dist = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);

  // ---- 抹掉右下角水印（"AI生成 WORKBUDDY"）：水印是近白字，且不压在角色身上 ----
  // 只在右下角区域内、把明显亮于背景的低饱和像素填成背景色
  let wmCount = 0;
  const wmX0 = Math.floor(W * 0.88), wmY0 = Math.floor(H * 0.90);
  for (let y = wmY0; y < H; y++) {
    for (let x = wmX0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      if (lum > bg[0] + 12 && mx - mn < 30) {
        data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2];
        wmCount++;
      }
    }
  }
  console.log('水印清理像素', wmCount, `区域 x>=${wmX0} y>=${wmY0}`);

  // ---- 泛洪标记背景 ----
  const isBg = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) { st.push(x); st.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) {
    const p = st.pop();
    if (isBg[p]) continue;
    if (dist(p * C) > TOL) continue;
    isBg[p] = 1;
    const x = p % W, y = (p - x) / W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    if (y > 0) st.push(p - W);
    if (y < H - 1) st.push(p + W);
  }

  // ---- 前景行带（排除水印：水印在最底部独立小块） ----
  const rowFg = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (!isBg[y * W + x]) n++;
    rowFg[y] = n;
  }
  const MIN_ROW = Math.floor(W * 0.02);
  const bands = [];
  let y0 = -1;
  for (let y = 0; y < H; y++) {
    const on = rowFg[y] > MIN_ROW;
    if (on && y0 < 0) y0 = y;
    if ((!on || y === H - 1) && y0 >= 0) {
      const y1 = on ? y : y - 1;
      if (y1 - y0 > 40) bands.push([y0, y1]);
      y0 = -1;
    }
  }
  console.log('行带', bands);

  // ---- 每个行带切成 4 列：等分位置附近找「前景密度最低」的列作为分界 ----
  const cells = [];
  const COLS = 4;
  for (const [by0, by1] of bands) {
    const colFg = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = by0; y <= by1; y++) if (!isBg[y * W + x]) n++;
      colFg[x] = n;
    }
    // 分界点：k*W/4 附近 ±SEARCH 找密度最小列
    const SEARCH = Math.floor(W / COLS * 0.12);
    const cuts = [0];
    for (let k = 1; k < COLS; k++) {
      const c = Math.round(k * W / COLS);
      let bestX = c, bestV = Infinity;
      for (let x = Math.max(1, c - SEARCH); x <= Math.min(W - 2, c + SEARCH); x++) {
        const v = colFg[x] + colFg[x - 1] + colFg[x + 1];
        if (v < bestV) { bestV = v; bestX = x; }
      }
      cuts.push(bestX);
    }
    cuts.push(W - 1);
    console.log(`行带 ${by0}-${by1} 分界`, cuts);
    for (let k = 0; k < COLS; k++) {
      cells.push([cuts[k], by0, cuts[k + 1], by1]);
    }
  }

  if (cells.length !== 8) {
    console.error('!! 期望 8 格，实际', cells.length, '—— 请检查切分');
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  const PAD = 10;

  for (let k = 0; k < cells.length; k++) {
    let [cx0, cy0, cx1, cy1] = cells[k];
    // 精确 bbox（按列/行密度收缩，剔除邻格飘过来的细发丝）
    const colCnt = new Int32Array(cx1 - cx0 + 1);
    const rowCnt = new Int32Array(cy1 - cy0 + 1);
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        if (!isBg[y * W + x]) { colCnt[x - cx0]++; rowCnt[y - cy0]++; }
      }
    }
    const MIN_C = 3, MIN_R = 3;
    let a = 0, b = colCnt.length - 1;
    while (a < b && colCnt[a] < MIN_C) a++;
    while (b > a && colCnt[b] < MIN_C) b--;
    let c0 = 0, c1 = rowCnt.length - 1;
    while (c0 < c1 && rowCnt[c0] < MIN_R) c0++;
    while (c1 > c0 && rowCnt[c1] < MIN_R) c1--;
    let bx0 = cx0 + a, bx1 = cx0 + b, by0 = cy0 + c0, by1 = cy0 + c1;

    bx0 = Math.max(0, bx0 - PAD); by0 = Math.max(0, by0 - PAD);
    bx1 = Math.min(W - 1, bx1 + PAD); by1 = Math.min(H - 1, by1 + PAD);
    const cw = bx1 - bx0 + 1, chh = by1 - by0 + 1;

    const out = Buffer.alloc(cw * chh * 4);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = bx0 + x, sy = by0 + y;
        const p = sy * W + sx, i = p * C;
        const o = (y * cw + x) * 4;
        let a = 255;
        if (isBg[p]) a = 0;
        else {
          // 边界像素：用与背景的色差做软 alpha，并反合成去掉灰边
          let edge = false;
          if (sx > 0 && isBg[p - 1]) edge = true;
          else if (sx < W - 1 && isBg[p + 1]) edge = true;
          else if (sy > 0 && isBg[p - W]) edge = true;
          else if (sy < H - 1 && isBg[p + W]) edge = true;
          if (edge) {
            const d = dist(i);
            a = Math.max(0, Math.min(255, Math.round((d - 4) / 30 * 255)));
          }
        }
        if (a === 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
        // 反合成：pixel = color*a + bg*(1-a)
        const af = a / 255;
        const un = (v, b) => Math.max(0, Math.min(255, Math.round((v - b * (1 - af)) / af)));
        out[o] = un(data[i], bg[0]);
        out[o + 1] = un(data[i + 1], bg[1]);
        out[o + 2] = un(data[i + 2], bg[2]);
        out[o + 3] = a;
      }
    }

    const name = NAMES[k] || ('E' + (k + 1));
    const file = path.join(OUTDIR, `头像_${name}.png`);
    await sharp(out, { raw: { width: cw, height: chh, channels: 4 } }).png().toFile(file);

    // 归一化头像：缩放到 AVATAR 内，居中放方画布
    const scale = Math.min(AVATAR / cw, AVATAR / chh);
    const nw = Math.max(1, Math.round(cw * scale)), nh = Math.max(1, Math.round(chh * scale));
    const resized = await sharp(out, { raw: { width: cw, height: chh, channels: 4 } })
      .resize(nw, nh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    const left = Math.round((AVATAR - nw) / 2), top = Math.round((AVATAR - nh) / 2);
    await sharp({ create: { width: AVATAR, height: AVATAR, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: resized, left, top }]).png()
      .toFile(path.join(OUTDIR, `头像_${AVATAR}_${name}.png`));

    console.log(`  ${name} 裁剪 ${cw}x${chh} → ${file}`);
  }
  console.log('完成，输出', cells.length, '个');
})();
