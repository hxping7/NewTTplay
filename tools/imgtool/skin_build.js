/**
 * 皮肤重建主流程：把 AI 素材合回 skin 的各个 BMP
 *
 * 产出（新目录，不覆盖原皮肤，便于回滚）：
 *   .workbuddy/skn_new/  ← 新皮肤包内容
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { cutout, pngToBmpMagenta, SKIN, WORK, ROOT } = require('./skinpipe');
const { cutoutAdaptive } = require('./cutout_adaptive');

const MIO = 'C:/Users/Administrator/.workbuddy/plugins/data/mcp-miora/miora-media';
const SRC_PORTRAIT = path.join(MIO, 'miora_edit_image-1793160911891-0-dad8cf7ad7f6.png');
const SRC_ICON = path.join(MIO, 'miora_edit_image-1793160948126-0-6daa47a573da.png');
const SRC_ICON_SIMPLE = path.join(MIO, 'miora_edit_image-1793161710208-0-f2e923f12d6d.png');

// 歌词窗背景用的「听音乐」Q 版立绘（1024x940 带 alpha）
const MUSIC_ART = 'D:/TTPlayer/jingyu-niang-assets/frames/S08_music.png';

// DeepSeek 官方蓝鲸 logo —— 矢量重绘版（老板提供的原图 → marching squares 矢量化）
// 723×549 viewBox, 品牌蓝 #4468FE, 逗号回旋身 + 右上分叉尾鳍 + 白腹 + 白眼窝(黑眼珠)
// 矢量化工具: imgtool/ds_logo_vectorize5.js
const DS_LOGO = 'D:/TTPlayer/jingyu-niang-assets/brand/deepseek_logo.svg';

const OUT = path.join(ROOT, 'skn_new');
const PY = 'python';
const BMPMOD = path.join(ROOT, 'imgtool', 'bmp.py');

/** 调 python 读写 BMP（避免大 buffer 走 JSON） */
function pyRead(file) {
  const script = `
import sys, json, base64
sys.path.insert(0, r'${path.join(ROOT, 'imgtool')}')
from bmp import read_bmp
w,h,px = read_bmp(r'${file}')
sys.stdout.write(json.dumps({'w':w,'h':h,'px':base64.b64encode(px).decode()}))
`;
  const r = execFileSync(PY, ['-c', script], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
  return JSON.parse(r);
}
function pyWrite(file, w, h, rgbBuf) {
  const tmp = path.join(WORK, '_w.bmp');
  fs.writeFileSync(tmp, rgbBuf);
  const script = `
import sys
sys.path.insert(0, r'${path.join(ROOT, 'imgtool')}')
from bmp import write_bmp
write_bmp(r'${file}', ${w}, ${h}, bytes(open(r'${tmp}','rb').read()))
`;
  execFileSync(PY, ['-c', script], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
}

/** 水平镜像（用于画对称装饰） */
function mirrorRGB(w, h, rgb) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = (y * w + (w - 1 - x)) * 3;
      out[d] = rgb[s]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s + 2];
    }
  }
  return out;
}

