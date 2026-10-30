# -*- coding: utf-8 -*-
"""
胖鲸鱼皮肤资产生成器 —— 目标: 原版千千静听 5.7.9 (.skn = ZIP)
用法:
  python gen_skin.py           生成 skin-build/ 全套 + DeepSeekWhale.skn
  python gen_skin.py preview   额外输出 preview/ 放大预览图
几何约定(全部照 TT-07 原版语义):
  按钮位图 = 4 帧横排条带, 帧宽 = 位图宽/4, 控件 rect 与帧同尺寸
  number.bmp = 12 格(0-9 : -) 每格 10x14
  滚动条 = 3 帧条带; EQ 填充 = 竖/横渐变条; 透明色 = #FF00FF
"""
import os, sys, math, zipfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'whale-assets')
OUT = os.path.join(ROOT, 'skin-build')
PREV = os.path.join(ROOT, 'preview')
S = 4                      # 超采样倍率
MAG = (255, 0, 255)

# ---- DeepSeek 胖鲸鱼配色 ----
NAVY   = (12, 22, 56)      # 深海底色
NAVY2  = (22, 38, 106)
BLUE   = (77, 107, 254)    # DeepSeek 官方蓝 #4D6BFE
BLUE2  = (58, 91, 224)
BLUE3  = (43, 75, 216)
SKY    = (126, 166, 255)
ICE    = (207, 224, 255)
CREAM  = (255, 249, 238)
WHITE  = (255, 255, 255)
DRESS  = (30, 42, 92)      # 女仆裙藏青

F_MSYH  = 'C:/Windows/Fonts/msyh.ttc'
F_MSYHB = 'C:/Windows/Fonts/msyhbd.ttc'

def font(path, px):
    return ImageFont.truetype(path, px * S)

# ---------------------------------------------------------------- 基础绘制
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(w, h, stops):
    """stops: [(y0,color),(y1,color)...] 归一化 y 0..1"""
    im = Image.new('RGB', (w * S, h * S))
    px = im.load()
    for y in range(h * S):
        t = y / (h * S - 1)
        for i in range(len(stops) - 1):
            (y0, c0), (y1, c1) = stops[i], stops[i + 1]
            if y0 <= t <= y1:
                tt = 0 if y1 == y0 else (t - y0) / (y1 - y0)
                col = lerp(c0, c1, tt)
                break
        for x in range(w * S):
            px[x, y] = col
    return im

def rmask(w, h, r):
    m = Image.new('L', (w * S, h * S), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w * S - 1, h * S - 1], radius=r * S, fill=255)
    return m.resize((w, h), Image.LANCZOS)

def snap_magenta(im):
    """色键边晕清理: 任何美术色与品红底的混合都满足 r、b 同高于 g;
    美术色板(藏青/蓝/冰蓝/奶油/白)均不满足, 可安全全收成纯 #FF00FF。
    阈值必须收紧到 +10: 2026-10-28 实测 +40 只清高比例混色, 15~25% 低比例混色
    (如 (160,132,255)/(36,16,70)) 在蓝底上仍显示为粉紫小点(用户报"红点")。"""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y][:3]
            if r > g + 10 and b > g + 10 and r + b > 60:
                px[x, y] = MAG
    return im

def down(im, w, h):
    return im.resize((w, h), Image.LANCZOS)

def finish_shape(im_S, name, w, h, r):
    """S 倍内容 → 缩到最终尺寸 → 经圆角 mask 贴到品红底 → 存 BMP(返回最终图)"""
    im = down(im_S, w, h)
    bg = Image.new('RGB', (w, h), MAG)
    bg.paste(im, (0, 0), rmask(w, h, r))
    snap_magenta(bg)
    bg.save(os.path.join(OUT, name))
    return bg

def save(im, name, w, h):
    im = down(im, w, h)
    snap_magenta(im)
    im.save(os.path.join(OUT, name))
    return im

def save_prev(im, name, w, h, zoom=3):
    os.makedirs(PREV, exist_ok=True)
    im2 = down(im, w, h).resize((w * zoom, h * zoom), Image.NEAREST)
    im2.save(os.path.join(PREV, name))

# ---------------------------------------------------------------- 抠图
def cutout(path, crop, clears=(), tol=26, erode=1, gray_bg=False):
    """白底/浅底图 → RGBA; 主体保留, 背景透明; gray_bg=同时清去饱和灰(阴影)"""
    im = Image.open(path).convert('RGB').crop(crop)
    w, h = im.size
    px = im.load()
    from collections import deque
    seen = bytearray(w * h)
    dq = deque()

    def near_bg(c):
        mn = min(c)
        mx = max(c)
        if gray_bg and (mx - mn) < 26 and mn > 168:
            return True
        return mn > 235 - tol and (mx - mn) < 22   # 近白/近灰

    for x in range(w):
        for y in (0, h - 1):
            if near_bg(px[x, y]) and not seen[y * w + x]:
                seen[y * w + x] = 1; dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if near_bg(px[x, y]) and not seen[y * w + x]:
                seen[y * w + x] = 1; dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                if near_bg(px[nx, ny]):
                    seen[ny * w + nx] = 1
                    dq.append((nx, ny))
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        base = y * w
        for x in range(w):
            if seen[base + x]:
                ap[x, y] = 0
    for (x0, y0, x1, y1) in clears:                # 手工清除区(气泡/手/文字)
        d = ImageDraw.Draw(alpha)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=0)
    for _ in range(erode):
        alpha = alpha.filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return out

# ---------------------------------------------------------------- 小元素
def draw_note(d, x, y, sz, col):
    """八分音符"""
    d.ellipse([x, y + sz * 0.52, x + sz * 0.62, y + sz * 0.95], fill=col)
    d.line([x + sz * 0.58, y + sz * 0.72, x + sz * 0.58, y + sz * 0.05], fill=col, width=max(1, int(sz * 0.10)))
    d.polygon([(x + sz * 0.58, y), (x + sz * 0.98, y + sz * 0.16), (x + sz * 0.58, y + sz * 0.30)], fill=col)

