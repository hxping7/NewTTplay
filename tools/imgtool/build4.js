// 鲸鱼娘「摇尾巴跳舞」L18 —— 8 帧相位循环
// 沿用 build3.js 的成熟管线：泛洪抠图 → 同循环统一缩放系数 → 统一画布 → 底部基线对齐
// 本组额外的动效设计（针对 128px 实际显示尺寸）：
//   1) 手臂位走「垂 → 肩 → 举 → 举 → 肩 → 肩 → 垂 → 垂」的高低循环
//   2) 尾巴左右大幅扫动（这是本组动效主体，Q版裙摆遮腿，尾巴是最强可读信号）
//   3) 身体绕脚底支点小角度左右摆（钟摆式），制造舞感
//   4) 两帧轻微上提，模拟跳舞的弹跳
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');

const SRC = 'D:/TTPlayer/jingyu-niang-design_assets/dance_src';
const OUT = 'D:/TTPlayer/jingyu-niang-assets';

const TOL = 20;
const FLAT_MIN_COUNT = 30;
const CW = 1200;       // 统一画布宽（留出摆幅）
const CH = 940;        // 统一画布高
const TARGET_H = 860;  // 角色最大帧的目标高度
const FPS = 150;       // 8 帧循环节奏

function collectFlatColors(data, width, height, channels) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * channels;
    const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, 1); add(x, height - 1); add(x, height - 2); }
  for (let y = 0; y < height; y++) { add(0, y); add(1, y); add(width - 1, y); add(width - 2, y); }
  const cand = [];
  for (const [key, cnt] of counts) {
    if (cnt < FLAT_MIN_COUNT) continue;
    const c = { r: ((key >> 10) & 31) * 8 + 4, g: ((key >> 5) & 31) * 8 + 4, b: (key & 31) * 8 + 4 };
    if (!cand.some(o => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) < 16)) cand.push(c);
  }
  return cand;
}

function floodBackground(data, width, height, channels, flatColors) {
  const n = width * height;
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const isFlat = (i) => {
    const p = i * channels;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    for (const c of flatColors) if (Math.hypot(r - c.r, g - c.g, b - c.b) <= TOL) return true;
    return false;
  };
  const push = (i) => { if (bg[i]) return; if (!isFlat(i)) return; bg[i] = 1; queue[qt++] = i; };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % width, y = (i / width) | 0;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  return bg;
}

function bboxOf(raw, width, height) {
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[(y * width + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1, maxY };
}

// 绕脚底支点旋转（钟摆式倾倒），制造跳舞的身体摆动
function rotateBuffer(buf, w, h, deg, pivot) {
  if (!deg) return { raw: buf, width: w, height: h };
  const rad = (deg * Math.PI) / 180;
  const cs = Math.cos(rad), sn = Math.sin(rad);
  const px = w / 2;
  const py = pivot === 'top' ? 0 : h;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [cx, cy] of corners) {
    const dx = cx - px, dy = cy - py;
    const rx = px + dx * cs - dy * sn;
    const ry = py + dx * sn + dy * cs;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  }
  const ow = Math.ceil(maxX - minX), oh = Math.ceil(maxY - minY);
  const out = Buffer.alloc(ow * oh * 4);
  const shiftX = minX, shiftY = minY;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const tx = x + shiftX, ty = y + shiftY;
      const dx = tx - px, dy = ty - py;
      const sx = px + dx * cs + dy * sn;
      const sy = py - dx * sn + dy * cs;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const fx = sx - x0, fy = sy - y0;
      const di = (y * ow + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = (y0 * w + x0) * 4 + c;
        const p10 = (y0 * w + x1) * 4 + c;
        const p01 = (y1 * w + x0) * 4 + c;
        const p11 = (y1 * w + x1) * 4 + c;
        const v = (buf[p00] * (1 - fx) + buf[p10] * fx) * (1 - fy) +
                  (buf[p01] * (1 - fx) + buf[p11] * fx) * fy;
        out[di + c] = Math.round(v);
      }
    }
  }
  return { raw: out, width: ow, height: oh };
}

async function cutoutRaw(file) {
  const meta = await sharp(file).metadata();
  const ch = Math.min(meta.height, CH);
  const { data, info } = await sharp(file)
    .extract({ left: 0, top: 0, width: Math.min(meta.width, CW), height: ch })
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const flat = collectFlatColors(data, width, height, channels);
  const bgMask = floodBackground(data, width, height, channels, flat);
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const si = i * channels, di = i * 4;
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2];
    out[di + 3] = bgMask[i] ? 0 : 255;
  }
  return { raw: out, width, height };
}

// 取「中央条带」内的内容底部作为基线锚点
// 理由：整体包围盒底部可能是甩出去的尾巴尖，用它对齐会把角色双脚抬离地面；
//      中央条带（裙摆/双脚）才是真正踩地的部分。
function bottomAnchorOf(raw, width, height) {
  const b = bboxOf(raw, width, height);
  const cx = b.minX + b.w / 2;
  const half = Math.max(4, Math.floor(b.w * 0.16));
  let maxY = -1;
  for (let x = Math.max(0, Math.floor(cx - half)); x <= Math.min(width - 1, Math.ceil(cx + half)); x++) {
    for (let y = height - 1; y >= 0; y--) {
      if (raw[(y * width + x) * 4 + 3] > 40) { if (y > maxY) maxY = y; break; }
    }
  }
  return maxY < 0 ? b.maxY : maxY;
}