/** 在 RGB 画布上 alpha 合成一张 PNG（pos = 左上角） */
async function composite(rgbBuf, W, H, pngBuf, posX, posY, opacity = 1) {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const tx = x + posX, ty = y + posY;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      const a = (data[(y * info.width + x) * 4 + 3] / 255) * opacity;
      if (a <= 0) continue;
      const s = (y * info.width + x) * 4, d = (ty * W + tx) * 3;
      rgbBuf[d] = Math.round(data[s] * a + rgbBuf[d] * (1 - a));
      rgbBuf[d + 1] = Math.round(data[s + 1] * a + rgbBuf[d + 1] * (1 - a));
      rgbBuf[d + 2] = Math.round(data[s + 2] * a + rgbBuf[d + 2] * (1 - a));
    }
  }
}

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
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  // 复制原皮肤全部文件作为基底
  for (const f of fs.readdirSync(SKIN)) {
    fs.copyFileSync(path.join(SKIN, f), path.join(OUT, f));
  }
  console.log('基底复制完成');

  // ---------- 抠图 ----------
  // 用自适应泛洪（边缘采样背景色簇），能处理渐变白背景；固定色只对纯色背景有效
  // ⚠️ 先裁掉右下角 AI 平台水印，否则水印把背景"锚"住，泛洪抠不干净
  const heroSrc = await sharp(SRC_PORTRAIT)
    .extract({ left: 0, top: 0, width: 768, height: 984 })   // 裁掉底部水印带
    .png().toBuffer();
  const hero = await cutoutAdaptive(heroSrc, { tol: 22 });
  await sharp(hero.buffer).png().toFile(path.join(WORK, 'hero_cut.png'));
  console.log('hero 抠图', hero.width + 'x' + hero.height);

  // ---------- 1. player_skin.bmp 左侧角色位 ----------
  {
    const src = path.join(OUT, 'player_skin.bmp');
    const { w, h, px } = pyRead(src);
    const rgb = Buffer.from(px, 'base64');
    const HERO = { w: 100, h: 150 };

    // 先把原角色区(0..100, 0..150)用渐变盖掉
    for (let y = 0; y < HERO.h && y < h; y++) {
      const c = gradAt(y, HERO.h);
      for (let x = 0; x < HERO.w && x < w; x++) {
        const d = (y * w + x) * 3;
        rgb[d] = c[0]; rgb[d + 1] = c[1]; rgb[d + 2] = c[2];
      }
    }

    // 角色缩放：等比缩放 + 4x 超采样降采样
    // ⚠️ 铁律 1: 不能先 resize({height:136}) 再 resize({width:96}) ——
    //    第二次 resize 只给宽度不给高度, sharp 会连带压缩高度(136→128),
    //    造成纵向压扁, LANCZOS 在压缩过程中把白色围裙/浅色皮肤边缘混色,
    //    在脸和围裙上产生规则的白色方块(用户实机反馈"脸上和衣服上有白色方块")。
    //    正确做法: 一次 resize 同时给 width+height + fit:'inside', 保持宽高比。
    // ⚠️ 铁律 2: 超采样(先放大到 4x 再降回目标尺寸)能显著减少 LANCZOS 直接
    //    大幅降采样产生的混色/糊化, 脸部与围裙明显更干净。
    const MAXW = 100, MAXH = 150;
    const SS = 4;                       // 超采样倍率
    const big = await sharp(hero.buffer)
      .resize({ width: MAXW * SS, height: MAXH * SS, fit: 'inside', kernel: 'lanczos3' })
      .png().toBuffer();
    const scaled = await sharp(big)
      .resize({ width: MAXW, height: MAXH, fit: 'inside', kernel: 'lanczos3' })
      .png().toBuffer();
    const sm = await sharp(scaled).metadata();
    const offX = Math.round((HERO.w - sm.width) / 2);
    const offY = HERO.h - sm.height;
    await composite(rgb, w, h, scaled, offX, offY);

    // ⚠️ 铁律 3: 还原窗口圆角 —— 用渐变盖掉原角色区时会把左上/左下的圆角
    //    键控弧(品红)一并盖成直角, 窗口边缘看起来很生硬(用户反馈"左边是直角")。
    //    修法: 从【基底原图】读出四角真实的品红遮罩形状, 逐像素贴回。
    //    不用自己算圆弧 —— 基底的圆角是带抗锯齿的, 自己算会走形;
    //    直接复用原版遮罩能保证像素级一致。
    {
      const basePath = path.join(SKIN, 'player_skin.bmp');
      const base = pyRead(basePath);
      const bpx = Buffer.from(base.px, 'base64');
      const R = 16;                       // 扫描半径(覆盖基底实测的 12px 弧长)
      let restored = 0;
      // ⚠️ 注意方向: 上角向下扫(y+), 下角向上扫(y-), 否则会写出画布外
      for (const c of [{ x: 0, y: 0, dy: 1 }, { x: 0, y: h - 1, dy: -1 }]) {
        for (let yy = 0; yy < R; yy++) {
          const py_ = c.y + c.dy * yy;
          if (py_ < 0 || py_ >= h) continue;
          for (let xx = 0; xx < R; xx++) {
            const px_ = c.x + xx;
            if (px_ < 0 || px_ >= w) continue;
            const bi = (py_ * base.w + px_) * 3;
            if (bpx[bi] === 255 && bpx[bi + 1] === 0 && bpx[bi + 2] === 255) {
              const d = (py_ * w + px_) * 3;
              rgb[d] = 255; rgb[d + 1] = 0; rgb[d + 2] = 255;
              restored++;
            }
          }
        }
      }
      console.log(`player_skin.bmp 左侧圆角还原: ${restored} 个品红键控像素`);
    }
    pyWrite(src, w, h, rgb);
    console.log(`player_skin.bmp 角色替换完成 (${sm.width}x${sm.height} @ ${offX},${offY}) 等比+${SS}x超采样`);
  }

  // ---------- 2. TTPlayer.ico ----------
  {
    // 48/32 用精细版（裁掉平台水印），16 用极简扁平版
    const iconClean = await sharp(SRC_ICON)
      .extract({ left: 0, top: 0, width: 1024, height: 940 })
      .resize({ width: 512, height: 512, fit: 'cover' })
      .png().toBuffer();
    await fs.promises.writeFile(path.join(WORK, 'icon_512.png'), iconClean);

    // 极简版（16px 用）：纯色块，缩小后仍可辨
    const iconSimple = await sharp(SRC_ICON_SIMPLE)
      .extract({ left: 0, top: 0, width: 512, height: 460 })
      .resize({ width: 512, height: 512, fit: 'cover' })
      .png().toBuffer();
    await fs.promises.writeFile(path.join(WORK, 'icon_simple_512.png'), iconSimple);

    const R = 512 * 0.18;
    const iconPaths = [];
    for (const size of [48, 32, 16]) {
      const base = size === 16 ? iconSimple : iconClean;
      let resized = await sharp(base)
        .resize({ width: size, height: size, fit: 'cover', kernel: 'lanczos3' })
        .png().toBuffer();
      if (size === 32) {
        // 32px 档：轻度锐化即可，32px 仍能容纳原图细节
        resized = await sharp(resized)
          .sharpen({ sigma: 0.8, m1: 0.4, m2: 1.6 })
          .png().toBuffer();
      }
      const { data, info } = await sharp(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = Buffer.alloc(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          // 圆角遮罩（按 512 基准比例换算）
          const rr = R * size / 512;
          let inside = true;
          const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
          if (cx < rr && cy < rr) {
            const dx = rr - cx, dy = rr - cy;
            inside = (dx * dx + dy * dy) <= rr * rr;
          }
          out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2];
          out[i + 3] = inside ? data[i + 3] : 0;
        }
      }
      const p = path.join(WORK, `icon_${size}.png`);
      await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toFile(p);
      iconPaths.push(`${p}:${size}`);
    }
    // 生成 ICO
    const icoPath = path.join(OUT, 'TTPlayer.ico');
    execFileSync(PY, [BMPMOD, 'ico', icoPath, ...iconPaths], { encoding: 'utf8' });
    console.log('TTPlayer.ico 生成完成 (48/32/16)');
  }

  // ---------- 3. 歌词窗 / 播放列表窗：加入 Q 版小像剪影 ----------
  {
    // 小头像：从主形象裁头部
    const head = await sharp(hero.buffer)
      .extract({ left: 120, top: 60, width: 530, height: 500 })
      .resize({ width: 300, height: 300, fit: 'cover', position: 'top' })
      .png().toBuffer();

    // 全身剪影（保留女仆装+鲸鱼尾的完整轮廓，比只有头部更像"女仆听歌"）
    const full = await sharp(hero.buffer)
      .resize({ width: 300, height: 300, fit: 'inside', kernel: 'lanczos3' })
      .png().toBuffer();

    /** 把带 alpha 的图转成单色剪影（保留 alpha 作为遮罩） */
    const toSilhouette = async (pngBuf, rgbColor) => {
      const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = Buffer.alloc(info.width * info.height * 4);
      for (let i = 0; i < info.width * info.height; i++) {
        const a = data[i * 4 + 3];
        out[i * 4] = rgbColor[0]; out[i * 4 + 1] = rgbColor[1]; out[i * 4 + 2] = rgbColor[2];
        out[i * 4 + 3] = a;
      }
      return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    };

    // ⚠️ 铁律 1: 必须放在 Skin.xml 声明的 resize_rect 可视区内, 否则 TTPlayer 渲染时裁掉
    //    lyric_window   resize_rect="46, 32, 307, 194" → 可视区 x∈[46,307) y∈[32,194)
    //    playlist_window resize_rect="64, 52, 305, 188" → 可视区 x∈[64,305) y∈[52,188)
    //    （原实现加在 x=30 / x=258, 全部落在可视区外 → 剪影根本没显示出来）
    //
    // ⚠️ 铁律 2: 实测原版歌词窗可视区内, 所有艺术元素(音符/小鲸鱼/胖鲸鱼)都在
    //    **底部 y∈[122,194)**; 上半 y∈[32,120) 是完全空白的深蓝渐变。
    //    所以剪影必须放上半区, 放底部会被鲸鱼群压住/混淆。
    //    歌词文字从左侧渲染(lyric position="5,32,307,194" 相对窗口),
    //    因此剪影放**右侧**, 避免被歌词文字压住。

    // ===================================================================
    // 歌词窗重做（v3 · 方案二「1:1 海洋缸」）
    //
    // 关键事实（全部实测标定，不是猜的）：
    //
    // 1) 歌词控件 <lyric position="5,32,250,194"/> 会画一块**不透明底板**，
    //    覆盖窗口 x∈[5,250] **整列到底**（真机实测：x=100 从 y=130 一直到 y=312
    //    都是 #0e1a4a(14,26,74)）。写在那一区域的图 100% 被遮死。
    //    ⇒ 所有实体美术必须落在【位图 x ≥ 250】。
    //
    // 2) 九宫格语义：resize_rect="L, T, X_right, Y_bottom" 是**位图坐标**
    //    （左边厚, 上边厚, 右列起点 x, 底带起点 y），不是厚度。
    //    旧值 "46,32,250,194" ⟺ 帧 (46,32,150,80)：
    //      左列 x0..45 / 顶行 y0..31 / 右列 x250..399 / 底带 y194..273
    //      纵向拉伸区 = 位图 y32..193
    //    实测：**只有四个角双向固定**，右列 y32..193 会被纵向拉长
    //    （在右列画 60px 标记，窗口 319→520 时变成 165px）。
    //    ⇒ 方案二把 Y_bottom 从 194 提到 120：
    //        resize_rect="46, 32, 250, 120" ⟺ 帧 (46,32,150,154)
    //        右下角 x250..399 × y120..273 = 150×154，**双向 1:1**
    //        纵向拉伸区只剩位图 y32..119（88 行），里面只放纯色渐变 + 竖直光柱
    //        （竖直光柱的横向剖面与纵向位置无关，拉伸后看不出变形）
    //
    // 3) logo（位图 252,203 72×55）与胖鲸娘（位图 330,202 62×57）必须留在
    //    固定区里 → 它们的屏幕位置不随窗口高度变化（已用模拟器验证 319/520 一致）。
    //
    // 4) 底板色 #0e1a4a 与水色在 x=250 直接相接会有竖直硬边 →
    //    海洋美术模块 ocean/ocean_art.py 在列内做 16px ease-out 过渡。
    //
    // 本次改动（相对 v2）：
    //   a) resize_rect 下沿 194 → 120，右下角整块变成 1:1 固定区
    //   b) 右列换成「1:1 海洋缸」：鱼/海草/珊瑚/海床全部落在固定区
    //   c) 实体美术只放位图 y≥120；y32..119 只留渐变 + 竖直光柱
    //   d) 底部圆角边框（基底 194..199 → 268..273）原样保留
      // ===================================================================
      {
        const src = path.join(OUT, 'lyric_skin.bmp');
        const b0 = pyRead(src);
        const w = b0.w, h0 = b0.h;
        const bpx0 = Buffer.from(b0.px, 'base64');

        // ---- 方案二几何常量（必须与 ocean/ocean_art.py 完全一致）----
        const RESIZE_BOT = 120;          // resize_rect 下沿（位图行号）
        const COL_X = 250;               // 右列左边界（位图 x）
        const COL_W = 150;               // 右列宽
        const BMP_TOP = 32;              // 右列起始行（= resize_rect 上沿）
        const EDGE_H = h0 - 194;         // 原图底部边框 6px（含圆角）
        const h = 274;                   // 位图总高：120 + 154
        // 固定区 = 位图 y120..273（154px）；拉伸区 = y32..119（88px）
        const OCEAN_H = h - BMP_TOP;               // 242（覆盖 y32..273）
        const PANEL = [14, 26, 74];                // 歌词控件不透明底板 #0e1a4a

        const rgb = Buffer.alloc(w * h * 3);

        // (a) 原图上半部 0..193 原样搬过来
        //     · y 0..31   → 标题栏（固定顶行）
        //     · y 32..119 → 纵向拉伸区（左缘那条蓝色渐变边随之拉伸）
        //     · y 120..193→ 固定区左半，延续同一条渐变（否则窗口左缘会突然变色）
        for (let y = 0; y < 194; y++) {
          bpx0.copy(rgb, y * w * 3, y * w * 3, (y + 1) * w * 3);
        }
        // (a2) 清掉原版装饰残留，刷成纯渐变底（中列渐变横向均匀，实测 x60==x100==x253）：
        //      · 右侧 x≥246：原版胖鲸鱼/小鲸鱼/音符，压在歌词底板边界上
        //      · 中央 x46..245：基底 y164..192 有原版鲸鱼剪影 —— 方案二后落在
        //        拉伸区/固定区交界，真机里虽被歌词控件底板盖住，但不再赌覆盖关系
        //      底色是非线性渐变：取基底该行【无内容处】的像素当整行底色。
        {
          const base = pyRead(path.join(SKIN, 'lyric_skin.bmp'));
          const bpx = Buffer.from(base.px, 'base64');
          let cleared = 0;
          for (let y = 34; y < 194; y++) {
            const at = (x0) => { const bi = (y * base.w + x0) * 3;
                                 return [bpx[bi], bpx[bi + 1], bpx[bi + 2]]; };
            const cm = at(60), cr = at(253);
            for (let x = 46; x < w; x++) {
              const c = x < 246 ? cm : cr;
              const d = (y * w + x) * 3;
              if (rgb[d] !== c[0] || rgb[d + 1] !== c[1] || rgb[d + 2] !== c[2]) cleared++;
              rgb[d] = c[0]; rgb[d + 1] = c[1]; rgb[d + 2] = c[2];
            }
          }
          console.log(`lyric_skin.bmp 装饰残留已清空(右侧+中央, 重写 ${cleared} px)`);
        }
        // (b) 左边框条(x0..4)全高统一 + 歌词底板填充：
        //     老板报"左边线条粗细不一样"。三个实测根因：
        //     ① 原设计左缘是纵向渐变(暗→亮)，九宫格分三段后拉伸段(只含渐变的暗段,
        //        被拉长) / 1:1 段(渐亮) / 插入段 亮度各异 ⇒ 看起来忽粗忽细；
        //     ② 基底左下角圆弧的抗锯齿/品红在 189..193 行(x0..1)——v3 把这段抬到
        //        窗户中部, 弧的透明像素在窗中间透出桌面成缺口(实抓 x0=255 白点)；
        //     ③ 边框条只能占 x0..4：歌词控件底板从 x=5 画到窗高 H-80 处, 更深的
        //        底部带(H-80..H-7)位图直接可见 —— x5..9 若也刷边框剖面色(27,47,134)
        //        就在底板色旁露出一条浅色竖线(老板报"还有一小段浅色的线条")。
        //     ⇒ x0..4 全高(32..267)统一为「弧前稳态行 188」剖面(深蓝条+亮线 x4)，
        //        粗细/亮度全高恒定、任何窗高不变，下端直落 268 行圆弧；
        //     x5..249 在 194..267 一律填歌词底板色(与控件底板无缝)。
        for (let y = 32; y < h - EDGE_H; y++) {
          for (let x = 0; x < 5; x++) {
            const si = (188 * w + x) * 3, d = (y * w + x) * 3;
            rgb[d] = bpx0[si]; rgb[d + 1] = bpx0[si + 1]; rgb[d + 2] = bpx0[si + 2];
          }
          if (y >= 194) {
            for (let x = 5; x < COL_X; x++) {
              const d = (y * w + x) * 3;
              rgb[d] = PANEL[0]; rgb[d + 1] = PANEL[1]; rgb[d + 2] = PANEL[2];
            }
          }
        }
        // (c) 海洋美术贴进右列（位图 x250..399, y32..273）
        //     美术模块内部已做：上段（y<120）只留渐变+竖直光柱、
        //     下段（y>=120）放鱼/海草/珊瑚/海床、左缘 16px 与底板色过渡。
        {
          const oceanPng = path.join(ROOT, 'ocean', 'ocean_col.png');
          if (!fs.existsSync(oceanPng)) {
            throw new Error('缺少海洋美术: ' + oceanPng + ' （先跑 python ocean/ocean_art.py）');
          }
          const art = await sharp(oceanPng)
            .resize({ width: COL_W, height: OCEAN_H, fit: 'fill', kernel: 'lanczos3' })
            .png().toBuffer();
          await composite(rgb, w, h, art, COL_X, BMP_TOP, 1);
          console.log(`lyric_skin.bmp 海洋美术 ok @ (${COL_X},${BMP_TOP}) ${COL_W}x${OCEAN_H}`
                    + `（固定区 y>=${RESIZE_BOT} 双向 1:1）`);
        }
        // (c2) 竖直接缝柔化由 ocean_art.py 内部完成（列左缘 16px ease-out 过渡到
        //      歌词底板色 #0e1a4a），这里不再叠加第二层 —— 双重过渡会把
        //      水色冲淡成灰蓝。右列横向恒 1:1，过渡宽度变化也不会错位。
        //
        // (d) 底部边框（圆角+描边）搬到最后 6 行（基底 194..199 → 268..273）
        //     ⚠️ 这 6 行含窗口左右下角的品红键控圆角，必须原样保留，
        //        否则窗口会变成方角、且透明区被填实。
        for (let k = 0; k < EDGE_H; k++) {
          const sy = 194 + k, dy = h - EDGE_H + k;
          bpx0.copy(rgb, dy * w * 3, sy * w * 3, (sy + 1) * w * 3);
        }
        console.log(`lyric_skin.bmp 高度 ${h0} → ${h}（resize_rect 下沿 194 → ${RESIZE_BOT}，`
                  + `右下角 ${COL_W}x${h - RESIZE_BOT} 双向 1:1）`);

        /** 1:1 贴图（固定区内不做任何预压缩，像素即屏幕像素） */
        const place1to1 = async (png, px_, py_, dw, dh, opacity = 1) => {
          const art = await sharp(png)
            .resize({ width: dw, height: dh, fit: 'fill', kernel: 'lanczos3' })
            .png().toBuffer();
          await composite(rgb, w, h, art, px_, py_, opacity);
          return { width: dw, height: dh };
        };

        // (e) 页脚左：DeepSeek 官方蓝鲸 logo（1:1，永不变形）
        //     ⚠️ 必须放在【右下角固定区】x≥250 —— 九宫格里只有四个角是双向固定的，
        //        放在中列会被纵向拉伸，放在左列会被横向拉伸。
        //     位图 (252,203) 落在固定区 y≥120 内 → 屏幕位置与旧版完全一致。
        {
          const svg = fs.readFileSync(DS_LOGO, 'utf8');
          const dw = 72, dh = 55;                 // 72/1.317 ≈ 55
          const am = await place1to1(Buffer.from(svg), 252, 203, dw, dh);
          console.log(`lyric_skin.bmp DeepSeek官方logo ok @ (252,203) 1:1 ${am.width}x${am.height}（不变形）`);
        }

        // (f) 页脚右：Q 版「听音乐」（1:1，永不变形）
        //     原始素材 1024x940(比例1.089) → 62x57 保持比例, 竖直居中 y=202
        {
          const dw = 62, dh = 57;
          const am = await place1to1(MUSIC_ART, 330, 202, dw, dh);
          console.log(`lyric_skin.bmp Q版听音乐 ok @ (330,202) 1:1 ${am.width}x${am.height}（不变形）`);
        }

        pyWrite(src, w, h, rgb);
      }

    // playlist_skin.bmp: 女仆剪影 → 放【底部空白区】(y 140..188),
    //    ⚠️ 不能放右上角: 原版右上角本来就有一只鲸鱼剪影(x≈240..305, y≈38..72),
    //    放那里会把鲸鱼盖住 → 用户反馈"右上角那只鲸鱼显示不对"。
    //    实测可视区结构: y[52,136) 是列表内容区(被文字覆盖), y[140,188) 是底部空白。
    {
      const src = path.join(OUT, 'playlist_skin.bmp');
      const { w, h, px } = pyRead(src);
      const rgb = Buffer.from(px, 'base64');
      const SIL = 44;
      const sil = await toSilhouette(
        await sharp(full).resize({ width: SIL, height: SIL, fit: 'inside', kernel: 'lanczos3' }).png().toBuffer(),
        [30, 48, 132]);
      // 底部靠右, 底边贴 y=186
      await composite(rgb, w, h, sil, 258, 186 - SIL, 0.85);
      pyWrite(src, w, h, rgb);
      console.log(`playlist_skin.bmp 女仆剪影 ok @ (258,${186 - SIL}) ${SIL}x${SIL}`);
    }
  }

  // ---------- 4. 滚动条三件套 ----------
  // ⚠️ TTPlayer 渲染滚动条时【不做品红键控】——原版 TT-07 的这三个 bmp 品红像素全为 0。
  //    底座沿用的品红版本会原样显示成品红色块(用户反馈"滚动条又出现品红色了")。
  //    必须在 skin_build 之后重新生成(基底复制会覆盖它们)。
  {
    execFileSync('node', [path.join(ROOT, 'imgtool', 'build_scrollbar.js')], { encoding: 'utf8' })
      .trim().split('\n').forEach(l => console.log('  ' + l));
  }

  // ---------- 5. Skin.xml: 歌词窗几何（方案二） ----------
  // ① 歌词控件宽度 307 → 250：底板只盖到 x≈240，右侧腾出 150px 完整装饰区。
  //    (230 太窄, 长歌词快贴边; 307 右侧只剩 100px 窄边)
  // ② resize_rect 下沿 194 → 120：右下角 x250..399 × y120..273 变成双向 1:1 固定区，
  //    海洋实体美术（鱼/海草/珊瑚/海床）全部落在这里，窗口拉高不变形。
  //    ⚠️ resize_rect 是【位图坐标】(左边厚,上边厚,右列起点x,底带起点y)，不是厚度。
  {
    const sp = path.join(OUT, 'Skin.xml');
    let sx = fs.readFileSync(sp, 'utf8');

    // ① lyric 控件
    const LYRIC_OLD = ['<lyric position="5, 32, 307, 194"/>', '<lyric position="5, 32, 250, 194"/>'];
    const LYRIC_NEW = '<lyric position="5, 32, 250, 194"/>';
    if (sx.includes(LYRIC_OLD[0])) {
      sx = sx.replace(LYRIC_OLD[0], LYRIC_NEW);
      fs.writeFileSync(sp, sx, 'utf8');
      console.log('Skin.xml: lyric 控件宽度 307 → 250 (右侧让出装饰区)');
    } else if (sx.includes(LYRIC_NEW)) {
      console.log('Skin.xml: lyric 控件已是 250 宽, 跳过');
    } else {
      console.log('Skin.xml: ⚠️ 未找到 lyric 标签, 请检查');
    }

    // ② resize_rect
    const RR_OLD = ['resize_rect="46, 32, 307, 194"', 'resize_rect="46, 32, 250, 194"'];
    const RR_NEW = 'resize_rect="46, 32, 250, 120"';
    let s2 = fs.readFileSync(sp, 'utf8');
    if (s2.includes(RR_OLD[0])) {
      s2 = s2.replace(RR_OLD[0], RR_NEW);
      fs.writeFileSync(sp, s2, 'utf8');
      console.log('Skin.xml: resize_rect 46,32,307,194 → 46,32,250,120 (右下角双向 1:1)');
    } else if (s2.includes(RR_OLD[1])) {
      s2 = s2.replace(RR_OLD[1], RR_NEW);
      fs.writeFileSync(sp, s2, 'utf8');
      console.log('Skin.xml: resize_rect 下沿 194 → 120 (右下角双向 1:1)');
    } else if (s2.includes(RR_NEW)) {
      console.log('Skin.xml: resize_rect 已是 46,32,250,120, 跳过');
    } else {
      console.log('Skin.xml: ⚠️ 未找到 resize_rect');
    }
  }

  console.log('\n输出目录:', OUT);
})();
