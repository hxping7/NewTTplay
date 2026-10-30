// 稳健矢量化方案:
//  1) 对每个类别做【多阈值】提取, 取一致性最高的结果
//  2) 用形态学(开运算/闭运算)去掉抗锯齿造成的碎片
//  3) 只保留最大连通块 + 显著小特征(眼珠)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-29T12-39-41-842Z-63ac5e40.png';
const OUT = 'D:/TTPlayer/.workbuddy/imgtool/whale_preview';

(async () => {
  const { width, height } = await sharp(SRC).metadata();
  const { data } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);
  const px = (x, y) => {
    const i = (y * width + x) * ch;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // ---- 外部白 vs 内部白: 洪水填充(可靠, 蓝是明确分隔带) ----
  const isStrongBlue = (x, y) => { const [r, g, b] = px(x, y); return b - r > 120 && g > 60; };
  const outer = new Uint8Array(width * height);
  const st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (outer[y * width + x] || isStrongBlue(x, y)) return;
    outer[y * width + x] = 1; st.push([x, y]);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (st.length) {
    const [x, y] = st.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // ---- 类别: 只做二分(蓝 / 非蓝), 白与非白靠"是否在外部"再分 ----
  // 主体蓝: 用"与主体色距离"但阈值放宽; 眼珠是灰蓝, 会落到"非蓝"侧
  const REF = [70, 104, 249];
  const cls = new Uint8Array(width * height);  // 1=主体蓝 2=内部白/灰 3=眼珠(更暗)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (outer[i]) { cls[i] = 0; continue; }
    const [r, g, b] = px(x, y);
    const mn = Math.min(r, g, b);
    const dRef = Math.hypot(r - REF[0], g - REF[1], b - REF[2]);
    const dWhite = 255 - mn;
    if (dWhite < 60) cls[i] = 2;            // 白
    else if (dRef < 95) cls[i] = 1;          // 主体蓝
    else if (mn < 205) cls[i] = 3;           // 暗灰(眼珠)
    else cls[i] = 2;
  }

  // ---- 形态学: 闭运算(填小洞) + 开运算(去毛刺) ----
  const morph = (arr, op, r = 1) => {
    const out = new Uint8Array(arr.length);
    const W = width;
    for (let y = 0; y < height; y++) for (let x = 0; x < W; x++) {
      let cnt = 0, tot = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= height) continue;
        tot++;
        if (arr[ny * W + nx]) cnt++;
      }
      const isSet = arr[y * W + x];
      out[y * W + x] = op === 'close'
        ? (cnt >= tot * 0.5 ? 1 : isSet)   // 闭: 内部空洞填上
        : (cnt >= tot * 0.35 ? 1 : 0);     // 开: 去掉零星毛刺
    }
    return out;
  };

  const blueMask = new Uint8Array(width * height);
  const whiteMask = new Uint8Array(width * height);
  const blackMask = new Uint8Array(width * height);
  for (let i = 0; i < cls.length; i++) {
    blueMask[i] = cls[i] === 1 ? 1 : 0;
    whiteMask[i] = cls[i] === 2 ? 1 : 0;
    blackMask[i] = cls[i] === 3 ? 1 : 0;
  }
  // 蓝色: 先开后闭(去毛刺再填洞); 白色: 只闭(填抗锯齿造成的洞)
  const blueClean = morph(morph(blueMask, 'open', 2), 'close', 2);
  const whiteClean = morph(whiteMask, 'close', 2);
  const blackClean = morph(blackMask, 'close', 1);

  // ---- 连通块: 只保留显著块 ----
  function components(mask, minSize) {
    const lab = new Int32Array(width * height).fill(-1);
    const comps = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i] || lab[i] !== -1) continue;
      const id = comps.length;
      const cells = [];
      const q = [[x, y]]; lab[i] = id;
      while (q.length) {
        const [cx, cy] = q.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (!mask[ni] || lab[ni] !== -1) continue;
          lab[ni] = id; q.push([nx, ny]);
        }
      }
      if (cells.length >= minSize) comps.push(cells);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  }

  const blueComps = components(blueClean, 500);
  const whiteComps = components(whiteClean, 200);
  const blackComps = components(blackClean, 30);
  console.log('蓝块:', blueComps.map(c => c.length).join(','));
  console.log('白块:', whiteComps.map(c => c.length).join(','));
  console.log('黑块:', blackComps.map(c => c.length).join(','));

  // ---- 轮廓追踪 (Moore, 修正版) ----
  function trace(cells) {
    const set = new Set(cells.map(([x, y]) => y * width + x));
    const has = (x, y) => set.has(y * width + x);
    // 起点: 最上方一行中最左的像素, 从其左邻开始逆时针
    let sy = 1e9, sx = -1;
    for (const [x, y] of cells) if (y < sy || (y === sy && x < sx)) { sy = y; sx = x; }
    // 从起点左边的点出发搜(保证方向正确)
    let cx = sx, cy = sy, dir = 0;
    const D = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    // 找起点左邻是否在集合内
    const startAt = has(sx - 1, sy) ? [sx - 1, sy] : [sx, sy];
    cx = startAt[0]; cy = startAt[1];
    // 初始搜索方向: 从"上方"逆时针开始
    const contour = [];
    const first = [cx, cy];
    let guard = 0;
    const startKey = cy * width + cx;
    do {
      contour.push([cx, cy]);
      let moved = false;
      for (let k = 0; k < 8; k++) {
        const d = (dir + 6 + k) % 8;   // 从 dir-2 开始逆时针
        const nx = cx + D[d][0], ny = cy + D[d][1];
        if (has(nx, ny)) { cx = nx; cy = ny; dir = d; moved = true; break; }
      }
      if (!moved) break;
      guard++;
    } while ((cy * width + cx) !== startKey && guard < cells.length * 4 + 100);
    return contour;
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const st2 = [[0, pts.length - 1]];
    while (st2.length) {
      const [s, e] = st2.pop();
      let maxD = 0, idx = -1;
      const [ax, ay] = pts[s], [bx, by] = pts[e];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = s + 1; i < e; i++) {
        const [qx, qy] = pts[i];
        const d = Math.abs(dy * qx - dx * qy + bx * ay - by * ax) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; st2.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // 归一化到 723x549
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (const [x, y] of blueComps[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const VW = 723, VH = 549;
  const sc = Math.min(VW / (maxX - minX + 1), VH / (maxY - minY + 1));
  const ox = (VW - (maxX - minX + 1) * sc) / 2;
  const oy = (VH - (maxY - minY + 1) * sc) / 2;
  const map = ([x, y]) => [(x - minX) * sc + ox, (y - minY) * sc + oy];

  const toPath = (cells, eps) => {
    const c = trace(cells);
    if (c.length < 3) return '';
    const pts = rdp(c, eps).map(map);
    if (pts.length < 3) return '';
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
    return d + ' Z';
  };

  const paths = [];
  for (const c of blueComps.slice(0, 2)) { const d = toPath(c, 0.7); if (d) paths.push({ d, fill: '#4568F9' }); }
  for (const c of whiteComps.slice(0, 3)) { const d = toPath(c, 0.7); if (d) paths.push({ d, fill: '#FFFFFF' }); }
  for (const c of blackComps.slice(0, 2)) { const d = toPath(c, 0.5); if (d) paths.push({ d, fill: '#121212' }); }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">
${paths.map(p => `  <path d="${p.d}" fill="${p.fill}"/>`).join('\n')}
</svg>`;
  fs.writeFileSync(path.join(OUT, 'ds_logo_vector.svg'), svg);
  console.log('路径数:', paths.length);
  await sharp(Buffer.from(svg)).resize({ width: 723 }).png().toFile(path.join(OUT, 'ds_logo_vector.png'));
  console.log('渲染:', path.join(OUT, 'ds_logo_vector.png'));
})();
