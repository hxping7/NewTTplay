// 生成带中文标签的表情差分总览图（HTML → Chrome headless 截图）
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
const OUT = process.argv[3];

const items = [
  ['头像_256_E01_开心大笑.png', 'E01 开心大笑', '眼睛弯月牙 · 张嘴笑'],
  ['头像_256_E02_生气鼓脸.png', 'E02 生气鼓脸', '皱眉 · 鼓颊 · 怒气符号'],
  ['头像_256_E03_委屈含泪.png', 'E03 委屈含泪', '眼角泪光 · 嘴角下撇'],
  ['头像_256_E04_惊讶.png', 'E04 惊讶', '睁大眼 · O 形嘴'],
  ['头像_256_E05_害羞脸红.png', 'E05 害羞脸红', '双手捂脸 · 大面积红晕'],
  ['头像_256_E06_困倦打哈欠.png', 'E06 困倦打哈欠', '半闭眼 · 泪滴'],
  ['头像_256_E07_歪头思考.png', 'E07 歪头思考', '头微歪 · 手托下巴'],
  ['头像_256_E08_傲娇得意.png', 'E08 傲娇得意', '眯眼笑 · 挑眉轻哼'],
];

const cards = items.map(([file, name, desc]) => `
  <div class="card">
    <div class="thumb"><img src="file:///${path.resolve(DIR, file).replace(/\\/g, '/')}" width="176" height="176"></div>
    <div class="meta">
      <div class="name">${name}</div>
      <div class="desc">${desc}</div>
    </div>
  </div>`).join('');

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;padding:36px 40px 40px;background:#f4f6fa;
  font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;color:#1b2340}
h1{font-size:26px;margin:0 0 6px;letter-spacing:.5px}
.sub{font-size:13px;color:#7a8299;margin:0 0 26px;line-height:1.7}
.sub b{color:#4468FE}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.card{background:#fff;border-radius:14px;padding:14px 14px 16px;
  box-shadow:0 2px 10px rgba(24,38,80,.07);display:flex;flex-direction:column;align-items:center}
.thumb{width:176px;height:176px;border-radius:12px;overflow:hidden;
  background:linear-gradient(160deg,#0f1a3c 0%,#16264f 100%);
  display:flex;align-items:center;justify-content:center}
.thumb img{display:block;image-rendering:auto}
.meta{margin-top:12px;text-align:center}
.name{font-size:15px;font-weight:700;letter-spacing:.3px}
.desc{font-size:12px;color:#8a92ab;margin-top:4px}
.foot{margin-top:26px;font-size:12px;color:#9aa2b8;border-top:1px solid #e3e8f2;padding-top:14px}
</style></head><body>
<h1>鲸鱼娘 · 表情差分集</h1>
<p class="sub">8 个表情头像，统一 <b>256×256</b> 透明底 PNG · Q 版 2.5 头身 · 赛璐璐上色 · 与主形象同源<br>
用途：皮肤状态提示、桌宠交互反馈、聊天头像、表情包底图</p>
<div class="grid">${cards}</div>
<div class="foot">原始分辨率头像见同目录 <code>头像_E*.png</code>（约 380–430px，透明底）；归一化头像为 <code>头像_256_E*.png</code></div>
</body></html>`;

const htmlPath = path.join(DIR, '_sheet.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(htmlPath);
