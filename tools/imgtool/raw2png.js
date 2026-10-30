// raw BGRA → PNG (Windows DIB 是 BGRA, 必须交换 R/B 否则颜色错);
// alpha 全 0 时视为不透明(PrintWindow 对无 alpha 的窗口会返回 0)
const sharp = require('sharp');
const fs = require('fs');
const [raw, out, w, h] = process.argv.slice(2);
const buf = fs.readFileSync(raw);

// 检查 alpha 是否全 0
let anyAlpha = false;
for (let i = 3; i < buf.length; i += 4) { if (buf[i] !== 0) { anyAlpha = true; break; } }

for (let i = 0; i < buf.length; i += 4) {
  const t = buf[i]; buf[i] = buf[i + 2]; buf[i + 2] = t;   // BGRA → RGBA
  if (!anyAlpha) buf[i + 3] = 255;
}
sharp(buf, { raw: { width: +w, height: +h, channels: 4 } })
  .png().toFile(out)
  .then(() => console.log('PNG: ' + out + ' ' + w + 'x' + h + (anyAlpha ? '' : ' (alpha 补满)')))
  .catch(e => { console.error(e.message); process.exit(1); });
