// 验证: 带 image= 的独立控件是否随窗口拉伸
// 手段: 在歌词窗标题栏放一个独立图片控件(带自己 image), 看它在不同窗口高度下尺寸是否一致
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/TTPlayer/.workbuddy';
const NEW = path.join(ROOT, 'skn_new');

// 1) 造一个测试图片: 32x16 的红色方块, 带品红键控边
const { createCanvas } = require('canvas');
const canvas = createCanvas(32, 16);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 32, 16);
ctx.fillStyle = '#ff3333'; ctx.fillRect(4, 3, 24, 10);
fs.writeFileSync(path.join(NEW, 'test_probe.bmp'), bmpFromRGBA(ctx.getImageData(0, 0, 32, 16).data, 32, 16));
console.log('已生成 test_probe.bmp (32x16)');

// 2) 修改 Skin.xml: 在 lyric_window 里加一个测试控件
const xmlPath = path.join(NEW, 'Skin.xml');
const orig = fs.readFileSync(xmlPath, 'utf8');
const patched = orig.replace(
  '    <ontop position="283, 10, 292, 19" image="ontop.bmp" align="right"/>',
  '    <ontop position="283, 10, 292, 19" image="ontop.bmp" align="right"/>\n' +
  '    <probe position="350, 20, 380, 40" image="test_probe.bmp"/>'
);
fs.writeFileSync(xmlPath + '.probe', patched);
console.log('已生成 Skin.xml.probe');

function bmpFromRGBA(rgba, w, h) {
  const rowSize = ((w * 3 + 3) >> 2) << 2;
  const size = 54 + rowSize * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4;
      const di = 54 + y * rowSize + x * 3;
      buf[di] = rgba[si + 2]; buf[di + 1] = rgba[si + 1]; buf[di + 2] = rgba[si];
    }
  }
  return buf;
}
