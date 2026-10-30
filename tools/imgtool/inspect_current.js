// 从当前已部署的 skn_new/lyric_skin.bmp 里, 把鲸鱼所在区域原样放大导出
// 目的是看【位图里的真实像素】, 而不是模拟渲染 —— 避免再次误判
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = 'D:/TTPlayer/.workbuddy';
const OUT = path.join(ROOT, 'imgtool', 'whale_preview');

function pyRead(file) {
  const script = `
import sys, json, base64
sys.path.insert(0, r'${path.join(ROOT, 'imgtool')}')
from bmp import read_bmp
w,h,px = read_bmp(r'${file}')
sys.stdout.write(json.dumps({'w':w,'h':h,'px':base64.b64encode(px).decode()}))
`;
  const r = execFileSync('python', ['-c', script], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
  return JSON.parse(r);
}

const f = process.argv[2] || path.join(ROOT, 'skn_new', 'lyric_skin.bmp');
const base = pyRead(f);
const { w, h } = base;
const px = Buffer.from(base.px, 'base64');

(async () => {
  // 鲸鱼所在区域: 位图 (274,124) 起, 宽112 高31
  const region = { left: 270, top: 118, width: 120, height: 40 };
  await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .extract(region)
    .resize({ width: 720, kernel: 'nearest' })
    .png().toFile(path.join(OUT, 'current_whale_bitmap.png'));
  console.log('当前位图里的鲸鱼区域(720宽放大):', path.join(OUT, 'current_whale_bitmap.png'));

  // 整张右侧装饰区
  await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .extract({ left: 246, top: 0, width: 154, height: 200 })
    .resize({ width: 616, kernel: 'nearest' })
    .png().toFile(path.join(OUT, 'current_decor_area.png'));
  console.log('当前装饰区全貌:', path.join(OUT, 'current_decor_area.png'));
})();
