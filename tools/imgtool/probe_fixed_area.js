// 用两张不同窗口高度的歌词窗截图, 判定"哪些 y 区域是固定的(1:1), 哪些被拉伸"
const sharp = require('sharp');

const A = 'D:/TTPlayer/.workbuddy/whaletmp/shots/lyric_v4_234021.png';   // 400x319
const B = 'D:/TTPlayer/.workbuddy/whaletmp/shots/lyric_v3_233110.png';  // 400x520

(async () => {
  const ma = await sharp(A).metadata();
  const mb = await sharp(B).metadata();
  console.log(`A=${ma.width}x${ma.height}   B=${mb.width}x${mb.height}\n`);

  const da = await sharp(A).raw().toBuffer({ resolveWithObject: true });
  const db = await sharp(B).raw().toBuffer({ resolveWithObject: true });

  // 逐行比较: 找 A 的第 y 行 与 B 的第 y' 行 是否一致(同 x 范围)
  const rowMatch = (bufA, wA, bufB, wB, yA, yB) => {
    let same = 0, total = 0;
    for (let x = 0; x < wA; x += 2) {
      const ia = (yA * wA + x) * da.info.channels;
      const ib = (yB * wB + x) * db.info.channels;
      const d = Math.abs(bufA[ia] - bufB[ib]) + Math.abs(bufA[ia+1] - bufB[ib+1]) + Math.abs(bufA[ia+2] - bufB[ib+2]);
      total++;
      if (d < 24) same++;
    }
    return same / total;
  };

  console.log('A(y) 与 B(y) 逐行匹配度 (1.0 = 完全相同):');
  for (let y = 0; y < 60; y += 4) {
    const m = rowMatch(da.data, ma.width, db.data, mb.width, y, y);
    console.log(`  y=${String(y).padStart(3)}  ${(m * 100).toFixed(1)}%`);
  }
})();
