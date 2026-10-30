/**
 * 皮肤素材重绘管线
 *
 * 输入：AI 生成的透明底 PNG（1024 级）
 * 输出：24bpp BMP（品红键控），嵌入到 skin 的背景图与控件
 *
 * 关键约束（来自交付说明铁律）：
 *  - 皮肤位图是 24 位无 alpha，透明区用品红 #FF00FF 键控
 *  - 控件图必须与 XML 里声明的 position 尺寸完全一致
 *  - 背景图（player_skin 等）本身不透明，只有角色位需要抠图
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');

const ROOT = 'D:/TTPlayer/.workbuddy';
const SKIN = path.join(ROOT, 'skn_extract');
const WORK = path.join(ROOT, 'skinbuild');
const PY = 'python';
const BMP = path.join(ROOT, 'imgtool', 'bmp.py');

fs.mkdirSync(WORK, { recursive: true });

/** 抠图：从纯色底 PNG 提取角色，返回带 alpha 的 PNG 缓冲 */
async function cutout(srcPath, bgColor, tol = 34) {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const bg = bgColor;
  const near = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return Math.abs(r - bg.r) <= tol && Math.abs(g - bg.g) <= tol && Math.abs(b - bg.b) <= tol;
  };

  // 从边缘泛洪，只删真正连通的背景区（保护角色内部的同色区）
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    if (!near(i * 4)) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }

  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * 4, d = i * 4;
    if (seen[i]) {
      out[d] = 255; out[d + 1] = 0; out[d + 2] = 255; out[d + 3] = 0; // 抠掉
    } else {
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { buffer: await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer(), width, height };
}

/** 读取皮肤 BMP 为 {w,h,px} */
function readBmp(file) {
  const out = execFileSync(PY, [BMP, 'read', path.join(SKIN, file)], { encoding: 'utf8' }).trim();
  return JSON.parse(out);
}

/** 写 24bpp BMP */
function writeBmp(file, w, h, rgb) {
  const tmp = path.join(WORK, '_tmp_write.bmp');
  fs.writeFileSync(tmp, Buffer.from(rgb));
  // 通过 python 直接落盘（避免大 JSON 传输）
  const script = `
import sys
sys.path.insert(0, r'${path.join(ROOT, 'imgtool')}')
from bmp import write_bmp
w, h = ${w}, ${h}
rgb = bytes(open(r'${tmp}', 'rb').read())
write_bmp(r'${file}', w, h, rgb)
print('ok')
`;
  execFileSync(PY, ['-c', script], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
}

/** PNG → 24bpp BMP（品红键控），用 sharp 做 alpha 键控 */
async function pngToBmpMagenta(pngBuf, w, h) {
  const raw = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const s = i * 4, d = i * 3;
    if (raw[s + 3] < 128) {
      rgb[d] = 255; rgb[d + 1] = 0; rgb[d + 2] = 255;
    } else {
      rgb[d] = raw[s]; rgb[d + 1] = raw[s + 1]; rgb[d + 2] = raw[s + 2];
    }
  }
  return rgb;
}

module.exports = { cutout, readBmp, writeBmp, pngToBmpMagenta, SKIN, WORK, ROOT };
