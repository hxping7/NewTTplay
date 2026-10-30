// 精确定位 logo 眼睛: 先找白色眼窝连通块, 再在其中找暗像素(眼珠)
const sharp = require('sharp');

const SRC = 'C:/Users/Administrator/.workbuddy/clipboard-images/clipboard-2026-10-29T12-39-41-842Z-63ac5e40.png';

(async () => {
  const { width, height } = await sharp(SRC).metadata();
  const { data } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);
  const R = (x, y) => data[(y * width + x) * ch];
  const G = (x, y) => data[(y * width + x) * ch + 1];
  const B = (x, y) => data[(y * width + x) * ch + 2];

  const isBlue = (x, y) => (B(x, y) - R(x, y)) > 40;

  // 洪水填外部
  const outer = new Uint8Array(width * height);
  const st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (outer[y * width + x] || isBlue(x, y)) return;
    outer[y * width + x] = 1; st.push([x, y]);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (st.length) {
    const [x, y] = st.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 找内部白色块
  const lab = new Int32Array(width * height).fill(-1);
  const comps = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (outer[i] || isBlue(x, y) || lab[i] !== -1) continue;
    if (Math.min(R(x, y), G(x, y), B(x, y)) > 200) {  // 白色
      const id = comps.length;
      const cells = [];
      const q = [[x, y]];
      lab[i] = id;
      while (q.length) {
        const [cx, cy] = q.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (outer[ni] || isBlue(nx, ny) || lab[ni] !== -1) continue;
          if (Math.min(R(nx, ny), G(nx, ny), B(nx, ny)) > 200) { lab[ni] = id; q.push([nx, ny]); }
        }
      }
      comps.push(cells);
    }
  }
  comps.sort((a, b) => b.length - a.length);
  console.log('内部白色块数:', comps.length);

  comps.slice(0, 5).forEach((c, idx) => {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (const [x, y] of c) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    console.log(`  白块${idx}: ${c.length}px  x ${minX}..${maxX}  y ${minY}..${maxY}`);
    // 在该白块包围盒内找暗像素(眼珠)
    let dark = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const r = R(x, y), g = G(x, y), b = B(x, y);
      if (Math.min(r, g, b) < 140 && b - r < 60) dark.push([x, y, r, g, b]);
    }
    if (dark.length) {
      const dx = dark.map(p => p[0]), dy = dark.map(p => p[1]);
      console.log(`    → 内部暗像素 ${dark.length} 个, 范围 x ${Math.min(...dx)}..${Math.max(...dx)} y ${Math.min(...dy)}..${Math.max(...dy)}`);
      console.log(`    → 样例: ${dark.slice(0, 5).map(p => `(${p[0]},${p[1]})=${p[2]},${p[3]},${p[4]}`).join(' ')}`);
    }
  });
})();
