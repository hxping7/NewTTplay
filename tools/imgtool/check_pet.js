// 宠物帧体检：洞 / 品红污染 两项硬指标（等价 tools/check_pet.py）
const fs = require('fs');
const path = require('path');

const DIR = 'D:/TTPlayer/.workbuddy/whaletmp/frames';
const F = 128;
const MAG = [255, 0, 255];

// 读 BMP（24bpp, 行自底向上, 4 字节对齐）→ 每帧 F×F×3 RGB
function readStrip(file) {
  const b = fs.readFileSync(file);
  const w = b.readInt32LE(18), h = b.readInt32LE(22);
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const n = w / F;
  const frames = [];
  for (let f = 0; f < n; f++) {
    const px = Buffer.alloc(F * F * 3);
    for (let y = 0; y < F; y++) {
      const srcRow = 54 + (h - 1 - y) * rowSize + f * F * 3;
      for (let x = 0; x < F; x++) {
        const si = srcRow + x * 3, di = (y * F + x) * 3;
        px[di] = b[si + 2];      // R
        px[di + 1] = b[si + 1];  // G
        px[di + 2] = b[si];      // B
      }
    }
    frames.push(px);
  }
  return frames;
}

const isMag = (r, g, b) => r === 255 && g === 0 && b === 255;
const isPolluted = (r, g, b) => g < 90 && r > 200 && b > 200 && !(r === 255 && g === 0 && b === 255);

function countHoles(px) {
  const seen = new Uint8Array(F * F);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || x >= F || y < 0 || y >= F) return;
    const i = y * F + x;
    if (seen[i]) return;
    if (!isMag(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])) return;
    seen[i] = 1; stack.push(i);
  };
  for (let x = 0; x < F; x++) { push(x, 0); push(x, F - 1); }
  for (let y = 0; y < F; y++) { push(0, y); push(F - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % F, y = (i / F) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  let total = 0, seenN = 0;
  for (let i = 0; i < F * F; i++) {
    if (isMag(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])) total++;
    if (seen[i]) seenN++;
  }
  return total - seenN;
}

let totH = 0, totP = 0, totF = 0;
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.bmp')).sort();
for (const f of files) {
  const frames = readStrip(path.join(DIR, f));
  let h = 0, p = 0;
  for (const px of frames) {
    h += countHoles(px);
    for (let i = 0; i < F * F; i++) {
      if (isPolluted(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])) p++;
    }
  }
  totH += h; totP += p; totF += frames.length;
  const bad = h || p ? '  <-- 有问题' : '';
  console.log(`${f.padEnd(14)} ${frames.length}帧  洞=${h}  渗色=${p}${bad}`);
}
console.log(`\n总计 ${totF} 帧  洞=${totH}  渗色=${totP}`);
console.log(totH === 0 && totP === 0 ? '✅ 体检通过' : '❌ 体检不通过');
