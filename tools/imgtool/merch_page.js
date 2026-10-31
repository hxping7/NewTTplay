// 周边样机标注版面（HTML → Chrome 截图）
const fs = require('fs');
const path = require('path');

const IMG = process.argv[2];
const OUT_HTML = process.argv[3];
const imgUrl = 'file:///' + path.resolve(IMG).replace(/\\/g, '/');

const items = [
  ['白色短袖 T 恤', '胸前角色印花'],
  ['陶瓷马克杯', '杯身角色印花'],
  ['亚克力立牌', '透明材质 · 台座'],
  ['方形抱枕', '满版角色印花'],
  ['圆形徽章', '58mm 马口铁'],
  ['贴纸套装', '含鲸鱼小图标'],
];

const tags = items.map(([n, d]) => `<div class="tag"><b>${n}</b><span>${d}</span></div>`).join('');

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;padding:34px 40px 30px;background:#f4f6fa;
  font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;color:#1b2340}
h1{font-size:25px;margin:0 0 6px;letter-spacing:.5px}
.sub{font-size:13px;color:#7a8299;margin:0 0 22px;line-height:1.7}
.sub b{color:#4468FE}
.sheet{background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 12px rgba(24,38,80,.08)}
.sheet img{display:block;width:100%;border-radius:8px}
.tags{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:14px}
.tag{background:#eef2fb;border-radius:9px;padding:9px 6px;text-align:center}
.tag b{display:block;font-size:13px;color:#2b3a66}
.tag span{display:block;font-size:11px;color:#8a92ab;margin-top:3px}
.foot{margin-top:18px;font-size:12px;color:#9aa2b8;line-height:1.8}
</style></head><body>
<h1>鲸鱼娘 · 周边样机</h1>
<p class="sub">角色 IP 周边提案 · 6 件产品 · 图案统一取自 <b>鲸鱼娘_主形象_透明.png</b><br>
用途：周边提案 / 打样参考 / 配色与印刷尺寸校对</p>
<div class="sheet">
  <img src="${imgUrl}">
  <div class="tags">${tags}</div>
</div>
<div class="foot">印刷注意：角色主体为深海军蓝 #1E2A5A 与浅蓝 #7FC4E8，浅色底材上建议整体加一圈极细描边避免边缘糊；徽章与贴纸按 300dpi 出图。</div>
</body></html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(OUT_HTML);