def draw_whale(d, x, y, w, col):
    """侧视小鲸鱼(头朝左)"""
    h = w * 0.52
    d.ellipse([x, y + h * 0.15, x + w * 0.78, y + h], fill=col)                 # 身体
    d.polygon([(x + w * 0.70, y + h * 0.42), (x + w, y + h * 0.05),
               (x + w * 0.94, y + h * 0.55), (x + w, y + h * 0.95),
               (x + w * 0.70, y + h * 0.75)], fill=col)                          # 尾巴
    d.ellipse([x + w * 0.16, y + h * 0.52, x + w * 0.22, y + h * 0.62], fill=(10, 18, 48))  # 眼
    d.arc([x + w * 0.05, y + h * 0.30, x + w * 0.30, y + h * 0.62], 200, 340, fill=(10, 18, 48), width=max(1, w // 40))

def bubble_deco(d, seed_boxes):
    for (x, y, r, a) in seed_boxes:
        d.ellipse([x * S, y * S, (x + r) * S, (y + r) * S],
                  outline=ICE + (a,), width=max(1, S // 2))

def chip(d, box, r, fill, border, glyph_fn, gloss=True):
    x0, y0, x1, y1 = [v * S for v in box]
    d.rounded_rectangle([x0, y0, x1, y1], radius=r * S, fill=fill, outline=border, width=S)
    if gloss:
        d.rounded_rectangle([x0 + S, y0 + S, x1 - S, (y0 + y1) // 2], radius=r * S,
                            fill=(255, 255, 255, 26))
    glyph_fn(d, box)

def g_triangle_right(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s = (x1 - x0) * 0.30
    d.polygon([(cx - s * 0.7, cy - s), (cx - s * 0.7, cy + s), (cx + s * 0.9, cy)], fill=col)

def g_pause(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cy, hh = (y0 + y1) / 2, (y1 - y0) * 0.28
    w = (x1 - x0) * 0.16
    for cx in ((x0 + x1) / 2 - w * 1.1, (x0 + x1) / 2 + w * 1.1):
        d.rounded_rectangle([cx - w / 2, cy - hh, cx + w / 2, cy + hh], radius=w / 2, fill=col)

def g_prevnext(d, box, col, right=False):
    x0, y0, x1, y1 = [v * S for v in box]
    cy = (y0 + y1) / 2
    s = (y1 - y0) * 0.30
    dx = (x1 - x0) * 0.22
    cxs = [(x0 + x1) / 2 - dx / 2, (x0 + x1) / 2 + dx / 2]
    for cx in cxs:
        if right:
            d.polygon([(cx - s * 0.8, cy - s), (cx - s * 0.8, cy + s), (cx + s * 0.8, cy)], fill=col)
        else:
            d.polygon([(cx + s * 0.8, cy - s), (cx + s * 0.8, cy + s), (cx - s * 0.8, cy)], fill=col)

def g_stop(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    s = (y1 - y0) * 0.26
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    d.rounded_rectangle([cx - s, cy - s, cx + s, cy + s], radius=s * 0.4, fill=col)

def g_open(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 - (y1 - y0) * 0.10
    s = (y1 - y0) * 0.26
    d.polygon([(cx - s, cy + s * 0.5), (cx + s, cy + s * 0.5), (cx, cy - s * 0.9)], fill=col)
    d.line([x0 + (x1 - x0) * 0.2, y1 - (y1 - y0) * 0.22, x1 - (x1 - x0) * 0.2, y1 - (y1 - y0) * 0.22], fill=col, width=S)

def g_page(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    a = (y1 - y0) * 0.26
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    d.rounded_rectangle([cx - a * 0.8, cy - a, cx + a * 0.8, cy + a], radius=S, outline=col, width=S)
    for i in range(2):
        yy = cy - a * 0.35 + i * a * 0.7
        d.line([cx - a * 0.4, yy, cx + a * 0.4, yy], fill=col, width=S)

def g_list(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cy = (y0 + y1) / 2
    for i, yy in enumerate((cy - (y1 - y0) * 0.22, cy, cy + (y1 - y0) * 0.22)):
        d.line([x0 + (x1 - x0) * 0.25, yy, x1 - (x1 - x0) * 0.18, yy], fill=col, width=S)
        d.ellipse([x0 + (x1 - x0) * 0.14 - S, yy - S, x0 + (x1 - x0) * 0.14 + S, yy + S], fill=col)

def g_eqbars(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    hs = (0.5, 0.8, 0.62)
    n = len(hs)
    for i, hh in enumerate(hs):
        cx = x0 + (x1 - x0) * (i + 0.5) / n
        d.line([cx, y1 - (y1 - y0) * 0.22, cx, y1 - (y1 - y0) * 0.22 - (y1 - y0) * 0.56 * hh * 2], fill=col, width=max(S, int((x1 - x0) * 0.14)))

def g_min(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    d.line([x0 + (x1 - x0) * 0.22, y1 - (y1 - y0) * 0.30, x1 - (x1 - x0) * 0.22, y1 - (y1 - y0) * 0.30], fill=col, width=max(S, int((y1 - y0) * 0.14)))

def g_minimode(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    a = (y1 - y0) * 0.30
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    d.rounded_rectangle([cx - a, cy - a, cx + a, cy + a], radius=2 * S, outline=col, width=S)
    d.rounded_rectangle([cx - a * 0.45, cy - a * 0.45, cx + a * 0.45, cy + a * 0.45], radius=S, fill=col)

def g_x(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    a = (y1 - y0) * 0.26
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    d.line([cx - a, cy - a, cx + a, cy + a], fill=col, width=max(S, int((y1 - y0) * 0.13)))
    d.line([cx - a, cy + a, cx + a, cy - a], fill=col, width=max(S, int((y1 - y0) * 0.13)))

def g_ontop(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2 - (y1 - y0) * 0.12
    r = (y1 - y0) * 0.16
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=S)
    d.line([cx, cy + r, cx, y1 - (y1 - y0) * 0.20], fill=col, width=S)

def g_bowl(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx = (x0 + x1) / 2
    bw = (x1 - x0) * 0.36
    by = (y0 + y1) / 2 + (y1 - y0) * 0.12
    d.ellipse([cx - bw, by - bw * 0.55, cx + bw, by + bw * 0.55], fill=col)          # 碗身
    d.ellipse([cx - bw * 0.9, by - bw * 1.15, cx + bw * 0.9, by - bw * 0.15], fill=col)  # 饭团
    d.line([x0 + (x1 - x0) * 0.16, by + bw * 0.62, x1 - (x1 - x0) * 0.16, by + bw * 0.62], fill=BLUE3, width=S)

def g_plus(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = (y1 - y0) * 0.28
    d.line([cx - a, cy, cx + a, cy], fill=col, width=max(S, int((y1 - y0) * 0.13)))
    d.line([cx, cy - a, cx, cy + a], fill=col, width=max(S, int((y1 - y0) * 0.13)))

def g_minus(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = (y1 - y0) * 0.28
    d.line([cx - a, cy, cx + a, cy], fill=col, width=max(S, int((y1 - y0) * 0.13)))

def g_up(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx = (x0 + x1) / 2
    ty = y0 + (y1 - y0) * 0.22
    by = y1 - (y1 - y0) * 0.30
    w = (x1 - x0) * 0.18
    d.polygon([(cx, ty), (cx + w, ty + w * 1.3), (cx - w, ty + w * 1.3)], fill=col)
    d.line([cx, ty + w * 0.9, cx, by], fill=col, width=max(S, int((y1 - y0) * 0.12)))
    d.line([x0 + (x1 - x0) * 0.22, by, x1 - (x1 - x0) * 0.22, by], fill=col, width=max(S, int((y1 - y0) * 0.12)))

def g_search(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2 - (x1 - x0) * 0.06, (y0 + y1) / 2 - (y1 - y0) * 0.08
    r = (y1 - y0) * 0.24
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=S)
    d.line([cx + r * 0.72, cy + r * 0.72, x1 - (x1 - x0) * 0.22, y1 - (y1 - y0) * 0.20], fill=col, width=max(S, int((y1 - y0) * 0.13)))

def g_doc(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    a = (y1 - y0) * 0.34
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    d.rounded_rectangle([cx - a * 0.72, cy - a, cx + a * 0.72, cy + a], radius=S, outline=col, width=S)
    for i in (-1, 0, 1):
        yy = cy + i * a * 0.42
        d.line([cx - a * 0.38, yy, cx + a * 0.38, yy], fill=col, width=S)

def g_mode(d, box, col):
    x0, y0, x1, y1 = [v * S for v in box]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = (y1 - y0) * 0.30
    d.line([cx - a, cy + a, cx - a, cy - a], fill=col, width=max(S, int((y1 - y0) * 0.12)))
    d.line([cx - a, cy - a, cx + a * 0.15, cy + a * 0.25], fill=col, width=max(S, int((y1 - y0) * 0.12)))
    d.line([cx + a * 0.15, cy + a * 0.25, cx + a, cy - a], fill=col, width=max(S, int((y1 - y0) * 0.12)))
    d.line([cx + a, cy - a, cx + a, cy + a], fill=col, width=max(S, int((y1 - y0) * 0.12)))

# ---------------------------------------------------------------- 5x7 LED 字体
F57 = {
 '0': ("01110","10001","10011","10101","11001","10001","01110"),
 '1': ("00100","01100","00100","00100","00100","00100","01110"),
 '2': ("01110","10001","00001","00110","01000","10000","11111"),
 '3': ("11110","00001","00001","01110","00001","00001","11110"),
 '4': ("00010","00110","01010","10010","11111","00010","00010"),
 '5': ("11111","10000","11110","00001","00001","10001","01110"),
 '6': ("00110","01000","10000","11110","10001","10001","01110"),
 '7': ("11111","00001","00010","00100","01000","01000","01000"),
 '8': ("01110","10001","10001","01110","10001","10001","01110"),
 '9': ("01110","10001","10001","01111","00001","00010","01100"),
 ':': ("00000","01100","01100","00000","01100","01100","00000"),
 '-': ("00000","00000","00000","01110","00000","00000","00000"),
 'O': ("01110","10001","10001","10001","10001","10001","01110"),
 'F': ("11111","10000","10000","11110","10000","10000","10000"),
 'N': ("10001","11001","10101","10011","10001","10001","10001"),
 'P': ("11110","10001","10001","11110","10000","10000","10000"),
 'R': ("11110","10001","10001","11110","10100","10010","10001"),
 'E': ("11111","10000","10000","11110","10000","10000","11111"),
 'S': ("01111","10000","10000","01110","00001","00001","11110"),
 'T': ("11111","00100","00100","00100","00100","00100","00100"),
}

def draw_57(d, ch, x, y, scale, col):
    rows = F57[ch]
    for ry, row in enumerate(rows):
        for rx, c in enumerate(row):
            if c == '1':
                d.rectangle([x + rx * scale, y + ry * scale,
                             x + rx * scale + scale - 1, y + ry * scale + scale - 1], fill=col)

# ---------------------------------------------------------------- 按钮条带
def strip4(w, h, name, fn, toggle=False, prev_zoom=None):
    """fn(d, box, frame_idx) 在 S 倍画布上画第 idx 帧图案; 返回最终位图"""
    im = Image.new('RGB', (w * 4 * S, h * S), MAG)
    d = ImageDraw.Draw(im, 'RGBA')
    for f in range(4):
        ox = f * w * S
        sub = Image.new('RGB', (w * S, h * S), MAG)
        sd = ImageDraw.Draw(sub, 'RGBA')
        fn(sd, f)
        im.paste(sub, (ox, 0))
    out = save(im, name, w * 4, h)
    return out

def std_button(w, h, glyph, toggle=False, r=3):
    """标准圆角芯片按钮 4 帧"""
    def fn(d, f):
        box = (0, 0, w, h)
        if toggle:
            states = [(BLUE2, SKY, CREAM), (BLUE, WHITE, WHITE),
                      (BLUE, ICE, WHITE), (BLUE, WHITE, WHITE)]
        else:
            states = [(DRESS, SKY, CREAM), (BLUE, WHITE, WHITE),
                      (NAVY2, SKY, ICE), (DRESS, SKY, CREAM)]
        fill, border, gc = states[f]
        chip(d, box, r, fill, border, lambda dd, bb: glyph(dd, bb, gc))
    return fn

# ================================================================ 主窗背景
def gen_player_bg():
    W, H = 400, 150
    im = vgrad(W, H, [(0.0, (10, 18, 48)), (0.45, NAVY2), (1.0, BLUE3)])
    ov = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # 鲸鱼身后柔光
    d.ellipse([(-30) * S, 60 * S, 150 * S, 220 * S], fill=(77, 107, 254, 70))
    # 星点
    stars = [(112, 12), (140, 30), (170, 10), (210, 24), (250, 14), (300, 34),
             (330, 12), (370, 26), (200, 44), (280, 50), (120, 52), (355, 46)]
    for (x, y) in stars:
        d.ellipse([x * S, y * S, (x + 1.4) * S, (y + 1.4) * S], fill=(255, 255, 255, 120))
    # 气泡
    bubbles = [(30, 26, 3, 90), (52, 14, 2, 70), (74, 34, 4, 60), (108, 20, 2, 80),
               (150, 40, 3, 55), (200, 32, 2, 70), (246, 44, 4, 50), (290, 26, 2, 80),
               (330, 40, 3, 60), (368, 34, 2, 75), (20, 60, 2, 55), (86, 58, 3, 45),
               (160, 56, 2, 60), (310, 58, 2, 55)]
    bubble_deco(d, bubbles)
    # 音符
    draw_note(d, 120 * S, 100 * S, 13 * S, (207, 224, 255, 90))
    draw_note(d, 356 * S, 96 * S, 10 * S, (207, 224, 255, 70))
    # 底部海浪
    pts = [(0, H * S)]
    for x in range(0, W * S + 1, 8):
        pts.append((x, (H - 14) * S + math.sin(x / (34 * S)) * 3 * S))
    pts.append((W * S, H * S))
    d.polygon(pts, fill=(126, 166, 255, 36))
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')

    # 控制面板
    d2 = ImageDraw.Draw(im, 'RGBA')
    d2.rounded_rectangle([96 * S, 6 * S, 394 * S, 146 * S], radius=10 * S,
                         fill=(16, 28, 74, 150), outline=(126, 166, 255, 110), width=S)
    # 小鲸鱼装饰(面板右上角)
    draw_whale(d2, 296 * S, 26 * S, 30 * S, (126, 166, 255, 60))
    d2.text((388 * S, 134 * S), 'Deepseek.胖鲸娘', font=font(F_MSYH, 8),
            fill=(207, 224, 255, 95), anchor='ra')
    # 竖向轨道槽: 进度/音量
    d2.rounded_rectangle([107 * S, 45 * S, 213 * S, 53 * S], radius=3 * S,
                         fill=(8, 14, 40, 220), outline=(126, 166, 255, 70), width=S)
    d2.rounded_rectangle([155 * S, 93 * S, 201 * S, 107 * S], radius=4 * S,
                         fill=(8, 14, 40, 220), outline=(126, 166, 255, 70), width=S)
    # 频谱底框
    d2.rounded_rectangle([107 * S, 59 * S, 277 * S, 93 * S], radius=4 * S,
                         fill=(8, 14, 40, 160), outline=(126, 166, 255, 60), width=S)

    # 鲸鱼娘立绘(左下)
    girl = cutout(os.path.join(ASSETS, 'image-e2ac10ba97d5d3c3cc0966b5213722af.png'),
                  crop=(340, 90, 960, 960),
                  clears=[(0, 0, 95, 145), (0, 145, 40, 290), (0, 470, 50, 640),
                          (0, 630, 78, 820), (590, 270, 620, 345)],
                  tol=26, erode=1)
    gh = 140
    gw = int(girl.width * gh / girl.height)
    girl = girl.resize((gw, gh), Image.LANCZOS)
    girl_S = girl.resize((gw * S, gh * S), Image.LANCZOS)
    im.paste(girl_S, (0, (H - gh - 2) * S), girl_S)

    bg = finish_shape(im, 'player_skin.bmp', W, H, 14)
    save_prev(bg, 'player_skin.png', W, H, 2)
    return girl

# ================================================================ 其余位图
def gen_buttons():
    Z = {}
    # 播放/暂停 22x22
    Z['play.bmp'] = strip4(22, 22, 'play.bmp', std_button(22, 22, g_triangle_right))
    Z['pause.bmp'] = strip4(22, 22, 'pause.bmp', std_button(22, 22, g_pause))
    # 前后 18x14
    Z['prev.bmp'] = strip4(18, 14, 'prev.bmp', std_button(18, 14, lambda d, b, c: g_prevnext(d, b, c, False)))
    Z['next.bmp'] = strip4(18, 14, 'next.bmp', std_button(18, 14, lambda d, b, c: g_prevnext(d, b, c, True)))
    # 停止/打开
    Z['stop.bmp'] = strip4(14, 14, 'stop.bmp', std_button(14, 14, g_stop))
    Z['open.bmp'] = strip4(13, 13, 'open.bmp', std_button(13, 13, g_open))
    # 切换开关: 播放列表 / 歌词 / 均衡器
    Z['playlist.bmp'] = strip4(12, 12, 'playlist.bmp', std_button(12, 12, g_list, toggle=True), toggle=True)
    Z['lyric.bmp'] = strip4(12, 12, 'lyric.bmp', std_button(12, 12, g_page, toggle=True), toggle=True)
    Z['equalizer.bmp'] = strip4(12, 12, 'equalizer.bmp', std_button(12, 12, g_eqbars, toggle=True), toggle=True)
    # 最小化/迷你/关闭/置顶
    Z['minimize.bmp'] = strip4(10, 10, 'minimize.bmp', std_button(10, 10, g_min, r=2))
    Z['minimode.bmp'] = strip4(10, 10, 'minimode.bmp', std_button(10, 10, g_minimode, r=2))
    Z['close.bmp'] = strip4(9, 9, 'close.bmp', std_button(9, 9, g_x, r=2))
    Z['ontop.bmp'] = strip4(9, 9, 'ontop.bmp', std_button(9, 9, g_ontop, toggle=True), toggle=True)
    # 迷你窗按钮 14x15
    Z['play_mini.bmp'] = strip4(14, 15, 'play_mini.bmp', std_button(14, 15, g_triangle_right, r=3))
    Z['pause_mini.bmp'] = strip4(14, 15, 'pause_mini.bmp', std_button(14, 15, g_pause, r=3))
    Z['prev_mini.bmp'] = strip4(14, 15, 'prev_mini.bmp', std_button(14, 15, lambda d, b, c: g_prevnext(d, b, c, False), r=3))
    Z['next_mini.bmp'] = strip4(14, 15, 'next_mini.bmp', std_button(14, 15, lambda d, b, c: g_prevnext(d, b, c, True), r=3))
    Z['stop_mini.bmp'] = strip4(14, 15, 'stop_mini.bmp', std_button(14, 15, g_stop, r=3))
    return Z

def gen_number():
    im = Image.new('RGB', (120, 14), MAG)
    d = ImageDraw.Draw(im)
    order = '0123456789:-'
    for i, ch in enumerate(order):
        draw_57(d, ch, i * 10 + 0, 0, 2, CREAM)
    im.save(os.path.join(OUT, 'number.bmp'))
    save_prev(im, 'number.png', 120, 14)

def gen_progress():
    # 进度填充 104x6 / 音量填充 44x12
    # ⚠️ TTPlayer 把 fill_image 整张拉伸到当前填充矩形再键控品红
    #    (原版 TT-07: progress_fill=100×3 满幅实心条, progress2=41×10 满幅) ⇒ 位图必须满幅。
    #    旧实现把 down(im,W,H) 贴到 S 倍品红画布左上角、save() 再降采样一次
    #    ⇒ 双重缩小, 104×6 只剩左上 26×1、44×12 只剩 11×3(2026-10-31 用户报进度/音量显示不对)。
    #    改用 finish_shape: S 倍内容 → 一次降采样 → 圆角 mask 贴品红底。
    finish_shape(vgrad(104, 6, [(0.0, ICE), (0.5, SKY), (1.0, BLUE)]),
                 'progress_fill.bmp', 104, 6, 3)
    finish_shape(vgrad(44, 12, [(0.0, ICE), (0.5, SKY), (1.0, BLUE)]),
                 'progress2.bmp', 44, 12, 4)
    # 进度 thumb: 小白饭碗 14x14
    W, H = 14, 14
    im = Image.new('RGB', (W * S, H * S), MAG)
    d = ImageDraw.Draw(im, 'RGBA')
    d.ellipse([2 * S, 6 * S, 12 * S, 13 * S], fill=CREAM, outline=SKY, width=S)      # 碗
    d.ellipse([3 * S, 3 * S, 11 * S, 8 * S], fill=WHITE)                              # 饭
    d.ellipse([5 * S, 4 * S, 7 * S, 6 * S], fill=(235, 240, 252))
    save(im, 'progress_thumb.bmp', W, H)
    # 音量 thumb: 音符竖药丸 6x16
    W, H = 6, 16
    im = Image.new('RGB', (W * S, H * S), MAG)
    d = ImageDraw.Draw(im, 'RGBA')
    d.rounded_rectangle([1 * S, 1 * S, 5 * S, 15 * S], radius=2 * S, fill=SKY, outline=WHITE, width=S)
    save(im, 'thumb.bmp', W, H)

def gen_eq():
    # EQ 填充条
    W, H = 4, 60
    im = vgrad(W, H, [(0.0, SKY), (1.0, BLUE)])
    save(im, 'eqfactor_full.bmp', W, H)
    W, H = 60, 4
    im = Image.new('RGB', (W * S, H * S))
    d = ImageDraw.Draw(im)
    for x in range(W * S):
        t = x / (W * S - 1)
        d.line([x, 0, x, H * S], fill=lerp(BLUE, SKY, t))
    save(im, 'eqfactor_full2.bmp', W, H)
    # EQ thumb 11x11 旋钮
    W, H = 11, 11
    im = Image.new('RGB', (W * S, H * S), MAG)
    d = ImageDraw.Draw(im, 'RGBA')
    cx, cy, r = W * S / 2, H * S / 2, 4.6 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE2, outline=SKY, width=S)
    d.ellipse([cx - r * 0.45, cy - r * 0.55, cx - r * 0.05, cy - r * 0.15], fill=(255, 255, 255, 150))
    save(im, 'eq_thumb.bmp', W, H)

    # EQ 按钮: enabled 30x9, profile 54x9, reset 42x9
def text_btn(w, name, label, kind):
    """EQ 按钮: 5x7 像素字; f0 OFF/普通 f1 OFF/悬停 f2 ON/普通 f3 ON/悬停"""
    im = Image.new('RGB', (w * 4 * S, 9 * S), MAG)
    for f in range(4):
        sub = Image.new('RGB', (w * S, 9 * S), MAG)
        sd = ImageDraw.Draw(sub, 'RGBA')
        on = f >= 2 and kind == 'enabled'
        hov = f % 2 == 1
        if kind == 'enabled':
            fill = BLUE if (on or hov) else DRESS
            border = WHITE if hov else SKY
        else:
            fill = BLUE if hov else DRESS
            border = WHITE if hov else SKY
        sd.rounded_rectangle([0, 0, w * S - 1, 9 * S - 1], radius=3 * S, fill=fill, outline=border, width=S)
        if on:
            sd.ellipse([2 * S, 3 * S, 6 * S, 7 * S], fill=ICE if not hov else WHITE)
        else:
            sd.ellipse([2 * S, 3 * S, 6 * S, 7 * S], outline=ICE if not hov else WHITE, width=S)
        text = 'ON' if on else label
        tx = 8
        for chn in text:
            draw_57(sd, chn, tx * S, 1 * S, S, WHITE if (on or hov) else ICE)
            tx += 6
        im.paste(sub, (f * w * S, 0))
    save(im, name, w * 4, 9)
text_btn(30, 'eq_enabled.bmp', 'OFF', 'enabled')
text_btn(54, 'eq_profile.bmp', 'PRESET', 'profile')
text_btn(42, 'reset.bmp', 'RESET', 'reset')

# 滚动条
# 关键: 滚动条子位图不走色键 —— 实测品红底会在曲目列表右缘渲染成不透明红条
# (x=385..392 行 54-60/202-237/351-357 共 195 px)。四套原版皮肤
# (TT-07/Classic/PurpleMythSE/WMP10) 的 scrollbar_* 品红数均为 0。
# 因此这三张必须整幅不透明: 先铺轨道竖渐变当底色, 再把滑块/箭头叠上去。
BAR_GRAD = [(0.0, (10, 18, 48)), (1.0, (16, 28, 74))]
W, H = 8, 39
save(vgrad(W, H, BAR_GRAD), 'scrollbar_bar.bmp', W, H)

im = Image.new('RGB', (8 * 3 * S, 36 * S), MAG)
for f, col in enumerate((SKY, ICE, BLUE2)):
    sub = vgrad(8, 36, BAR_GRAD).resize((8 * S, 36 * S), Image.NEAREST)   # 轨道底色铺满
    sd = ImageDraw.Draw(sub)
    sd.rounded_rectangle([S, S, 7 * S, 35 * S], radius=3 * S, fill=col,
                         outline=WHITE if f == 1 else NAVY, width=S)
    im.paste(sub, (f * 8 * S, 0))
save(im, 'scrollbar_thumb.bmp', 24, 36)

im = Image.new('RGB', (8 * 3 * S, 14 * S), MAG)
for f, col in enumerate((SKY, ICE, BLUE2)):
    sub = vgrad(8, 14, BAR_GRAD).resize((8 * S, 14 * S), Image.NEAREST)   # 同上
    sd = ImageDraw.Draw(sub)
    cx = 4 * S
    sd.polygon([(cx, 3 * S), (6.4 * S, 7 * S), (1.6 * S, 7 * S)], fill=col)
    sd.polygon([(cx, 11 * S), (6.4 * S, 7 * S), (1.6 * S, 7 * S)], fill=col)
    im.paste(sub, (f * 8 * S, 0))
save(im, 'scrollbar_button.bmp', 24, 14)

def gen_eq_bg():
    # 宽度必须与 player/playlist 一致(400), 否则右边缘不齐(实测 2026-10-28)
    W, H = 400, 126
    im = vgrad(W, H, [(0.0, (10, 18, 48)), (1.0, NAVY2)])
    ov = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([6 * S, 6 * S, (W - 7) * S, 120 * S], radius=8 * S,
                        fill=(16, 28, 74, 150), outline=(126, 166, 255, 110), width=S)
    # 竖滑杆轨道: preamp x123..128 → cx 125.5; bands x168..173 cx 170.5 + 22b
    # 节距 22 = 滑杆宽 5 + eq_interval 17(与 Skin.xml 同步改)
    for cx in [125.5] + [170.5 + 22 * b for b in range(10)]:
        d.rounded_rectangle([(cx - 3) * S, 31 * S, (cx + 3) * S, 95 * S], radius=3 * S,
                            fill=(8, 14, 40, 220), outline=(126, 166, 255, 70), width=S)
    # 横滑杆轨道
    for yy in (50.5, 76.5):
        d.rounded_rectangle([27 * S, (yy - 3) * S, 89 * S, (yy + 3) * S], radius=3 * S,
                            fill=(8, 14, 40, 220), outline=(126, 166, 255, 70), width=S)
    fnt = font(F_MSYH, 9)
    ICEa = (207, 224, 255, 200)
    draw_note(d, 10 * S, 10 * S, 14 * S, (207, 224, 255, 220))
    d.text((26 * S, 11 * S), '均衡器', font=font(F_MSYHB, 12), fill=(207, 224, 255, 230))
    d.text((28 * S, 57 * S), '平衡', font=fnt, fill=ICEa)
    d.text((28 * S, 83 * S), '环绕', font=fnt, fill=ICEa)
    d.text((118 * S, 97 * S), '前置', font=fnt, fill=ICEa)
    labels = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']
    for b, lb in enumerate(labels):
        cx = 170.5 + 22 * b
        d.text((cx * S, 98 * S), lb, font=font(F_MSYH, 7), fill=ICEa, anchor='ma')
    draw_whale(d, (W - 44) * S, 12 * S, 26 * S, (126, 166, 255, 70))
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    finish_shape(im, 'eq_skin.bmp', W, H, 12)

def gen_window_bgs():
    # 歌词窗 400x200: 启动时程序把歌词窗宽度钳回底图宽, 必须与 player/playlist 同宽 400 才能右边缘对齐
    W, H = 400, 200
    im = vgrad(W, H, [(0.0, (10, 18, 48)), (0.6, NAVY2), (1.0, BLUE3)])
    ov = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([4 * S, 4 * S, (W - 5) * S, 196 * S], radius=8 * S,
                        fill=(16, 28, 74, 130), outline=(126, 166, 255, 100), width=S)
    draw_note(d, 12 * S, 9 * S, 13 * S, (207, 224, 255, 220))
    d.text((27 * S, 10 * S), '歌词', font=font(F_MSYHB, 12), fill=(207, 224, 255, 220))
    # 底部鲸鱼剪影 + 气泡 (x 按 400/313 等比铺开)
    draw_whale(d, 256 * S, 150 * S, 100 * S, (77, 107, 254, 62))
    draw_whale(d, 194 * S, 172 * S, 40 * S, (126, 166, 255, 45))
    for (x, y, r, a) in [(36, 158, 3, 80), (61, 176, 2, 65), (89, 164, 4, 50), (128, 178, 2, 65), (166, 168, 3, 55)]:
        d.ellipse([x * S, y * S, (x + r) * S, (y + r) * S], outline=(207, 224, 255, a), width=S)
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    finish_shape(im, 'lyric_skin.bmp', W, H, 12)

    # 播放列表窗 313x200 (可拉伸窗, 底图保持 313)
    W, H = 313, 200
    im = vgrad(W, H, [(0.0, (10, 18, 48)), (0.6, NAVY2), (1.0, BLUE3)])
    ov = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([4 * S, 4 * S, 309 * S, 196 * S], radius=8 * S,
                        fill=(16, 28, 74, 130), outline=(126, 166, 255, 100), width=S)
    draw_note(d, 12 * S, 9 * S, 13 * S, (207, 224, 255, 220))
    d.text((27 * S, 10 * S), '播放列表', font=font(F_MSYHB, 12), fill=(207, 224, 255, 220))
    # 列表区深色面板
    d.rounded_rectangle([7 * S, 53 * S, 307 * S, 189 * S], radius=4 * S,
                        fill=(8, 14, 40, 190), outline=(126, 166, 255, 60), width=S)
    draw_whale(d, 240 * S, 30 * S, 60 * S, (126, 166, 255, 55))
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    finish_shape(im, 'playlist_skin.bmp', W, H, 12)

    # 工具栏 238x14: 7 图标
    im = Image.new('RGB', (238 * S, 14 * S), MAG)
    d = ImageDraw.Draw(im, 'RGBA')
    centers = [20, 52, 84, 117, 148, 184, 216]
    glyphs = [g_plus, g_minus, g_list, g_up, g_search, g_doc, g_mode]
    for cx, gl in zip(centers, glyphs):
        box = (cx - 6, 1, cx + 6, 13)
        d.rounded_rectangle([box[0] * S, box[1] * S, box[2] * S, box[3] * S], radius=2 * S,
                            fill=(43, 75, 216, 200), outline=(126, 166, 255, 160), width=S)
        gl(d, box, CREAM)
    save(im, 'playlist_toolbar.bmp', 238, 14)

    # 迷你窗 313x25
    W, H = 313, 25
    im = vgrad(W, H, [(0.0, (10, 18, 48)), (1.0, BLUE3)])
    ov = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=5 * S,
                        fill=(16, 28, 74, 120), outline=(126, 166, 255, 120), width=S)
    draw_whale(d, 294 * S, 6 * S, 16 * S, (126, 166, 255, 90))
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    finish_shape(im, 'mini-player.bmp', W, H, 5)

# ================================================================ 图标
def write_ico(path, frames_rgba):
    """手写 ICO: 每尺寸 8bpp 调色板 + 32bpp 两条目(仿 TT-07 原生 6 条目结构)"""
    import struct as _st
    imgs = []   # (w, bpp, data)
    for im in frames_rgba:
        w, h = im.size
        px = im.load()
        stride = ((w + 31) // 32) * 4
        # 32bpp XOR(bottom-up BGRA) + AND mask
        xor32 = bytearray()
        andm32 = bytearray(stride * h)
        for y in range(h - 1, -1, -1):
            for x in range(w):
                r, g, b, a = px[x, y]
                xor32 += bytes((b, g, r, a))
        # 8bpp: 自适应量化, 索引0=透明
        # 调色板必须取自"合成到深海底色后"的图, 且先去掉偏紫/偏橙的插值色 ——
        # 2006 加载器读的是这条 8bpp 条目, 直接 convert('RGB') 会把透明区的隐藏
        # RGB 也量化进调色板, 于是图标边缘在界面上露出橙色/紫色点(实测 2026-10-28)
        flat = Image.new('RGBA', im.size, (12, 22, 56, 255))
        flat.alpha_composite(im)
        frgb = flat.convert('RGB')
        fp = frgb.load()
        fw, fh = frgb.size
        for y in range(fh):
            for x in range(fw):
                r, g, b = fp[x, y]
                if (r > g + 10 and b > g + 10 and r + b > 60) or (r > b + 15 and r > g + 15):
                    luma = (r * 299 + g * 587 + b * 114) // 1000
                    fp[x, y] = (luma, luma, luma)
        q = frgb.quantize(colors=255, method=Image.MEDIANCUT)
        qpx = q.load()
        alpha = im.split()[3].load()
        xor8 = bytearray()
        andm8 = bytearray(stride * h)
        for y in range(h - 1, -1, -1):
            for x in range(w):
                if alpha[x, y] < 128:
                    xor8.append(0)
                    andm8[y * stride + x // 8] |= (0x80 >> (x % 8))
                else:
                    xor8.append(qpx[x, y] + 1)
        pal = bytearray(256 * 4)
        pl = q.getpalette()
        for i in range(255):
            if pl and i * 3 + 2 < len(pl):
                pal[4 + i * 4 + 0] = pl[i * 3 + 2]   # B
                pal[4 + i * 4 + 1] = pl[i * 3 + 1]   # G
                pal[4 + i * 4 + 2] = pl[i * 3]       # R
        def bih(bpp, xor_len, and_len, clr_used):
            return _st.pack('<IiiHHIIiiII', 40, w, h * 2, 1, bpp, 0,
                            xor_len + and_len, 0, 0, clr_used, 0)
        e8 = bih(8, len(xor8), len(andm8), 256) + bytes(pal) + bytes(xor8) + bytes(andm8)
        e32 = bih(32, len(xor32), len(andm32), 0) + bytes(xor32) + bytes(andm32)
        imgs.append((w, 8, e8))
        imgs.append((w, 32, e32))
    out = _st.pack('<HHH', 0, 1, len(imgs))
    off = 6 + 16 * len(imgs)
    ents = b''
    body = b''
    for w, bpp, data in imgs:
        ents += _st.pack('<BBBBHHII', w if w < 256 else 0, w if w < 256 else 0,
                         0, 0, 1, bpp, len(data), off)
        off += len(data)
        body += data
    open(path, 'wb').write(out + ents + body)

def gen_icon():
    src = cutout(os.path.join(ASSETS, 'image-59be951872af992dc1a045d03932329a.png'),
                 crop=(430, 0, 854, 447), tol=40, erode=2, gray_bg=True)
    bbox = src.getbbox()
    src = src.crop(bbox)
    side = max(src.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
    ico_sizes = [48, 32, 16]
    frames = []
    for sz in ico_sizes:
        f = sq.resize((sz, sz), Image.LANCZOS)
        # ICO 不走色键, 但 LANCZOS 边晕同样会留下偏紫像素(实测 player 图标边缘 4 px
        # 如 (61,45,64)); 去饱和成同亮度中性灰, 灰在深蓝底上不会被看成红/紫点
        fp = f.load()
        for y in range(sz):
            for x in range(sz):
                r, g, b, a = fp[x, y]
                if a > 100 and r > g + 10 and b > g + 10 and r + b > 60:
                    luma = (r * 299 + g * 587 + b * 114) // 1000
                    fp[x, y] = (luma, luma, luma, a)
        frames.append(f)
    write_ico(os.path.join(OUT, 'TTPlayer.ico'), frames)   # 8bpp+32bpp 混合条目,2006 加载器友好
    prev = Image.new('RGB', (48 * 3 + 20, 60), (40, 44, 60))
    for i, sz in enumerate(ico_sizes):
        f = sq.resize((sz, sz), Image.LANCZOS)
        prev.paste(f, (5 + i * 54, 5), f)
    os.makedirs(PREV, exist_ok=True)
    prev.save(os.path.join(PREV, 'icon.png'))

# ================================================================ XML
def wxml(name, text, bom=True):
    p = os.path.join(OUT, name)
    enc = 'utf-8-sig' if bom else 'ascii'
    with open(p, 'w', encoding=enc, newline='\r\n') as f:
        f.write(text)

SKIN_XML = '''<skin version="2" name="DeepSeek Whale" author="ZCode" url="https://deepseek.com" email="none" transparent_color="#ff00ff">
  <player_window image="player_skin.bmp">
    <play position="330, 60, 352, 82" image="play.bmp"/>
    <pause position="330, 60, 352, 82" image="pause.bmp"/>
    <prev position="306, 64, 324, 78" image="prev.bmp"/>
    <next position="358, 64, 376, 78" image="next.bmp"/>
    <stop position="332, 88, 346, 102" image="stop.bmp"/>
    <open position="284, 46, 297, 59" image="open.bmp"/>

    <lyric position="126, 96, 138, 108" image="lyric.bmp"/>
    <equalizer position="334, 10, 346, 22" image="equalizer.bmp"/>
    <playlist position="110, 96, 122, 108" image="playlist.bmp"/>

    <minimize position="364, 11, 374, 21" image="minimize.bmp"/>
    <minimode position="350, 11, 360, 21" image="minimode.bmp"/>
    <exit position="378, 11, 389, 22" image="close.bmp"/>

    <progress position="108, 46, 212, 52" bar_image="" thumb_image="progress_thumb.bmp" fill_image="progress_fill.bmp"/>
    <volume position="156, 94, 200, 106" vertical="false" bar_image="" thumb_image="thumb.bmp" fill_image="progress2.bmp"/>

    <icon position="104, 20, 120, 36" image="TTPlayer.ico"/>
    <info position="126, 18, 258, 38" color="#ffffff" font="Microsoft YaHei UI" font_size="13" align="left"/>
    <status position="204, 96, 272, 112" color="#cfe0ff" font="Microsoft YaHei UI" font_size="12" align="right"/>
    <led position="150, 38, 274, 58" image="number.bmp" align="right"/>
    <visual position="108, 60, 276, 92"/>
  </player_window>

  <lyric_window position="0, 452, 10, 652" resize_rect="46, 32, 250, 120" image="lyric_skin.bmp">
    <lyric position="5, 32, 250, 194"/>
    <close position="384, 10, 392, 19" image="close.bmp"/>
    <ontop position="374, 10, 383, 19" image="ontop.bmp"/>
  </lyric_window>

  <equalizer_window position="0, 126, 400, 252" image="eq_skin.bmp" eq_interval="17">
    <close position="384, 10, 392, 19" image="close.bmp"/>
    <enabled position="17, 107, 47, 116" image="eq_enabled.bmp"/>
    <profile position="111, 107, 165, 116" image="eq_profile.bmp"/>
    <reset position="58, 107, 100, 116" image="reset.bmp"/>
    <balance position="28, 48, 88, 53" thumb_image="eq_thumb.bmp" bar_image="" fill_image="eqfactor_full2.bmp"/>
    <surround position="28, 74, 88, 79" thumb_image="eq_thumb.bmp" bar_image="" fill_image="eqfactor_full2.bmp"/>
    <preamp position="123, 33, 128, 93" thumb_image="eq_thumb.bmp" bar_image="" fill_image="eqfactor_full.bmp"/>
    <eqfactor position="168, 33, 173, 93" thumb_image="eq_thumb.bmp" bar_image="" fill_image="eqfactor_full.bmp"/>
  </equalizer_window>

  <playlist_window position="0, 252, 10, 452" resize_rect="64, 52, 305, 188" image="playlist_skin.bmp">
    <close position="296, 10, 305, 19" image="close.bmp" align="right"/>
    <toolbar position="3, 28, 241, 42" image="playlist_toolbar.bmp" align="left"/>
    <scrollbar buttons_image="scrollbar_button.bmp" thumb_image="scrollbar_thumb.bmp" bar_image="scrollbar_bar.bmp" align="center"/>
    <playlist position="8, 54, 306, 188"/>
  </playlist_window>

  <mini_window image="mini-player.bmp">
    <play position="200, 4, 214, 19" image="play_mini.bmp"/>
    <pause position="200, 4, 214, 19" image="pause_mini.bmp"/>
    <prev position="181, 4, 195, 19" image="prev_mini.bmp"/>
    <next position="219, 4, 233, 19" image="next_mini.bmp"/>
    <stop position="238, 5, 252, 20" image="stop_mini.bmp"/>
    <icon position="4, 4, 20, 20" image="TTPlayer.ico"/>
    <minimize position="256, 8, 265, 17" image="minimize.bmp"/>
    <minimode position="268, 8, 277, 17" image="minimode.bmp"/>
    <exit position="280, 8, 289, 17" image="close.bmp"/>
    <info position="24, 2, 175, 23" color="#ffffff" font="Microsoft YaHei UI" font_size="12" align="left"/>
  </mini_window>
</skin>
'''

VISUAL_XML = '''<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ttplayer_visual>
	<Visual
		SpectrumTopColor="#7ea6ff"
		SpectrumBtmColor="#2b4bd8"
		SpectrumMidColor="#4d6bfe"
		SpectrumPeakColor="#cfe0ff"
		SpectrumWide="1"
		BlurSpeed="3"
		Blur="0"
		BlurScopeColor="#4d6bfe"
		TextColor="#cfe0ff"
		Font="-11,0,0,0,400,0,0,0,134,3,2,4,49,Microsoft YaHei UI"
	/>
</ttplayer_visual>
'''

PLAYLIST_XML = '''<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ttplayer_playlist>
	<PlayList
		Font="-11,0,0,0,400,0,0,0,134,3,2,4,49,Microsoft YaHei UI"
		Color_Text="#cfe0ff"
		Color_Hilight="#ffffff"
		Color_Bkgnd="#0e1a4a"
		Color_Number="#8fa8e8"
		Color_Duration="#8fa8e8"
		Color_Select="#4d6bfe"
		Color_Bkgnd2="#14204f"
	/>
</ttplayer_playlist>
'''

LYRIC_XML = '''<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ttplayer_lyric>
	<Lyric
		Font="-11,0,0,0,400,0,0,0,134,3,2,4,49,Microsoft YaHei UI"
		TextColor="#9fb6ff"
		HilightColor="#ffffff"
		BkgndColor="#0e1a4a"
	/>
</ttplayer_lyric>
'''

# 皮肤边车: 原版按 <皮肤名>.skn.xml 恢复窗口布局与本皮肤配色(频谱配色权威在此)
SKN_SIDECAR = '''<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ttplayer
	version="5.7.9">
	<Player
		PlayerWnd="934,255,1334,405"
		PlayerWnd2="966,0,1279,25"
		LyricWnd="1334,255,1734,574"
		LyricWnd2="1279,0,1479,25"
		EqualizerWnd="934,405,1334,531"
		PlayListWnd="934,405,1334,775"
		LyricVisible="1"
		EqualizerVisible="0"
		PlayListVisible="1"
	/>
	<Visual
		SpectrumTopColor="#7ea6ff"
		SpectrumBtmColor="#2b4bd8"
		SpectrumMidColor="#4d6bfe"
		SpectrumPeakColor="#cfe0ff"
		SpectrumWide="1"
		BlurSpeed="3"
		Blur="1"
		TextColor="#cfe0ff"
		Font="-12,0,0,0,400,0,0,0,1,0,0,4,0,Microsoft YaHei UI"
		BlurScopeColor="#4d6bfe"
	/>
	<Lyric
		Font="-12,0,0,0,400,0,0,0,1,0,0,4,0,Microsoft YaHei UI"
		TextColor="#9fb6ff"
		HilightColor="#ffffff"
		BkgndColor="#0e1a4a"
	/>
	<PlayList
		Font="-12,0,0,0,400,0,0,0,1,0,0,4,0,Microsoft YaHei UI"
		Color_Text="#cfe0ff"
		Color_Hilight="#ffffff"
		Color_Bkgnd="#0e1a4a"
		Color_Number="#8fa8e8"
		Color_Duration="#8fa8e8"
		Color_Select="#4d6bfe"
		Color_Bkgnd2="#14204f"
		CreateNewVerPlayList="0"
	/>
</ttplayer>
'''

# ================================================================ 打包
def pack():
    out = os.path.join(ROOT, 'DeepSeekWhale.skn')
    if os.path.exists(out):
        os.remove(out)
    z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
    n = 0
    for f in sorted(os.listdir(OUT)):
        if f.lower().endswith(('.bmp', '.xml', '.ico')):
            z.write(os.path.join(OUT, f), f)
            n += 1
    z.close()
    print('packed %d -> %s (%d bytes)' % (n, out, os.path.getsize(out)))

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    gen_player_bg()
    gen_buttons()
    gen_number()
    gen_progress()
    gen_eq()
    gen_eq_bg()
    gen_window_bgs()
    gen_icon()
    wxml('Skin.xml', SKIN_XML, bom=False)
    wxml('Visual.xml', VISUAL_XML)
    wxml('Playlist.xml', PLAYLIST_XML)
    wxml('Lyric.xml', LYRIC_XML)
    # 边车直接部署到 Skin\(不进 .skn 包)
    with open(r'D:\TTPlayer\Skin\DeepSeekWhale.skn.xml', 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(SKN_SIDECAR)
    pack()
    # 全部 BMP 预览
    from PIL import Image as I2
    for f in sorted(os.listdir(OUT)):
        if f.endswith('.bmp'):
            im = I2.open(os.path.join(OUT, f))
            z = max(1, min(6, 700 // max(im.size)))
            im.resize((im.width * z, im.height * z), I2.NEAREST).save(os.path.join(PREV, f + '.png'))
    print('done ->', OUT)

if __name__ == '__main__':
    main()
