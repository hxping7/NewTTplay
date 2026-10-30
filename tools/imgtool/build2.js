// 鲸鱼娘 高清素材 v2 —— 状态图 + 相位帧
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');

const SRC = 'D:/TTPlayer/jingyu-niang-design_assets';
const OUT = 'D:/TTPlayer/jingyu-niang-assets';

const TOL = 20;
const FLAT_MIN_COUNT = 30;

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

async function cutoutTo(file, dest) {
  const { data, info } = await sharp(path.join(SRC, file))
    .extract({ left: 0, top: 0, width: 1024, height: 940 })
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
  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(dest);
  return { out, width, height };
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

async function main() {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

  // 状态图（已有 12 张 + 新增 6 张）
  const STATES = [
    { id: 'S00_idle',      file: '411b6e0f-miora_edit_image-1793149943599-0-d8970566f52f.png', label: '待机' },
    { id: 'S01_walk',      file: 'f0d36c39-miora_edit_image-1793155217669-0-ae221255c22c.png', label: '走路' },
    { id: 'S02_feed',      file: '9501ffd9-miora_edit_image-1793155256402-0-667dc626cd86.png', label: '被投喂' },
    { id: 'S03_eat',       file: '5ff2b0d4-miora_edit_image-1793150059560-0-b540fc8d2cab.png', label: '吃饭' },
    { id: 'S04_sleep',     file: '575b4ced-miora_edit_image-1793150096482-0-88ff8bcd54a6.png', label: '睡觉' },
    { id: 'S05_happy',     file: '9b68fc7a-miora_edit_image-1793150134956-0-b4d71bf0a614.png', label: '高兴' },
    { id: 'S06_sad',       file: '24deb9e7-miora_edit_image-1793150241056-0-3b3f6d6dbeb0.png', label: '不开心' },
    { id: 'S07_work',      file: 'eeb9deef-miora_edit_image-1793150296328-0-b40836ef2a3d.png', label: '工作忙' },
    { id: 'S08_music',     file: '0c539fff-miora_edit_image-1793150338489-0-9ce09d2a11e8.png', label: '听音乐' },
    { id: 'S09_ktv',       file: '035a27f3-miora_edit_image-1793150379947-0-e6693b41db85.png', label: 'K歌' },
    { id: 'S10_angry',     file: '200bf412-miora_edit_image-1793150423114-0-d43e5f0f34ad.png', label: '生气' },
    { id: 'S11_swim',      file: '2253596f-miora_edit_image-1793151658081-0-6e8cb02a3b17.png', label: '游泳' },
    { id: 'S12_greet',     file: 'e63d45c7-miora_edit_image-1793150571963-0-bd908b933a6f.png', label: '问候' },
    { id: 'S13_drag',      file: '3b68e751-miora_edit_image-1793155290454-0-e8a97dc72b07.png', label: '被拖拽' },
    { id: 'S14_shy',       file: '17d3b066-miora_edit_image-1793155322151-0-98d8fa01040d.png', label: '害羞' },
    { id: 'S15_think',     file: '5a824150-miora_edit_image-1793155347225-0-f1d3b51e6066.png', label: '思考' },
    { id: 'S16_proud',     file: '420c35f8-miora_edit_image-1793155374411-0-f99ebf3127fe.png', label: '傲娇得意' },
  ];

  // 相位帧组：每个循环的帧序
  const LOOPS = [
    {
      id: 'L00_idle', label: '待机呼吸', fps: 220,
      frames: [
        '411b6e0f-miora_edit_image-1793149943599-0-d8970566f52f.png',
        '47af7dd6-miora_edit_image-1793155463384-0-324e8a602a94.png',
        '8856c136-miora_edit_image-1793155495233-0-307ecd0142dc.png',
        '6585fbaf-miora_edit_image-1793155526673-0-1ac88eac512c.png',
      ],
    },
    {
      id: 'L01_tail', label: '摇尾巴', fps: 160,
      frames: [
        '96b31be2-miora_edit_image-1793150016531-0-40234e6622c0.png',
        'c12491dd-miora_edit_image-1793156301371-0-4de7c370f749.png',
        'bb101556-miora_edit_image-1793156343752-0-95aa6d7070c4.png',
        '896e811d-miora_edit_image-1793156386638-0-4bb470c52681.png',
      ],
    },
    {
      id: 'L02_work', label: '工作忙', fps: 200,
      frames: [
        'eeb9deef-miora_edit_image-1793150296328-0-b40836ef2a3d.png',
        '0b79a697-miora_edit_image-1793155684381-0-fb5d6d01eede.png',
        '2e4d70da-miora_edit_image-1793155722339-0-5fd19cf3e771.png',
        'b0406f8a-miora_edit_image-1793155762853-0-b5f428f8f9d9.png',
      ],
    },
    {
      id: 'L03_swim', label: '游泳', fps: 200,
      frames: [
        '2253596f-miora_edit_image-1793151658081-0-6e8cb02a3b17.png',
        '7e9696f6-miora_edit_image-1793156429197-0-0ac3ce8c2e44.png',
        '635217c3-miora_edit_image-1793156477732-0-55552d91c0bd.png',
        '2d590779-miora_edit_image-1793156523238-0-57bb1c2a658e.png',
      ],
    },
    {
      id: 'L06_sleep', label: '睡觉', fps: 320,
      frames: [
        '575b4ced-miora_edit_image-1793150096482-0-88ff8bcd54a6.png',
        '22869c25-miora_edit_image-1793164688633-0-630189c5e4b9.png',
        'bc95a358-miora_edit_image-1793164728961-0-6c22dd42003b.png',
        '36fac369-miora_edit_image-1793164774329-0-f4c08c144421.png',
      ],
    },
    {
      id: 'L07_eat', label: '吃饭', fps: 220,
      frames: [
        '5ff2b0d4-miora_edit_image-1793150059560-0-b540fc8d2cab.png',
        '8c470deb-miora_edit_image-1793164874128-0-9d7cb8309a21.png',
        'a7a47933-miora_edit_image-1793164919429-0-daf895fc25d1.png',
        'e452ebf8-miora_edit_image-1793164969676-0-45d3d3c4b794.png',
      ],
    },
    {
      id: 'L08_angry', label: '生气', fps: 180,
      frames: [
        '200bf412-miora_edit_image-1793150423114-0-d43e5f0f34ad.png',
        'bc3b7129-miora_edit_image-1793165010142-0-847b8ebd667c.png',
        'ed9387bf-miora_edit_image-1793165056055-0-4194043e529b.png',
        '55d35c7b-miora_edit_image-1793165271603-0-bfcd99d95d7e.png',
      ],
    },
    {
      id: 'L09_sad', label: '不开心', fps: 260,
      frames: [
        '24deb9e7-miora_edit_image-1793150241056-0-3b3f6d6dbeb0.png',
        '2dc2eb27-miora_edit_image-1793165096375-0-e5d145170fb4.png',
        'cc307a44-miora_edit_image-1793165144537-0-20460b00a092.png',
      ],
    },
    {
      id: 'L10_music', label: '听音乐', fps: 200,
      frames: [
        '0c539fff-miora_edit_image-1793150338489-0-9ce09d2a11e8.png',
        'e3ea27c3-miora_edit_image-1793165185304-0-f407e9acb4ca.png',
        '644d5719-miora_edit_image-1793165225675-0-eee3e57316de.png',
        '1641bce6-miora_edit_image-1793165315556-0-27d180a32032.png',
      ],
    },
    {
      id: 'L05_walk', label: '走路', fps: 140,
      frames: [
        'f0d36c39-miora_edit_image-1793155217669-0-ae221255c22c.png',
        'be5f4799-miora_edit_image-1793164388479-0-009aed31e934.png',
        'd28c0b92-miora_edit_image-1793164425123-0-8d26d7d04fc0.png',
        'd2948fbd-miora_edit_image-1793164467968-0-c89a4819ca3b.png',
      ],
    },
    {
      id: 'L04_ktv', label: 'K歌', fps: 180,
      frames: [
        '035a27f3-miora_edit_image-1793150379947-0-e6693b41db85.png',
        '99cbff81-miora_edit_image-1793155941460-0-646f1639c618.png',
        'cbe7315c-miora_edit_image-1793156028690-0-efc15c7409fa.png',
        '037b3fe4-miora_edit_image-1793155974610-0-9846d7c06349.png',
      ],
    },
  ];

  // 1) 状态图抠图
  const stateBuf = {};
  const stateMeta = [];
  for (const s of STATES) {
    const dest = path.join(OUT, 'frames', `${s.id}.png`);
    const { out, width, height } = await cutoutTo(s.file, dest);
    stateBuf[s.id] = out;
    stateMeta.push({ ...s, w: width, h: height });
    console.log('state ok:', s.id);
  }

  // 2) 相位帧抠图 + 基线对齐分析
  const loopInfo = [];
  for (const L of LOOPS) {
    const frames = [];
    const boxes = [];
    for (let i = 0; i < L.frames.length; i++) {
      const dest = path.join(OUT, 'frames', `${L.id}_${i}.png`);
      const { out, width, height } = await cutoutTo(L.frames[i], dest);
      frames.push({ raw: out, width, height });
      boxes.push(bboxOf(out, width, height));
    }
    // 以第一帧为基准，算出其余帧需要的垂直偏移，使底部基线一致
    const base = boxes[0].maxY;
    const offsets = boxes.map(b => base - b.maxY);
    loopInfo.push({ ...L, frames, boxes, offsets });
    console.log('loop ok:', L.id, 'offsets=', offsets.join(','));
  }

  // 3) 相位帧按统一缩放对齐后另存（对齐版）
  for (const L of loopInfo) {
    for (let i = 0; i < L.frames.length; i++) {
      const f = L.frames[i];
      const b = L.boxes[i];
      // 统一缩放：按最大帧的宽高比例统一，使循环时角色大小一致
      const dest = path.join(OUT, 'frames', `${L.id}_${i}.png`);
      // 用 extract + 位置补偿实现基线对齐：把内容整体下移 offsets[i]
      const shift = L.offsets[i];
      const comp = [];
      if (shift !== 0) {
        comp.push({ input: f.raw, raw: { width: f.width, height: f.height, channels: 4 }, left: 0, top: shift });
      } else {
        comp.push({ input: f.raw, raw: { width: f.width, height: f.height, channels: 4 }, left: 0, top: 0 });
      }
      await sharp({
        create: { width: f.width, height: f.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite(comp).png().toFile(dest);
    }
  }

  // 4) 状态帧一览图（6 列）
  const CELL = 260, COLS = 6;
  const rows = Math.ceil(stateMeta.length / COLS);
  const comps = [];
  for (let i = 0; i < stateMeta.length; i++) {
    const s = stateMeta[i];
    const b = await sharp(stateBuf[s.id], { raw: { width: s.w, height: s.h, channels: 4 } })
      .resize({ width: CELL - 16, height: CELL - 16, fit: 'inside' }).png().toBuffer();
    const m = await sharp(b).metadata();
    comps.push({ input: b, left: (i % COLS) * CELL + Math.floor((CELL - m.width) / 2), top: Math.floor(i / COLS) * CELL + Math.floor((CELL - m.height) / 2) });
  }
  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
    .composite(comps).png().toFile(path.join(OUT, '鲸鱼娘状态一览.png'));
  console.log('state sheet ok');

  // 5) 每个循环导出一张相位帧条带图（横排，便于检查衔接）
  for (const L of loopInfo) {
    const FW = 220;
    const bufs = [];
    for (const f of L.frames) {
      bufs.push(await sharp(f.raw, { raw: { width: f.width, height: f.height, channels: 4 } })
        .resize({ width: FW, height: FW, fit: 'inside' }).png().toBuffer());
    }
    const metas = [];
    for (const b of bufs) metas.push(await sharp(b).metadata());
    const stripH = Math.max(...metas.map(m => m.height));
    const stripW = bufs.length * FW;
    const stripComps = bufs.map((b, i) => ({ input: b, left: i * FW + Math.floor((FW - metas[i].width) / 2), top: 0 }));
    await sharp({ create: { width: stripW, height: stripH, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
      .composite(stripComps).png().toFile(path.join(OUT, `鲸鱼娘循环_${L.id}_${L.label}.png`));
  }
  console.log('strips ok');

  // 6) 循环预览 GIF
  for (const L of loopInfo) {
    const FW = 220;
    const frames = [];
    for (const f of L.frames) {
      frames.push(await sharp(f.raw, { raw: { width: f.width, height: f.height, channels: 4 } })
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
