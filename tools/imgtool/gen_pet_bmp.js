// 鲸鱼娘 AI 素材 → 桌宠位图 (128×128, 24bpp BMP, 品红键控)
// 管线: 源 PNG(已抠透明) → 裁包围盒 → LANCZOS 等比缩放 → alpha 二值化(>=128)
//       → 3×3 闭运算封缝 → 合成到品红底(底部基线 y=128) → 填内部封闭洞
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = 'D:/TTPlayer/jingyu-niang-assets/frames';
const OUT = 'D:/TTPlayer/.workbuddy/whaletmp/frames';
const F = 128;                      // 帧尺寸（与 whale.c FRM 一致）
const MAG = [255, 0, 255];          // 品红键控色
const FILL = 110;                   // 角色高度目标像素

const STATES = [
  { rc: 1,  name: 'idle',  files: ['L00_idle_0', 'L00_idle_1', 'L00_idle_2', 'L00_idle_3'] },
  { rc: 2,  name: 'walk',  files: ['L05_walk_0', 'L05_walk_1', 'L05_walk_2', 'L05_walk_3'] },
  { rc: 3,  name: 'feed',  files: ['L12_feed_0', 'L12_feed_1', 'L12_feed_2'] },
  { rc: 4,  name: 'eat',   files: ['L07_eat_0', 'L07_eat_1', 'L07_eat_2', 'L07_eat_3'] },
  { rc: 5,  name: 'sleep', files: ['L06_sleep_0', 'L06_sleep_1', 'L06_sleep_2', 'L06_sleep_3'] },
  { rc: 6,  name: 'happy', files: ['L11_happy_0', 'L11_happy_1', 'L11_happy_2', 'L11_happy_3'] },
  { rc: 7,  name: 'sad',   files: ['L09_sad_0', 'L09_sad_1', 'L09_sad_2'] },
  { rc: 8,  name: 'work',  files: ['L02_work_0', 'L02_work_1', 'L02_work_2', 'L02_work_3'] },
  { rc: 9,  name: 'music', files: ['L10_music_0', 'L10_music_1', 'L10_music_2', 'L10_music_3'] },
  { rc: 10, name: 'ktv',   files: ['L04_ktv_0', 'L04_ktv_1', 'L04_ktv_2', 'L04_ktv_3'] },
  { rc: 11, name: 'angry', files: ['L08_angry_0', 'L08_angry_1', 'L08_angry_2', 'L08_angry_3'] },
  { rc: 12, name: 'swim',  files: ['L03_swim_0', 'L03_swim_1', 'L03_swim_2', 'L03_swim_3'] },
  { rc: 13, name: 'greet', files: ['L13_greet_0', 'L13_greet_1', 'L13_greet_2'] },
  { rc: 14, name: 'drag',  files: ['L14_drag_0', 'L14_drag_1', 'L14_drag_2'] },
  { rc: 15, name: 'shy',   files: ['L15_shy_0', 'L15_shy_1', 'L15_shy_2'] },
  { rc: 16, name: 'think', files: ['L16_think_0', 'L16_think_1', 'L16_think_2'] },
  { rc: 17, name: 'proud', files: ['L17_proud_0', 'L17_proud_1', 'L17_proud_2'] },
  { rc: 18, name: 'dance', files: ['L18_dance_0', 'L18_dance_1', 'L18_dance_2', 'L18_dance_3', 'L18_dance_4', 'L18_dance_5', 'L18_dance_6', 'L18_dance_7'] },
];

const isMag = (r, g, b) => r === 255 && g === 0 && b === 255;

function closeMask(mask, w, h) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) { v = 1; break; }
        }
      }
      dil[y * w + x] = v;
    }
  }
  const ero = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!(nx >= 0 && nx < w && ny >= 0 && ny < h && dil[ny * w + nx])) { v = 0; break; }
        }
      }
      ero[y * w + x] = v;
    }
  }
  return ero;
}

function fillEnclosedHoles(px, w, h) {
  for (let iter = 0; iter < 6; iter++) {
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const i = y * w + x;
      if (seen[i]) return;
      if (!isMag(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])) return;
      seen[i] = 1; stack.push(i);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
    }
    const holes = [];
    for (let i = 0; i < w * h; i++) {
      if (!seen[i] && isMag(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])) holes.push(i);
    }
    if (!holes.length) return px;
    let fixed = 0;
    for (const i of holes) {
      const x = i % w, y = (i / w) | 0;
      const cnt = new Map();
      for (let R = 1; R <= 5 && !cnt.size; R++) {
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== R) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const j = ny * w + nx;
            if (isMag(px[j * 3], px[j * 3 + 1], px[j * 3 + 2])) continue;
            const key = (px[j * 3] << 16) | (px[j * 3 + 1] << 8) | px[j * 3 + 2];
            cnt.set(key, (cnt.get(key) || 0) + 1);
          }
        }
      }
      if (!cnt.size) continue;
      let best = null, bestN = -1;
      for (const [k, c] of cnt) if (c > bestN) { bestN = c; best = k; }
      px[i * 3] = (best >> 16) & 255;
      px[i * 3 + 1] = (best >> 8) & 255;
      px[i * 3 + 2] = best & 255;
      fixed++;
    }
    if (!fixed) return px;
  }
  return px;
}

