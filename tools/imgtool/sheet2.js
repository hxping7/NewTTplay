const sharp = require('sharp');
const fs = require('fs'), path = require('path');
const DIR = 'D:/TTPlayer/jingyu-niang-assets/frames';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
(async () => {
  const CELL = 150, COLS = 10;
  const rows = Math.ceil(files.length / COLS);
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    const b = await sharp(path.join(DIR, files[i])).resize({ width: CELL - 10, height: CELL - 10, fit: 'inside' }).png().toBuffer();
    const m = await sharp(b).metadata();
    comps.push({ input: b, left: (i % COLS) * CELL + Math.floor((CELL - m.width) / 2), top: Math.floor(i / COLS) * CELL + Math.floor((CELL - m.height) / 2) });
  }
  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 38, g: 42, b: 54, alpha: 1 } } })
    .composite(comps).png().toFile('D:/TTPlayer/jingyu-niang-assets/鲸鱼娘帧表_紧凑版.png');
  console.log('紧凑帧表 ok:', COLS * CELL + 'x' + rows * CELL, files.length + ' 张');
})();
