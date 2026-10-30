// 正确的压扁逻辑:
//  - 最终显示应为正方 logo (723x549, 比例1.317)
//  - 位图 y 拉伸 1.7345 倍 → 位图内 logo 的宽高比应为 1.317/1.7345 = 0.759
//  - 显示宽 104 → 位图内 104 x 60 (104/60=1.733 ≈ 1/0.576)
//    验证: 位图 104x60 → 渲染 104x104, 但这样 logo 会被拉成正方形而不是 1.317
//
// 正确: 要让渲染后宽高比 = 1.317
//   渲染高 = 位图高 * 1.7345, 渲染宽 = 位图宽
//   位图宽/位图高 = 1.317 / 1.7345 = 0.759
//   → 位图内 104 x 137 是不行的(太高), 改为显示宽 104 时位图高 = 104/0.759 = 137 (超出)
//
// 换算: 若位图内放 104x60 的框, logo 在框内应占 104 x (104/1.317)=79 的原始比例,
//       但框高只有 60 → logo 需要被纵向压扁到 60/79 = 0.759 倍
// 即: resize 到 104x60 时, 就是把 logo 压扁成显示比例, 渲染拉伸后恢复 1.317 ✓
const path = require('path');
const sharp = require('sharp');

const OUT = path.join('D:/TTPlayer/.workbuddy/imgtool', 'whale_preview');
const KY = 1.7345;

(async () => {
  // 位图框: 宽 104, 高 = 104/1.7345*1.317/1.317 → 让渲染后接近正方
  // 直接算: 位图框宽104 高 H, 渲染后 104 x H*1.7345, logo 原比例1.317
  // 要 logo 填满框且渲染后不变形: logo 在框内被压扁比例 = (H*1.7345/104) / 1.317
  // 令压扁比例 = 1 (不变形) → H = 104/(1.7345*1.317) = 45.5
  const bmW = 104, bmH = 45;

  for (const [name, file] of [['A', 'ds_logo_A_keepbelly.png'], ['B', 'ds_logo_B_cutbelly.png']]) {
    // 关键: fit:'fill' 把 723x549 直接压成 104x45 (纵向压扁 0.759)
    // 渲染时 y 再拉伸 1.7345 → 净效果恢复原比例 1.317 ✓
    const logo = await sharp(path.join(OUT, file))
      .resize({ width: bmW, height: bmH, fit: 'fill', kernel: 'lanczos3' })
      .png().toBuffer();
    const m = await sharp(logo).metadata();
    console.log(`${name}: 位图内 ${m.width}x${m.height} → 渲染显示 ${m.width}x${Math.round(m.height * KY)} (比例 ${(m.width / (m.height * KY)).toFixed(3)})`);

    // 集成预览
    const bgSvg = `<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#13225E"/><stop offset="1" stop-color="#3443D0"/></linearGradient></defs>
      <rect width="400" height="200" fill="url(#g)"/>
      <rect x="0" y="0" width="250" height="200" fill="#1B2A78"/></svg>`;
    const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();
    const music = await sharp('D:/TTPlayer/jingyu-niang-assets/frames/S08_music.png')
      .resize({ width: 132, height: Math.round(124 / KY), fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    // logo 放位图 (272,112): Q版图占 y40..111, 不重叠
    const comps = [{ input: music, top: 40, left: 256 }, { input: logo, top: 112, left: 272 }];
    const lyric = await sharp(bg).composite(comps).png().toBuffer();
    await sharp(lyric).resize({ width: 400, height: Math.round(200 * KY), fit: 'fill' })
      .png().toFile(path.join(OUT, `logo2_${name}.png`));
    console.log(`  → logo2_${name}.png`);
  }
})();
