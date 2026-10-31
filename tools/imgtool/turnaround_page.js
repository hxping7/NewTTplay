// 三视图标注版面（HTML → Chrome 截图）
const fs = require('fs');
const path = require('path');

const IMG = process.argv[2];
const OUT_HTML = process.argv[3];

const imgUrl = 'file:///' + path.resolve(IMG).replace(/\\/g, '/');

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;padding:34px 40px 30px;background:#f4f6fa;
  font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;color:#1b2340}
h1{font-size:25px;margin:0 0 6px;letter-spacing:.5px}
.sub{font-size:13px;color:#7a8299;margin:0 0 22px;line-height:1.7}
.sub b{color:#4468FE}
.sheet{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 12px rgba(24,38,80,.08)}
.sheet img{display:block;width:100%;border-radius:8px}
.caps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:14px}
.cap{background:#eef2fb;border-radius:9px;padding:9px 0;text-align:center;
  font-size:14px;font-weight:700;color:#2b3a66;letter-spacing:1px}
.cap small{display:block;font-weight:400;font-size:11px;color:#8a92ab;letter-spacing:0;margin-top:3px}
.foot{margin-top:20px;font-size:12px;color:#9aa2b8;line-height:1.8}
</style></head><body>
<h1>鲸鱼娘 · 角色三视图</h1>
<p class="sub">Q 版 2.5 头身 · 正面 / 正侧面 / 正背面 · 三视图等高、脚底共基线 · 赛璐璐上色<br>
用途：建模参考、周边打样、衍生绘制对齐、动画补帧比例校对</p>
<div class="sheet">
  <img src="${imgUrl}">
  <div class="caps">
    <div class="cap">正面<small>Front · 双手端饭碗</small></div>
    <div class="cap">正侧面<small>Side · 90° 右转</small></div>
    <div class="cap">正背面<small>Back · 鲸鱼尾与发梢</small></div>
  </div>
</div>
<div class="foot">设定不变量：头身比 2.5 头 / 耳鳍位置 / 围裙鲸鱼徽章 / 头顶呆毛卷 / 发色由根深至梢浅 / 深蓝+白+浅蓝点缀配色</div>
</body></html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(OUT_HTML);
