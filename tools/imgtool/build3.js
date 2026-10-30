// 鲸鱼娘 二期：7 个新状态动画循环（happy/feed/greet/drag/shy/think/proud）
// 关键处理：
//   1) 泛洪抠图去背景
//   2) 同一循环内所有帧使用【统一缩放系数】（按该循环最高帧归一），保证角色体型不跳变
//   3) 统一画布 + 底部基线对齐，保证循环时脚底不漂移
//   4) 跳跃类循环可用 lift 数组给特定帧额外的向上偏移（模拟离地高度）
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');

const SRC = 'D:/TTPlayer/jingyu-niang-design_assets';
const GEN = 'D:/TTPlayer/jingyu-niang-design_assets/gen2';
const OUT = 'D:/TTPlayer/jingyu-niang-assets';

const TOL = 20;
const FLAT_MIN_COUNT = 30;
const CW = 1200;      // 统一画布宽（留出旋转摆幅）
const CH = 940;       // 统一画布高
const TARGET_H = 860; // 角色最大帧的目标高度（留出头顶/脚下余量）
const TOP_ANCHOR = 40; // 被拎起状态：悬挂点固定高度

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

// 自实现带支点旋转（双线性采样）。
// pivot='top'    → 绕双手悬挂点转：角色被拎起左右摇摆，腿和尾巴甩动（悬挂点固定）
// pivot='bottom' → 绕脚底中心转：整体像钟摆倾倒
// 返回 offX/offY：旋转后画布左上角在原始坐标系中的位置
function rotateBuffer(buf, w, h, deg, pivot) {
  if (!deg) return { raw: buf, width: w, height: h, offX: 0, offY: 0 };
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
  // 注意：输出像素 (x,y) 对应正向旋转后的坐标 (x+minX, y+minY)
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
  return { raw: out, width: ow, height: oh, offX: minX, offY: minY };
}

