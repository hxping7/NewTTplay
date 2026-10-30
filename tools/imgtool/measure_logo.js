// 测量实跑截图里 logo 的实际包围盒与长宽比, 验证是否发生纵向拉伸
const sharp = require('sharp');

const SHOT = process.argv[2];
const KY = 1.7345;

(async () => {
  const { width, height } = await sharp(SHOT).metadata();
  const { data } = await sharp(SHOT).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (width * height);

  // 找品牌蓝 (#4468FE 附近) 像素 —— 只在右半边(装饰区)找
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
  for (let y = 0; y < height; y++) {
    for (let x = Math.floor(width / 2); x < width; x++) {
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.abs(r - 68) < 9 && Math.abs(g - 104) < 9 && Math.abs(b - 254) < 9) {
        cnt++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  console.log(`截图 ${width}x${height}`);
  console.log(`品牌蓝像素 ${cnt}, 包围盒 x ${minX}..${maxX}  y ${minY}..${maxY}`);
  console.log(`实测渲染尺寸: ${w} x ${h}  长宽比 ${(w / h).toFixed(3)}`);
  console.log(`官方 logo 原比例: 1.317`);

  // 反推: 若位图里放的是 130x57(比例 2.281), 渲染后应 = 130 x 57*KY = 130x99 (1.313)
  console.log(`\n预期(位图130x57, y拉伸${KY}): 显示 130 x ${Math.round(57 * KY)}  比例 ${(130 / (57 * KY)).toFixed(3)}`);

  // 导出该区域放大图
  await sharp(SHOT).extract({ left: minX - 4, top: minY - 4, width: w + 8, height: h + 8 })
    .resize({ width: (w + 8) * 5, kernel: 'nearest' })
    .png().toFile('D:/TTPlayer/.workbuddy/whaletmp/shots/logo_measured.png');
  console.log('测量区域放大图: shots/logo_measured.png');
})();
