/**
 * 滚动条三件套重建（按原版 TT-07 规格）
 *
 * ⚠️ 关键事实: TTPlayer 渲染滚动条时【不做品红键控】——直接把位图贴上去。
 *    原版 TT-07 的 scrollbar_bar/button/thumb 三个 bmp 品红像素全是 0。
 *    所以这三个文件【绝对不能用品红做透明】, 否则品红会原样显示成刺眼的色块。
 *
 * 规格（与原版一致）:
 *   scrollbar_bar.bmp     8x39   纯深色槽
 *   scrollbar_button.bmp  24x14  3 帧横排, 每帧 8px
 *   scrollbar_thumb.bmp   24x36  3 帧竖排(每帧 8 列), 帧间无间隔
 */
const fs = require('fs');
const path = require('path');

const OUT = 'D:/TTPlayer/.workbuddy/skn_new';

// 深蓝配色(与播放列表窗底色协调): 槽=深黑蓝, 滑块=蓝, 高亮=亮蓝
const BAR_BG = [7, 12, 34];       // 槽底
const BAR_EDGE = [4, 7, 22];      // 槽两侧暗边
const THUMB_IDLE = [46, 62, 118];  // 滑块普通态
const THUMB_HI = [62, 197, 235];   // 滑块悬停/按压态(亮蓝)
const THUMB_DARK = [16, 22, 52];   // 滑块描边
const BTN_IDLE = [40, 54, 104];
const BTN_HI = [62, 197, 235];

/** 画一个圆角/斜角滑块条(8px 宽, 高 h) */
function drawThumb(w, h, frameIdx) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, c) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  const main = frameIdx === 0 ? THUMB_IDLE : THUMB_HI;
  const light = frameIdx === 0 ? [72, 96, 168] : [150, 226, 250];

  // 每帧 8 列, 画一根 4px 宽的竖条(居中), 带上下斜角收口
  const fw = w / 3;
  for (let f = 0; f < 3; f++) {
    const x0 = f * fw;
    const cx = x0 + fw / 2;             // 帧中心
    const halfW = 2.0;                 // 条半宽
    const cap = 4;                     // 上下收口高度
    for (let y = 0; y < h; y++) {
      let ww = halfW;
      if (y < cap) ww = halfW * (0.35 + 0.65 * (y + 0.5) / cap);
      else if (y >= h - cap) ww = halfW * (0.35 + 0.65 * (h - y - 0.5) / cap);
      const xa = Math.round(cx - ww), xb = Math.round(cx + ww);
      for (let x = xa; x <= xb; x++) {
        // 描边
        const isEdge = (x === xa || x === xb || y === 0 || y === h - 1);
        set(x, y, isEdge ? THUMB_DARK : main);
      }
      // 高光条(左 1px)
      set(Math.round(cx - halfW) + 1, y, light);
    }
  }
  return px;
}

/** 画滚动条按钮(8x14 一帧, 3 帧横排) —— 朝上的小三角 */
function drawButton(w, h) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, c) => {
    const i = (y * w + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  const fw = w / 3;
  for (let f = 0; f < 3; f++) {
    const x0 = f * fw;
    const main = f === 0 ? BTN_IDLE : BTN_HI;
    const cx = x0 + (fw - 1) / 2;          // 帧中心(整数)
    // 三角形: 顶点在上, 底边在下
    const top = 3, bot = h - 4;
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / Math.max(1, bot - top);   // 0=顶 1=底
      const half = 3 * (1 - t);                       // 上窄下宽
      const xa = Math.round(cx - half), xb = Math.round(cx + half);
      for (let x = xa; x <= xb; x++) {
        const isEdge = (x === xa || x === xb);
        set(x, y, isEdge ? [10, 16, 44] : main);
      }
      // 底边描边
      if (y === bot) for (let x = xa; x <= xb; x++) set(x, y, [10, 16, 44]);
    }
    // 顶点在正中
    set(Math.round(cx), top, main);
  }
  return px;
}

/** 画滚动条槽(8x39) */
function drawBar(w, h) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const c = (x === 0 || x === w - 1) ? BAR_EDGE : BAR_BG;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  }
  return px;
}

// ---- 写 BMP(24bpp, 行自底向上, 4字节对齐) ----
function writeBmp(file, w, h, rgb) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const dataSize = rowSize * h;
  const bmp = Buffer.alloc(54 + dataSize);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(w, 18);
  bmp.writeInt32LE(h, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(dataSize, 34);
  bmp.writeInt32LE(3780, 38);
  bmp.writeInt32LE(3780, 42);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 3;
    const dstRow = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 3, di = dstRow + x * 3;
      bmp[di] = rgb[si + 2]; bmp[di + 1] = rgb[si + 1]; bmp[di + 2] = rgb[si];
    }
  }
  fs.writeFileSync(file, bmp);
}

const files = [
  ['scrollbar_bar.bmp', 8, 39, drawBar],
  ['scrollbar_button.bmp', 24, 14, drawButton],
  ['scrollbar_thumb.bmp', 24, 36, drawThumb],
];
for (const [name, w, h, fn] of files) {
  const rgb = fn(w, h);
  writeBmp(path.join(OUT, name), w, h, rgb);
  // 校验无品红
  let mag = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i] === 255 && rgb[i + 1] === 0 && rgb[i + 2] === 255) mag++;
  }
  console.log(`${name} ${w}x${h} 品红=${mag} ${mag === 0 ? 'OK' : 'FAIL'}`);
}
