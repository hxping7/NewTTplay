// 最终校验: 1) 主窗圆角品红遮罩 vs 基底  2) 滚动条品红  3) 歌词窗鲸鱼像素确认
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'D:/TTPlayer/.workbuddy';

function pyRead(file) {
  const script = `
import sys, json, base64
sys.path.insert(0, r'${path.join(ROOT, 'imgtool')}')
from bmp import read_bmp
w,h,px = read_bmp(r'${file}')
sys.stdout.write(json.dumps({'w':w,'h':h,'px':base64.b64encode(px).decode()}))
`;
  const r = execFileSync('python', ['-c', script], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 300 });
  return JSON.parse(r);
}

function magentaMask(b) {
  const m = new Set();
  const { w, h } = b;
  const px = Buffer.from(b.px, 'base64');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (px[i] > 200 && px[i + 1] < 80 && px[i + 2] > 200) m.add(y * w + x);
  }
  return { m, w, h, px };
}

// 1) 主窗圆角
const base = magentaMask(pyRead(path.join(ROOT, 'skn_extract', 'player_skin.bmp')));
const cur = magentaMask(pyRead(path.join(ROOT, 'skn_new', 'player_skin.bmp')));
let diff = 0;
for (const k of base.m) if (!cur.m.has(k)) diff++;
for (const k of cur.m) if (!base.m.has(k)) diff++;
console.log(`主窗圆角遮罩差异: ${diff} 像素 (基 ${base.m.size} / 新 ${cur.m.size})`);

// 四角对角品红数
const cornerCheck = (b, name) => {
  const { w, h } = b; const px = Buffer.from(b.px, 'base64');
  const isM = (x, y) => { const i = (y * w + x) * 3; return px[i] > 200 && px[i+1] < 80 && px[i+2] > 200; };
  const diag = [isM(0,0)?1:0, isM(w-1,0)?1:0, isM(0,h-1)?1:0, isM(w-1,h-1)?1:0];
  console.log(`  ${name} 四角品红: ${diag.join(',')}  总计 ${b.m.size}`);
};
cornerCheck(base, '基底');
cornerCheck(cur, '新版');

// 2) 滚动条品红
for (const f of ['scrollbar_bar.bmp', 'scrollbar_button.bmp', 'scrollbar_thumb.bmp']) {
  const b = magentaMask(pyRead(path.join(ROOT, 'skn_new', f)));
  console.log(`${f} 品红像素: ${b.m.size}`);
}

// 3) 歌词窗鲸鱼区域颜色确认
const lyr = pyRead(path.join(ROOT, 'skn_new', 'lyric_skin.bmp'));
const lp = Buffer.from(lyr.px, 'base64');
const at = (x, y) => { const i = (y * lyr.w + x) * 3; return [lp[i], lp[i+1], lp[i+2]]; };
// 鲸鱼 logo 现在位于【底部不拉伸装饰带】的右下角 (252..324, 203..258)
console.log('鲸鱼区采样 (底部装饰带 x252..324, y203..258):');
console.log('  身体中心 (262,240):', at(262, 240).join(','));
console.log('  白色腹部 (272,235):', at(272, 235).join(','));
console.log('  尾鳍     (316,212):', at(316, 212).join(','));
console.log('  带外留白 (240,230):', at(240, 230).join(','));
// 统计品牌蓝像素数（rgba 众数 rgb(68,104,254)）
let brand = 0;
for (let y = 200; y < 262; y++) for (let x = 250; x < 330; x++) {
  const [r, g, b] = at(x, y);
  if (Math.abs(r - 68) < 12 && Math.abs(g - 104) < 12 && Math.abs(b - 254) < 12) brand++;
}
console.log(`  品牌蓝 rgb(68,104,254) 像素数: ${brand}`);
