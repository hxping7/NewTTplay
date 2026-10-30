// 把两个 logo 变体放在歌词窗深蓝底上对比, 并按【位图真实比例】预压
// 位图里 y 会被拉伸 1.7345 倍 → 必须把 logo 在位图里画扁, 拉伸后才恢复正方形
const path = require('path');
const sharp = require('sharp');

const OUT = path.join('D:/TTPlayer/.workbuddy/imgtool', 'whale_preview');
const KY = 1.7345;

(async () => {
  // logo 显示尺寸: 宽 104 → 位图里 104 x (104/1.7345)=60
  const dispW = 104;
  const bmW = dispW;
  const bmH = Math.round(dispW / KY);   // 60
  console.log(`位图内尺寸: ${bmW}x${bmH} → 显示 ${dispW}x${Math.round(bmH * KY)}`);

  for (const [name, file] of [['A', 'ds_logo_A_keepbelly.png'], ['B', 'ds_logo_B_cutbelly.png']]) {
    // 把 logo 压扁成位图比例(水平保持, 纵向压到 bmH/bmH_orig)
    const meta = await sharp(path.join(OUT, file)).metadata();
    const fitH = bmH;                       // 高度填满位图高度
    const fitW = Math.round(meta.width * (fitH / meta.height));
    const squashed = await sharp(path.join(OUT, file))
      .resize({ width: fitW, height: fitH, fit: 'fill', kernel: 'lanczos3' })
      .png().toBuffer();
    console.log(`${name}: 原 ${meta.width}x${meta.height} → 压扁 ${fitW}x${fitH}`);

    // 歌词窗集成预览
    const bgSvg = `<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#13225E"/><stop offset="1" stop-color="#3443D0"/></linearGradient></defs>
      <rect width="400" height="200" fill="url(#g)"/>
      <rect x="0" y="0" width="250" height="200" fill="#1B2A78"/></svg>`;
    const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();
    const music = await sharp('D:/TTPlayer/jingyu-niang-assets/frames/S08_music.png')
      .resize({ width: 132, height: Math.round(124 / KY), fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    const comps = [{ input: music, top: 40, left: 256 }, { input: squashed, top: 100, left: 270 }];
    const lyric = await sharp(bg).composite(comps).png().toBuffer();
    await sharp(lyric).resize({ width: 400, height: Math.round(200 * KY), fit: 'fill' })
      .png().toFile(path.join(OUT, `logo_integrated_${name}.png`));
    console.log(`  集成预览: logo_integrated_${name}.png`);
  }
})();
