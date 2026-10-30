const sharp = require('sharp');
const path = require('path');
const F = 'D:/TTPlayer/jingyu-niang-assets/frames';
(async () => {
  const CW = 400, COLS = 4;
  const comps = [];
  for (let i = 0; i < 8; i++) {
    const buf = await sharp(path.join(F, `L18_dance_${i}.png`))
      .resize(CW - 8, CW - 8, { fit: 'inside' })
      .flatten({ background: '#ffffff' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${CW}" height="28"><rect width="${CW}" height="28" fill="#22262e"/><text x="8" y="21" font-family="monospace" font-size="18" fill="#ffd479">frame ${i}</text></svg>`);
    comps.push({ input: label, left: (i % COLS) * CW, top: Math.floor(i / COLS) * CW });
    comps.push({ input: buf, left: (i % COLS) * CW + 4, top: Math.floor(i / COLS) * CW + 28 });
  }
  await sharp({ create: { width: COLS * CW, height: 2 * CW, channels: 4, background: { r: 246, g: 246, b: 249, alpha: 1 } } })
    .composite(comps).png().toFile('D:/TTPlayer/.workbuddy/imgtool/_review.png');
  console.log('ok');
})();
