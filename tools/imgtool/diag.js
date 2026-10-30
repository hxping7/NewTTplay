// 洞位置诊断：导出标注图
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR = 'D:/TTPlayer/.workbuddy/whaletmp/frames';
const F = 128;
const isMag = (r, g, b) => r === 255 && g === 0 && b === 255;

function readBMP(file) {
  const b = fs.readFileSync(file);
  const w = b.readInt32LE(18), h = b.readInt32LE(22);
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 3, di = (y * w + x) * 3;
      px[di] = b[54 + si + 2]; px[di + 1] = b[54 + si + 1]; px[di + 2] = b[54 + si];
    }
  }
  return { px, w, h };
}

(async () => {
  for (const name of ['idle', 'ktv', 'swim']) {
    const { px, w } = readBMP(path.join(DIR, name + '.bmp'));
    const n = w / F;
    const comps = [];
    for (let f = 0; f < n; f++) {
      const ox = f * F;
      const seen = new Uint8Array(F * F);
      const st = [];
      const push = (x, y) => {
        if (x < 0 || x >= F || y < 0 || y >= F) return;
        const j = y * F + x;
        if (seen[j]) return;
        const idx = (y * w + ox + x) * 3;
        if (!isMag(px[idx], px[idx + 1], px[idx + 2])) return;
        seen[j] = 1; st.push(j);
      };
      for (let x = 0; x < F; x++) { push(x, 0); push(x, F - 1); }
      for (let y = 0; y < F; y++) { push(0, y); push(F - 1, y); }
      while (st.length) {
        const j = st.pop();
        push((j % F) - 1, (j / F) | 0); push((j % F) + 1, (j / F) | 0);
        push(j % F, ((j / F) | 0) - 1); push(j % F, ((j / F) | 0) + 1);
      }
      // 标记洞为红色
      const out = Buffer.alloc(F * F * 3);
      let holeCount = 0;
      const holeList = [];
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < F; x++) {
          const j = y * F + x;
          const idx = (y * w + ox + x) * 3;
          const di = j * 3;
          const isHole = !seen[j] && isMag(px[idx], px[idx + 1], px[idx + 2]);
          if (isHole) { out[di] = 255; out[di + 1] = 0; out[di + 2] = 0; holeCount++; holeList.push([x, y]); }
          else { out[di] = px[idx]; out[di + 1] = px[idx + 1]; out[di + 2] = px[idx + 2]; }
        }
      }
      if (holeList.length) {
        const xs = holeList.map(p => p[0]), ys = holeList.map(p => p[1]);
        console.log(`${name} frame${f}: ${holeCount} 洞, x范围[${Math.min(...xs)},${Math.max(...xs)}] y范围[${Math.min(...ys)},${Math.max(...ys)}]`);
      }
      comps.push({ input: Buffer.from(out), raw: { width: F, height: F, channels: 3 }, left: f * F, top: 0 });
    }
    await sharp({ create: { width: F * n, height: F, channels: 3, background: { r: 40, g: 40, b: 40 } } })
      .composite(comps).png().toFile(`D:/TTPlayer/.workbuddy/imgtool/diag_${name}.png`);
  }
})();
