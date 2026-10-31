// walk 反相摆帧合成: L05_walk_1..3 的「碗+手臂」区域绕身体中轴水平镜像 → L05_walk_4..6
// 用途: 走路 12 相位完整步循环(右摆→回中→左摆→回中)。改参数后重跑本脚本再跑 gen_pet_bmp.js
// 管线: 矩形裁剪 → 水平镜像 → 羽化贴回; M3 摆幅大, 另用 M1 同区域补丁盖掉原碗残留
const sharp = require('sharp');
const path = require('path');
const SRC = 'D:/TTPlayer/jingyu-niang-assets/frames';
const FEATHER = 24;

// 对称矩形(关于 cx): 镜像后恰好完全覆盖原区域, 无残留
const SYMMETRIC = [
  { src: 'L05_walk_1', rect: [525, 555, 765, 725], cx: 645, out: 'L05_walk_4' },
  { src: 'L05_walk_2', rect: [510, 545, 790, 735], cx: 650, out: 'L05_walk_5' },
];
// M3: 窄矩形只镜像碗+手, 残留区用 L05_walk_4 补丁
const M3 = { src: 'L05_walk_3', rect: [620, 555, 840, 705], cx: 655, out: 'L05_walk_6', donor: 'L05_walk_4' };

async function loadRaw(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
function featherPaste(dst, donor, rx, ry, rw, rh, feather) {
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const fx = Math.min(x, rw - 1 - x) / feather, fy = Math.min(y, rh - 1 - y) / feather;
    const a = Math.max(0, Math.min(1, Math.min(fx, fy)));
    if (a <= 0) continue;
    const si = (y * rw + x) * 4, di = ((ry + y) * dst.w + (rx + x)) * 4;
    for (let c = 0; c < 3; c++)
      dst.data[di + c] = (donor.data[si + c] * a + dst.data[di + c] * (1 - a)) | 0;
    dst.data[di + 3] = Math.max(dst.data[di + 3], (donor.data[si + 3] * a) | 0);
  }
}
async function mirrorRegion(img, [x0, y0, x1, y1], cx) {
  const rw = x1 - x0, rh = y1 - y0;
  const crop = Buffer.alloc(rw * rh * 4);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const si = ((y0 + y) * img.w + (x0 + x)) * 4, di = (y * rw + x) * 4;
    crop[di] = img.data[si]; crop[di + 1] = img.data[si + 1];
    crop[di + 2] = img.data[si + 2]; crop[di + 3] = img.data[si + 3];
  }
  const flipped = await sharp(crop, { raw: { width: rw, height: rh, channels: 4 } }).flop().raw().toBuffer();
  return { data: flipped, w: rw, h: rh, dx0: 2 * cx - x1, y0, rw, rh };
}
(async () => {
  const cache = {};
  const get = async n => (cache[n] ||= await loadRaw(path.join(SRC, n + '.png')));
  for (const sp of SYMMETRIC) {
    const img = await get(sp.src);
    const m = await mirrorRegion(img, sp.rect, sp.cx);
    featherPaste(img, m, m.dx0, m.y0, m.rw, m.rh, FEATHER);
    await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
      .png().toFile(path.join(SRC, sp.out + '.png'));
    console.log('ok:', sp.out);
  }
  { // M3 = 窄矩形镜像 + 残碗补丁
    const sp = M3;
    const img = await get(sp.src);
    const m = await mirrorRegion(img, sp.rect, sp.cx);
    featherPaste(img, m, m.dx0, m.y0, m.rw, m.rh, FEATHER);
    const donor = await get(sp.donor);
    const px0 = Math.max(m.dx0 + m.rw - 12, 0), pw = sp.rect[2] - px0;
    const patch = Buffer.alloc(pw * m.rh * 4);
    for (let y = 0; y < m.rh; y++) for (let x = 0; x < pw; x++) {
      const si = ((m.y0 + y) * donor.w + (px0 + x)) * 4, di = (y * pw + x) * 4;
      patch[di] = donor.data[si]; patch[di + 1] = donor.data[si + 1];
      patch[di + 2] = donor.data[si + 2]; patch[di + 3] = donor.data[si + 3];
    }
    featherPaste(img, { data: patch, w: pw, h: m.rh }, px0, m.y0, pw, m.rh, 14);
    await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
      .png().toFile(path.join(SRC, sp.out + '.png'));
    console.log('ok:', sp.out, '(patch x0=' + px0 + ' pw=' + pw + ')');
  }
})();