// 读取源帧（已抠透明）→ 返回 raw + 内容包围盒
async function loadFrame(file) {
  const src = path.join(SRC, file + '.png');
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = info.width, sh = info.height;
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] >= 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { data, width: sw, height: sh, bbox: { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

// 把一个状态的所有帧按【统一包围盒 + 统一缩放】渲染成 128×128 帧
// 关键：使用整组的并集包围盒，保留帧间的相对位移（如跳跃抬升、悬挂摆动）
async function renderState(files) {
  const frames = [];
  for (const f of files) frames.push(await loadFrame(f));

  // 并集包围盒
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (const f of frames) {
    const b = f.bbox;
    if (b.w <= 0) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const uw = maxX - minX + 1;
  const uh = maxY - minY + 1;
  // 等比缩放：同时受"角色高度目标"和"画布宽度"约束，避免横向压扁
  const scale = Math.min(FILL / uh, F / uw);
  const useW = Math.min(Math.max(1, Math.round(uw * scale)), F);
  const useH = Math.min(Math.max(1, Math.round(uh * scale)), F);

  const out = [];
  for (const f of frames) {
    // 1) 抠出并集窗口（帧与并集之间的空白保持透明）
    const canvas = Buffer.alloc(uw * uh * 4);
    const b = f.bbox;
    if (b.w > 0) {
      const x0 = Math.max(minX, 0), x1 = Math.min(maxX, f.width - 1);
      const y0 = Math.max(minY, 0), y1 = Math.min(maxY, f.height - 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const si = (y * f.width + x) * 4;
          const di = ((y - minY) * uw + (x - minX)) * 4;
          canvas[di] = f.data[si]; canvas[di + 1] = f.data[si + 1];
          canvas[di + 2] = f.data[si + 2]; canvas[di + 3] = f.data[si + 3];
        }
      }
    }
    // 2) 统一缩放
    const scaled = await sharp(canvas, { raw: { width: uw, height: uh, channels: 4 } })
      .resize({ width: useW, height: useH, fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    // 3) alpha 二值化 + 闭运算封缝
    const mask = new Uint8Array(useW * useH);
    for (let i = 0; i < useW * useH; i++) mask[i] = scaled.data[i * 4 + 3] >= 128 ? 1 : 0;
    const closed = closeMask(mask, useW, useH);

    // 4) 合成到品红底（底部基线 y=128）
    const px = Buffer.alloc(F * F * 3);
    for (let i = 0; i < F * F; i++) { px[i * 3] = MAG[0]; px[i * 3 + 1] = MAG[1]; px[i * 3 + 2] = MAG[2]; }
    const offX = Math.floor((F - useW) / 2);
    const offY = F - useH;
    for (let y = 0; y < useH; y++) {
      for (let x = 0; x < useW; x++) {
        if (!closed[y * useW + x]) continue;
        const si = (y * useW + x) * 4;
        const di = ((y + offY) * F + (x + offX)) * 3;
        px[di] = scaled.data[si];
        px[di + 1] = scaled.data[si + 1];
        px[di + 2] = scaled.data[si + 2];
      }
    }
    out.push(fillEnclosedHoles(px, F, F));
  }
  return out;
}

function writeStripBMP(frames, outFile) {
  const n = frames.length;
  const w = F * n;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const dataSize = rowSize * F;
  const bmp = Buffer.alloc(54 + dataSize);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(w, 18);
  bmp.writeInt32LE(F, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(dataSize, 34);
  bmp.writeInt32LE(3780, 38);
  bmp.writeInt32LE(3780, 42);
  for (let f = 0; f < n; f++) {
    const frame = frames[f];
    for (let y = 0; y < F; y++) {
      const srcRow = (F - 1 - y) * F * 3;
      const dstRow = 54 + y * rowSize + f * F * 3;
      for (let x = 0; x < F; x++) {
        const si = srcRow + x * 3, di = dstRow + x * 3;
        bmp[di] = frame[si + 2];
        bmp[di + 1] = frame[si + 1];
        bmp[di + 2] = frame[si];
      }
    }
  }
  fs.writeFileSync(outFile, bmp);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  for (const st of STATES) {
    const frames = await renderState(st.files);
    writeStripBMP(frames, path.join(OUT, st.name + '.bmp'));
    manifest.push({ rc: st.rc, name: st.name, frames: st.files.length, file: st.name + '.bmp' });
    console.log('ok:', st.name, st.files.length + '帧');
  }
  fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest written');
}

main().catch(e => { console.error(e); process.exit(1); });