// 取「中央条带」内的内容水平中心作为水平锚点
// 理由：整体包围盒中心会被甩出去的尾巴带偏，导致角色左右漂移；
//      中央条带（裙摆/身体）才是角色本体，尾巴应当绕它甩动。
function centerAnchorOf(raw, width, height) {
  const b = bboxOf(raw, width, height);
  const cx = b.minX + b.w / 2;
  const half = Math.max(4, Math.floor(b.w * 0.16));
  let sum = 0, n = 0;
  for (let x = Math.max(0, Math.floor(cx - half)); x <= Math.min(width - 1, Math.ceil(cx + half)); x++) {
    for (let y = b.minY; y <= b.maxY; y++) {
      if (raw[(y * width + x) * 4 + 3] > 40) { sum += x; n++; }
    }
  }
  return n ? sum / n : cx;
}

// 主体高度：只量中央条带内，从头顶到裙摆底的高度（排除甩出去的尾巴）
// 用它做统一缩放基准，角色大小才不会随尾巴甩动而忽大忽小。
function bodyHeightOf(raw, width, height) {
  const b = bboxOf(raw, width, height);
  const cx = b.minX + b.w / 2;
  const half = Math.max(4, Math.floor(b.w * 0.16));
  let top = -1, bot = -1;
  for (let x = Math.max(0, Math.floor(cx - half)); x <= Math.min(width - 1, Math.ceil(cx + half)); x++) {
    for (let y = 0; y < height; y++) {
      if (raw[(y * width + x) * 4 + 3] > 40) { if (top < 0) top = y; break; }
    }
    for (let y = height - 1; y >= 0; y--) {
      if (raw[(y * width + x) * 4 + 3] > 40) { if (bot < 0) bot = y; break; }
    }
  }
  if (top < 0 || bot < 0) return b.h;
  return bot - top + 1;
}

