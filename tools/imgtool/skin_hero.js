/**
 * 重绘 skin 的鲸鱼娘形象元素
 *
 * 目标：
 *  1. player_skin.bmp 左侧 100x150 角色位 → AI 竖版立绘（嵌入深蓝渐变背景）
 *  2. TTPlayer.ico → AI 图标（48/32/16 三档）
 *  3. progress_thumb.bmp（14x14 进度滑块）→ 白饭碗缩略
 *  4. thumb.bmp（6x16 音量滑块）、eq_thumb.bmp（11x11）→ 换成鲸鱼主题小图标
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { cutout, readBmp, pngToBmpMagenta, SKIN, WORK, ROOT } = require('./skinpipe');

const MIO = 'C:/Users/Administrator/.workbuddy/plugins/data/mcp-miora/miora-media';
const SRC_PORTRAIT = path.join(MIO, 'miora_edit_image-1793160911891-0-dad8cf7ad7f6.png');
const SRC_ICON = path.join(MIO, 'miora_edit_image-1793160948126-0-6daa47a573da.png');

/** 主窗左侧角色区规格 */
const HERO = { x: 0, y: 0, w: 100, h: 150 };
/** 背景渐变（实测自原图） */
const GRAD_TOP = [10, 19, 51];
const GRAD_BOT = [54, 86, 218];

function gradAt(y, h) {
  const t = y / (h - 1);
  return [
    Math.round(GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t),
    Math.round(GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t),
    Math.round(GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t),
  ];
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });

  // ---------- 1. 抠图：AI 竖版立绘 ----------
  console.log('抠图中...');
  const hero = await cutout(SRC_PORTRAIT, { r: 207, g: 228, b: 245 }, 30);
  await sharp(hero.buffer).png().toFile(path.join(WORK, 'hero_cut.png'));
  console.log('  hero cut', hero.width + 'x' + hero.height);

  // 裁掉底部平台水印区（右下角 60px 见方），再抠
  const icon = await cutout(SRC_ICON, { r: 26, g: 38, b: 84 }, 999); // 图标是渐变底，整体保留
  console.log('  icon raw', icon.width + 'x' + icon.height);

  // ---------- 2. 主窗左侧：把角色合成到渐变背景上 ----------
  const canvas = Buffer.alloc(HERO.w * HERO.h * 3);
  for (let y = 0; y < HERO.h; y++) {
    const c = gradAt(y, HERO.h);
    for (let x = 0; x < HERO.w; x++) {
      const d = (y * HERO.w + x) * 3;
      canvas[d] = c[0]; canvas[d + 1] = c[1]; canvas[d + 2] = c[2];
    }
  }

  // 角色缩放到宽度 92（槽位 100，留 4px 边），底部贴边
  const targetW = 92;
  const scaled = await sharp(hero.buffer)
    .resize({ width: targetW, fit: 'inside', kernel: 'lanczos3' })
    .png().toBuffer();
  const sm = await sharp(scaled).metadata();
  const offX = Math.round((HERO.w - sm.width) / 2);
  const offY = HERO.h - sm.height;
  console.log('  角色缩放', sm.width + 'x' + sm.height, 'offset', offX, offY);

  // alpha 合成到渐变底
  const { data: sd, info: si } = await sharp(scaled).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < si.height; y++) {
    for (let x = 0; x < si.width; x++) {
      const tx = x + offX, ty = y + offY;
      if (tx < 0 || tx >= HERO.w || ty < 0 || ty >= HERO.h) continue;
      const a = sd[(y * si.width + x) * 4 + 3] / 255;
      if (a <= 0) continue;
      const s = (y * si.width + x) * 4, d = (ty * HERO.w + tx) * 3;
      canvas[d] = Math.round(sd[s] * a + canvas[d] * (1 - a));
      canvas[d + 1] = Math.round(sd[s + 1] * a + canvas[d + 1] * (1 - a));
      canvas[d + 2] = Math.round(sd[s + 2] * a + canvas[d + 2] * (1 - a));
    }
  }
  await sharp(canvas, { raw: { width: HERO.w, height: HERO.h, channels: 3 } })
    .png().toFile(path.join(WORK, 'hero_composited.png'));
  console.log('  hero composited ok');

  // ---------- 3. 图标：裁水印 + 缩到 48/32/16 ----------
  const iconClean = await sharp(SRC_ICON)
    .extract({ left: 0, top: 0, width: 1024, height: 940 })
    .png().toBuffer();
  await sharp(iconClean).resize({ width: 512, height: 512, fit: 'cover' }).png().toFile(path.join(WORK, 'icon_512.png'));
  console.log('  icon cleaned ok');

  console.log('阶段产物已生成，下一步合成回皮肤');
})();
