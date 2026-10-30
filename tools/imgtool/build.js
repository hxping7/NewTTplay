// 鲸鱼娘 Q 版角色素材后期处理 v2
// 抠图改为「边缘泛洪连通域」：只删除与画面边缘连通、且颜色平坦的区域，
// 角色内部与背景同色的白围裙/白皮肤不会被误删。
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');

const SRC = 'D:/TTPlayer/jingyu-niang-design_assets';
const OUT = 'D:/TTPlayer/jingyu-niang-assets';

const FRAMES = [
  { id: '00_主形象', file: '411b6e0f-miora_edit_image-1793149943599-0-d8970566f52f.png', label: '待机' },
  { id: '01_摇尾巴', file: '96b31be2-miora_edit_image-1793150016531-0-40234e6622c0.png', label: '摇尾巴' },
  { id: '02_吃饭', file: '5ff2b0d4-miora_edit_image-1793150059560-0-b540fc8d2cab.png', label: '吃饭' },
  { id: '03_睡觉', file: '575b4ced-miora_edit_image-1793150096482-0-88ff8bcd54a6.png', label: '睡觉' },
  { id: '04_高兴', file: '9b68fc7a-miora_edit_image-1793150134956-0-b4d71bf0a614.png', label: '高兴' },
  { id: '05_不开心', file: '24deb9e7-miora_edit_image-1793150241056-0-3b3f6d6dbeb0.png', label: '不开心' },
  { id: '06_工作忙', file: 'eeb9deef-miora_edit_image-1793150296328-0-b40836ef2a3d.png', label: '工作忙' },
  { id: '07_听音乐', file: '0c539fff-miora_edit_image-1793150338489-0-9ce09d2a11e8.png', label: '听音乐' },
  { id: '08_K歌', file: '035a27f3-miora_edit_image-1793150379947-0-e6693b41db85.png', label: 'K歌' },
  { id: '09_生气', file: '200bf412-miora_edit_image-1793150423114-0-d43e5f0f34ad.png', label: '生气' },
  { id: '10_游泳', file: '2253596f-miora_edit_image-1793151658081-0-6e8cb02a3b17.png', label: '游泳' },
  { id: '11_问候', file: 'e63d45c7-miora_edit_image-1793150571963-0-bd908b933a6f.png', label: '问候' },
];

const CELL = 320;
const COLS = 4;
const SHEET_BG = { r: 38, g: 42, b: 54, alpha: 1 };
const TOL = 20;          // 颜色容差（RGB 欧氏距离）
const FLAT_MIN_COUNT = 30; // 边缘采样中该颜色至少出现这么多次才算「平坦背景色」

// 采样画面边缘，聚合出平坦背景色
function collectFlatColors(data, width, height, channels) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * channels;
    const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, 1); add(x, height - 1); add(x, height - 2); }
  for (let y = 0; y < height; y++) { add(0, y); add(1, y); add(width - 1, y); add(width - 2, y); }

  // 还原颜色并合并相近色
  const cand = [];
  for (const [key, cnt] of counts) {
    if (cnt < FLAT_MIN_COUNT) continue;
    const c = { r: ((key >> 10) & 31) * 8 + 4, g: ((key >> 5) & 31) * 8 + 4, b: (key & 31) * 8 + 4 };
    if (!cand.some(o => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) < 16)) cand.push(c);
  }
  return cand;
}

// 泛洪：从边缘出发，仅当像素颜色接近某个平坦背景色时才扩展
function floodBackground(data, width, height, channels, flatColors) {
  const n = width * height;
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;

  const isFlat = (i) => {
    const p = i * channels;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    for (const c of flatColors) {
      if (Math.hypot(r - c.r, g - c.g, b - c.b) <= TOL) return true;
    }
    return false;
  };
  const push = (i) => {
    if (bg[i]) return;
    if (!isFlat(i)) return;
    bg[i] = 1; queue[qt++] = i;
  };
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

async function main() {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const cells = [];

  for (const f of FRAMES) {
    // 裁掉右下角平台水印
    const src = path.join(SRC, f.file);
    const { data, info } = await sharp(src)
      .extract({ left: 0, top: 0, width: 1024, height: 940 })
      .raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const flat = collectFlatColors(data, width, height, channels);
    const bgMask = floodBackground(data, width, height, channels, flat);

    // 生成 RGBA：背景透明，边缘 1px 羽化
    const out = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const si = i * channels, di = i * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2];
      out[di + 3] = bgMask[i] ? 0 : 255;
    }

    const png = path.join(OUT, 'frames', `${f.id}.png`);
    await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(png);

    const cell = await sharp(out, { raw: { width, height, channels: 4 } })
      .resize({ width: CELL - 20, height: CELL - 20, fit: 'inside' })
      .png().toBuffer();
    cells.push({ buf: cell, label: f.label, id: f.id });
    console.log('cutout ok:', f.id, 'flatColors=', flat.length);
  }

  // 帧一览图
  const rows = Math.ceil(cells.length / COLS);
  const composites = [];
  for (let i = 0; i < cells.length; i++) {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    const m = await sharp(cells[i].buf).metadata();
    composites.push({
      input: cells[i].buf,
      left: cx + Math.floor((CELL - m.width) / 2),
      top: cy + Math.floor((CELL - m.height) / 2),
    });
  }
  await sharp({
    create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: SHEET_BG },
  }).composite(composites).png().toFile(path.join(OUT, '鲸鱼娘帧一览.png'));
  console.log('sheet ok:', COLS * CELL + 'x' + rows * CELL);

  // 动画预览 GIF
  const GIFW = 300;
  const frames = [];
  for (const c of cells) {
    const r = await sharp(c.buf)
      .resize({ width: GIFW, height: GIFW, fit: 'inside' })
      .ensureAlpha()
      .raw().toBuffer({ resolveWithObject: true });
    frames.push(r);
  }
  const gw = frames[0].info.width, gh = frames[0].info.height;
  const enc = new GIFEncoder(gw, gh);
  enc.start();
  enc.setRepeat(0);
  enc.setDelay(1400);
  enc.setTransparent(0x000000);
  enc.setDispose(2);
  for (const r of frames) enc.addFrame(r.data);
  enc.finish();
  fs.writeFileSync(path.join(OUT, '鲸鱼娘动画预览.gif'), Buffer.from(enc.out.getData()));
  console.log('gif ok:', gw + 'x' + gh);
}

main().catch(e => { console.error(e); process.exit(1); });