async function placeFrame(raw, width, height, scale, lift, rotDeg) {
  const b = bboxOf(raw, width, height);
  const nw = Math.max(1, Math.round(b.w * scale));
  const nh = Math.max(1, Math.round(b.h * scale));
  const scaled = await sharp(raw, { raw: { width, height, channels: 4 } })
    .extract({ left: b.minX, top: b.minY, width: b.w, height: b.h })
    .resize({ width: nw, height: nh, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const r = rotateBuffer(scaled.data, nw, nh, rotDeg, 'bottom');
  const out = Buffer.alloc(CW * CH * 4);
  // 水平：按中央条带中心对齐到画布中心（尾巴可以自由甩出去）
  // 垂直：按中央条带底部对齐基线（保证双脚踩地）
  const anchorX = centerAnchorOf(r.raw, r.width, r.height);
  const anchorY = bottomAnchorOf(r.raw, r.width, r.height);
  const offX = Math.round(CW / 2 - anchorX);
  const offY = Math.round(CH - lift - anchorY);
  for (let y = 0; y < r.height; y++) {
    const dy = y + offY;
    if (dy < 0 || dy >= CH) continue;
    for (let x = 0; x < r.width; x++) {
      const dx = x + offX;
      if (dx < 0 || dx >= CW) continue;
      const si = (y * r.width + x) * 4;
      const a = r.raw[si + 3];
      if (a === 0) continue;
      const di = (dy * CW + dx) * 4;
      out[di] = r.raw[si]; out[di + 1] = r.raw[si + 1]; out[di + 2] = r.raw[si + 2];
      out[di + 3] = a;
    }
  }
  return { raw: out, width: CW, height: CH, bbox: bboxOf(out, CW, CH) };
}

// ==== 8 帧相位定义 ====
// rot: 绕脚底支点旋转（度），负=左倾，正=右倾
// lift: 整体上移像素（跳舞的弹跳）
// 选帧依据（尾尖 y 坐标，数值越小=尾巴甩得越高）：
//   高位尾 f3(421) f5(419) · 中位 f1(548) x_tail_right_up(548)
//   低位尾 f8(652) x_tail_left_down(664) f6(623)
// 相位设计：
//   手臂  垂 → 肩 → 举 → 举 → 肩 → 肩 → 垂 → 垂   （一轮完整起伏）
//   尾巴  低 → 低 → 中 → 高 → 高 → 中 → 低 → 低   （一轮完整上下弧线）
//   身体  中 → 左倾 → 中 → 中 → 右倾 → 中 → 左倾 → 中
//   弹跳  第 2、3 帧轻微上提（举手时顺势起跳）
const LOOP = {
  id: 'L18_dance', label: '摇尾巴跳舞', fps: FPS,
  frames: [
    { file: 'x_tail_left_down.png', rot: 0,  lift: 0  },  // 0 垂手 · 尾低位
    { file: 'f8.png',              rot: -5, lift: 0  },  // 1 垂手 · 尾低位 · 左倾
    { file: 'y_down_shoulder.png', rot: 0,  lift: 14 },  // 2 肩侧 · 尾中位 · 起跳
    { file: 'f5.png',              rot: 0,  lift: 14 },  // 3 肩侧 · 尾高位
    { file: 'z_shoulder_tailup.png', rot: 5, lift: 0  },  // 4 肩侧 · 尾上翘 · 右倾
    { file: 'x_tail_right_up.png', rot: 0,  lift: 0  },  // 5 高举 · 尾高位
    { file: 'n_shoulder_up.png',   rot: -5, lift: 0  },  // 6 高举 · 尾中位 · 左倾
    { file: 'n_down_up.png',       rot: 0,  lift: 0  },  // 7 垂手 · 尾后（接回 0）
  ],
};

async function main() {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const L = LOOP;

  const raws = [];
  for (const fr of L.frames) raws.push(await cutoutRaw(path.join(SRC, fr.file)));
  const boxes = raws.map(r => bboxOf(r.raw, r.width, r.height));
  // 统一缩放系数：按【主体高度】归一（不是整体包围盒高度），
  // 否则尾巴甩得远的帧会显得角色偏小
  const bodyHs = raws.map(r => bodyHeightOf(r.raw, r.width, r.height));
  const maxBodyH = Math.max(...bodyHs);
  const scale = TARGET_H / maxBodyH;

  const placed = [];
  for (let i = 0; i < raws.length; i++) {
    const fr = L.frames[i];
    const p = await placeFrame(raws[i].raw, raws[i].width, raws[i].height, scale, fr.lift, fr.rot);
    placed.push(p);
    await sharp(p.raw, { raw: { width: CW, height: CH, channels: 4 } })
      .png().toFile(path.join(OUT, 'frames', `${L.id}_${i}.png`));
  }
  console.log(`scale=${scale.toFixed(4)}`);
  console.log(`bodyH=[${bodyHs.join(',')}]`);
  console.log(`placedH=[${placed.map(f => f.bbox.h).join(',')}]`);
  console.log(`placedBottom=[${placed.map(f => f.bbox.maxY).join(',')}]`);

  // 横排条带预览（用于检查帧间衔接）
  const FW = 260;
  const bufs = [];
  for (const f of placed) {
    bufs.push(await sharp(f.raw, { raw: { width: CW, height: CH, channels: 4 } })
      .resize({ width: FW, height: FW, fit: 'inside' }).png().toBuffer());
  }
  const metas = [];
  for (const b of bufs) metas.push(await sharp(b).metadata());
  const stripH = Math.max(...metas.map(m => m.height));
  const stripComps = bufs.map((b, i) => ({ input: b, left: i * FW + Math.floor((FW - metas[i].width) / 2), top: 0 }));
  await sharp({ create: { width: bufs.length * FW, height: stripH, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
    .composite(stripComps).png().toFile(path.join(OUT, `鲸鱼娘循环_${L.id}_${L.label}.png`));
  console.log('strip ok');

  // 128px 实际显示尺寸条带（桌宠验收：动效必须在这个尺寸下可读）
  const TW = 128;
  const tbufs = [];
  for (const f of placed) {
    tbufs.push(await sharp(f.raw, { raw: { width: CW, height: CH, channels: 4 } })
      .resize({ width: TW, height: TW, fit: 'inside' }).png().toBuffer());
  }
  const tmetas = [];
  for (const b of tbufs) tmetas.push(await sharp(b).metadata());
  const tStripH = Math.max(...tmetas.map(m => m.height));
  const tComps = tbufs.map((b, i) => ({ input: b, left: i * TW + Math.floor((TW - tmetas[i].width) / 2), top: 0 }));
  await sharp({ create: { width: tbufs.length * TW, height: tStripH, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
    .composite(tComps).png().toFile('D:/TTPlayer/.workbuddy/imgtool/_dance_128.png');
  console.log('128px strip ok');

  // 循环 GIF
  const frames = [];
  for (const f of placed) {
    frames.push(await sharp(f.raw, { raw: { width: CW, height: CH, channels: 4 } })
      .resize({ width: FW, height: FW, fit: 'inside' }).ensureAlpha()
      .raw().toBuffer({ resolveWithObject: true }));
  }
  const gw = frames[0].info.width, gh = frames[0].info.height;
  const enc = new GIFEncoder(gw, gh);
  enc.start();
  enc.setRepeat(0);
  enc.setDelay(L.fps);
  enc.setTransparent(0x000000);
  enc.setDispose(2);
  for (const r of frames) enc.addFrame(r.data);
  enc.finish();
  fs.writeFileSync(path.join(OUT, `鲸鱼娘循环_${L.id}_${L.label}.gif`), Buffer.from(enc.out.getData()));
  console.log('gif ok:', L.id);
}

main().catch(e => { console.error(e); process.exit(1); });
