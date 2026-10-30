// 定位并测量探针控件(红色方块)在两种窗口高度下的实际尺寸
const sharp = require('sharp');

const A = process.argv[2];   // 319 高
const B = process.argv[3];   // 520 高

(async () => {
  for (const [tag, f] of [['A', A], ['B', B]]) {
    const { width, height } = await sharp(f).metadata();
    const { data } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
    const ch = data.length / (width * height);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // 探针红: RGB(51,51,255) 附近(锐利、不透明)
      if (Math.abs(r - 51) < 20 && Math.abs(g - 51) < 20 && b > 230) {
        cnt++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!cnt) { console.log(`${tag} ${f}: 未找到探针`); continue; }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    console.log(`${tag} (窗口 ${width}x${height}): 探针 ${cnt}px  位置(${minX},${minY})  尺寸 ${w}x${h}`);
  }
})();