// 把抠图结果按【统一缩放系数】缩放，贴到统一画布。
// anchor='bottom' → 角色底部对齐基线（lift>0 整体上移，模拟离地）
// anchor='top'    → 角色悬挂点固定在同一高度（被拎起摇摆用）
async function placeFrame(raw, width, height, scale, lift, rotDeg, rotPivot, anchor) {
  const b = bboxOf(raw, width, height);
  const nw = Math.max(1, Math.round(b.w * scale));
  const nh = Math.max(1, Math.round(b.h * scale));
  const scaled = await sharp(raw, { raw: { width, height, channels: 4 } })
    .extract({ left: b.minX, top: b.minY, width: b.w, height: b.h })
    .resize({ width: nw, height: nh, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const r = rotateBuffer(scaled.data, nw, nh, rotDeg, rotPivot);

  const out = Buffer.alloc(CW * CH * 4);
  // 旋转后重新求内容包围盒，据此居中 / 对齐，避免出画布或偏位
  const rb = bboxOf(r.raw, r.width, r.height);
  let offX, offY;
  if (anchor === 'top') {
    // 悬挂点固定：内容顶端（双手）对齐到固定高度，水平居中
    offX = Math.round(CW / 2 - (rb.minX + rb.w / 2));
    offY = Math.round(TOP_ANCHOR - rb.minY);
  } else {
    offX = Math.round(CW / 2 - (rb.minX + rb.w / 2));   // 按内容水平居中
    offY = Math.round(CH - lift - rb.maxY);              // 按内容底部对齐基线
  }
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

const LOOPS = [
  {
    id: 'L11_happy', label: '高兴欢呼', fps: 170,
    frames: [
      { from: 'gen', file: 'happy_0.png' },
      { from: 'gen', file: 'happy_1.png' },
      { from: 'gen', file: 'happy_2.png' },
      { from: 'gen', file: 'happy_3.png' },
    ],
    // 跳跃：第2帧最高点整体上移，第3帧落地
    lift: [0, 26, 62, 0],
  },
  {
    id: 'L12_feed', label: '被投喂', fps: 240,
    frames: [
      { from: 'src', file: '9501ffd9-miora_edit_image-1793155256402-0-667dc626cd86.png' },
      { from: 'gen', file: 'feed_1.png' },
      { from: 'gen', file: 'feed_2.png' },
    ],
    lift: [0, 0, 0],
  },
  {
    id: 'L13_greet', label: '问候', fps: 180,
    frames: [
      { from: 'src', file: 'e63d45c7-miora_edit_image-1793150571963-0-bd908b933a6f.png' },
      { from: 'gen', file: 'greet_1.png' },
      { from: 'gen', file: 'greet_2.png' },
    ],
    lift: [0, 0, 0],
  },
  {
    id: 'L14_drag', label: '被拖拽', fps: 130,
    frames: [
      { from: 'src', file: '3b68e751-miora_edit_image-1793155290454-0-e8a97dc72b07.png' },
      { from: 'gen', file: 'drag_1.png' },
      { from: 'gen', file: 'drag_2.png' },
    ],
    // 被拎起晃动：双手悬挂点固定，身体像钟摆左右摆
    lift: [0, 0, 0],
    rot: [0, -8, 8],
    rotPivot: 'top',
    anchor: 'top',
  },
  {
    id: 'L15_shy', label: '害羞', fps: 200,
    frames: [
      { from: 'src', file: '17d3b066-miora_edit_image-1793155322151-0-98d8fa01040d.png' },
      { from: 'gen', file: 'shy_1.png' },
      { from: 'gen', file: 'shy_2.png' },
    ],
    lift: [0, 0, 0],
  },
  {
    id: 'L16_think', label: '思考', fps: 260,
    frames: [
      { from: 'src', file: '5a824150-miora_edit_image-1793155347225-0-f1d3b51e6066.png' },
      { from: 'gen', file: 'think_1.png' },
      { from: 'gen', file: 'think_2.png' },
    ],
    lift: [0, 0, 0],
  },
  {
    id: 'L17_proud', label: '傲娇得意', fps: 200,
    frames: [
      { from: 'src', file: '420c35f8-miora_edit_image-1793155374411-0-f99ebf3127fe.png' },
      { from: 'gen', file: 'proud_1.png' },
      { from: 'gen', file: 'proud_2.png' },
    ],
    lift: [0, 0, 0],
    rot: [0, 0, 0],
    rotPivot: 'bottom',
  },
];

async function main() {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const loopInfo = [];

  for (const L of LOOPS) {
    // 1) 抠图
    const raws = [];
    for (const fr of L.frames) {
      const srcPath = fr.from === 'gen' ? path.join(GEN, fr.file) : path.join(SRC, fr.file);
      raws.push(await cutoutRaw(srcPath));
    }
    // 2) 统一缩放系数：按该循环最高帧归一到 TARGET_H
    const boxes = raws.map(r => bboxOf(r.raw, r.width, r.height));
    const maxH = Math.max(...boxes.map(b => b.h));
    const scale = TARGET_H / maxH;
    // 3) 贴画布 + 基线对齐
    const frames = [];
    for (let i = 0; i < raws.length; i++) {
      const lift = (L.lift && L.lift[i]) || 0;
      const rot = (L.rot && L.rot[i]) || 0;
      const placed = await placeFrame(raws[i].raw, raws[i].width, raws[i].height, scale, lift, rot, L.rotPivot || 'bottom', L.anchor || 'bottom');
      frames.push(placed);
      await sharp(placed.raw, { raw: { width: CW, height: CH, channels: 4 } })
        .png().toFile(path.join(OUT, 'frames', `${L.id}_${i}.png`));
    }
    loopInfo.push({ ...L, frames });
    console.log(`loop ${L.id}: rawH=[${boxes.map(b => b.h).join(',')}] scale=${scale.toFixed(4)} placedH=[${frames.map(f => f.bbox.h).join(',')}] placedBottom=[${frames.map(f => f.bbox.maxY).join(',')}]`);
  }

  // 4) 条带预览
  for (const L of loopInfo) {
    const FW = 220;
    const bufs = [];
    for (const f of L.frames) {
      bufs.push(await sharp(f.raw, { raw: { width: CW, height: CH, channels: 4 } })
        .resize({ width: FW, height: FW, fit: 'inside' }).png().toBuffer());
    }
    const metas = [];
    for (const b of bufs) metas.push(await sharp(b).metadata());
    const stripH = Math.max(...metas.map(m => m.height));
    const stripComps = bufs.map((b, i) => ({ input: b, left: i * FW + Math.floor((FW - metas[i].width) / 2), top: 0 }));
    await sharp({ create: { width: bufs.length * FW, height: stripH, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
      .composite(stripComps).png().toFile(path.join(OUT, `鲸鱼娘循环_${L.id}_${L.label}.png`));
  }
  console.log('strips ok');

  // 5) GIF
  for (const L of loopInfo) {
    const FW = 220;
    const frames = [];
    for (const f of L.frames) {
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
}

main().catch(e => { console.error(e); process.exit(1); });
