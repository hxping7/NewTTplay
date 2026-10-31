// walk 预览重生成: 条带图(7 帧, 220px 格, 深灰底) + 真 12 相位循环 GIF(110ms/相位)
// 约定与 build2.js 一致。改帧后先跑 make_walk_mirror.js 再跑本脚本。
const sharp = require('sharp');
const GIFEncoder = require('gifencoder');
const path = require('path');
const fs = require('fs');
const SRC = 'D:/TTPlayer/jingyu-niang-assets/frames';
const OUT = 'D:/TTPlayer/jingyu-niang-assets';
const FW = 220, BG = { r: 38, g: 42, b: 54, alpha: 1 };
const FRAMES = ['L05_walk_0', 'L05_walk_1', 'L05_walk_2', 'L05_walk_3', 'L05_walk_4', 'L05_walk_5', 'L05_walk_6'];
const CYCLE = [0, 1, 2, 3, 2, 1, 0, 4, 5, 6, 5, 4];   // 与 whale.c sq_walk 一致
const DELAY = 110;

(async () => {
  const scaled = [];
  for (const n of FRAMES) {
    scaled.push(await sharp(path.join(SRC, n + '.png'))
      .resize({ width: FW, height: FW, fit: 'inside' }).png().toBuffer());
  }
  const metas = [];
  for (const b of scaled) metas.push(await sharp(b).metadata());
  const stripH = Math.max(...metas.map(m => m.height));
  const comps = scaled.map((b, i) => ({ input: b, left: i * FW + Math.floor((FW - metas[i].width) / 2), top: 0 }));
  await sharp({ create: { width: FRAMES.length * FW, height: stripH, channels: 4, background: BG } })
    .composite(comps).png().toFile(path.join(OUT, '鲸鱼娘循环_L05_walk_走路.png'));
  console.log('strip ok:', FRAMES.length * FW, 'x', stripH);

  const gifFrames = [];
  for (const idx of CYCLE) {
    gifFrames.push(await sharp(path.join(SRC, FRAMES[idx] + '.png'))
      .resize({ width: FW, height: FW, fit: 'inside' }).ensureAlpha()
      .raw().toBuffer({ resolveWithObject: true }));
  }
  const gw = gifFrames[0].info.width, gh = gifFrames[0].info.height;
  const enc = new GIFEncoder(gw, gh);
  enc.start(); enc.setRepeat(0); enc.setDelay(DELAY);
  enc.setTransparent(0x000000); enc.setDispose(2);
  for (const r of gifFrames) enc.addFrame(r.data);
  enc.finish();
  fs.writeFileSync(path.join(OUT, '鲸鱼娘循环_L05_walk_走路.gif'), Buffer.from(enc.out.getData()));
  console.log('gif ok:', gw, 'x', gh, ',', CYCLE.length, '相位 @' + DELAY + 'ms');
})();
