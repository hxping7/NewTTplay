// 清除 AI 生成图右下角水印（"AI生成 WORKBUDDY"）
// 难点：水印是半透明白字，只比背景亮 8~14 级，固定阈值会漏掉抗锯齿边（留"鬼影"）
// 做法：逐行取该行背景分位数作为基准色，把明显更亮的像素替换成基准色
// 用法：node clean_watermark.js <输入> <输出> [x起比例] [y起比例] [亮度阈值]
const sharp = require('sharp');

const SRC = process.argv[2];
const OUT = process.argv[3];
const XR = parseFloat(process.argv[4] || '0.84');
const YR = parseFloat(process.argv[5] || '0.86');
const TH = parseFloat(process.argv[6] || '3');

(async () => {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const lumAt = (i) => (data[i] + data[i + 1] + data[i + 2]) / 3;

  const x0 = Math.floor(W * XR), y0 = Math.floor(H * YR);
  let n = 0;

  for (let y = y0; y < H; y++) {
    // 收集该行区域内像素，按亮度排序，取 25 分位作为背景基准
    const idxs = [];
    for (let x = x0; x < W; x++) idxs.push((y * W + x) * C);
    const sorted = idxs.slice().sort((a, b) => lumAt(a) - lumAt(b));
    const base = sorted[Math.floor(sorted.length * 0.25)];
    const br = data[base], bg2 = data[base + 1], bb = data[base + 2];
    const baseLum = (br + bg2 + bb) / 3;

    for (const i of idxs) {
      if (lumAt(i) > baseLum + TH) {
        data[i] = br; data[i + 1] = bg2; data[i + 2] = bb;
        n++;
      }
    }
  }

  await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toFile(OUT);
  console.log(`清理 ${n} px · 区域 x>=${x0} y>=${y0} · 阈值 +${TH} · 输出 ${OUT}`);
})();
