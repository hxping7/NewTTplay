// 测量绿(中心格)与红(右列)标记在两种窗口高度下的尺寸
const sharp = require('sharp');

const A = process.argv[2], B = process.argv[3];

async function measure(f, tag) {
  const { width, height } = await sharp(f).metadata();
  const { data } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);
  const find = (pred) => {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (pred(r, g, b)) {
        n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return n ? { n, x1: minX, x2: maxX, y1: minY, y2: maxY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  };
  const green = find((r, g, b) => g > 180 && r < 100 && b < 100);
  const red = find((r, g, b) => r > 180 && g < 100 && b < 100);
  console.log(`\n[${tag}] 窗口 ${width}x${height}`);
  if (green) console.log(`  绿(中心格): (${green.x1},${green.y1}) ${green.w}x${green.h}`);
  else console.log('  绿: 未找到');
  if (red) console.log(`  红(右列)  : (${red.x1},${red.y1}) ${red.w}x${red.h}`);
  else console.log('  红: 未找到');
  return { green, red };
}

(async () => {
  const a = await measure(A, 'A 319高');
  const b = await measure(B, 'B 520高');
  console.log('\n=== 判定 ===');
  if (a.green && b.green) {
    console.log(`绿(中心格) 高度: ${a.green.h} → ${b.green.h}  (变化 ${(b.green.h / a.green.h).toFixed(3)}x)`);
  }
  if (a.red && b.red) {
    console.log(`红(右列)   高度: ${a.red.h} → ${b.red.h}  (变化 ${(b.red.h / a.red.h).toFixed(3)}x)`);
  }
})();
