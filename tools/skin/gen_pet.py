# -*- coding: utf-8 -*-
"""
DeepSeek 胖鲸鱼桌面宠物 v8 —— 卡通人形「鲸鱼娘」: 深蓝女仆装+端白饭碗的 Q 版女孩 + 鲸鱼尾巴
11 个拟人状态: 待机(摇尾)/走路(摇尾)/吃饭/睡觉/高兴/不开心/工作忙/听音乐/K歌/生气/游泳
不用照片抠图; 全程 RGBA 自绘, 落盘前 alpha 二值化, 绝不与品红混色。

防"看着透明"管线(同 v6/v7):
  1. decontaminate: 透明区 RGB 先填描边色, 插值不渗杂色
  2. flatten: LANCZOS 缩放后 alpha 二值化(>=128)硬贴 + 3x3 闭运算封缝
  3. plug_holes: 洪泛补掉被角色包住的品红洞(配件一律实心填充)
  4. 碗/笔电/话筒等道具画进超采样身体图层(随动作移动), 漂浮配件画在最终帧
输出: pet-frames/{idle,walk,eat,sleep,happy,sad,work,music,ktv,angry,swim}.bmp
      + pet-preview.gif + preview_sheet.png
"""
import os, sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance

S = 4          # 超采样倍数
F = 96         # 帧尺寸(与 whale.c FRM 一致)
MAG = (255, 0, 255)

# ---- 鲸鱼娘配色(对齐素材主色: 靛蓝 #3f4d83 系 + 白围裙 + 暖肤色) ----
HAIR_STOPS = [(0.00, (38, 48, 106)), (0.45, (64, 82, 156)), (1.00, (112, 140, 224))]
DRESS_STOPS = [(0.00, (32, 42, 100)), (1.00, (58, 74, 152))]
TAIL_D = (38, 48, 106)
TAIL_L = (58, 74, 150)
DRESS_D = (28, 36, 88)
INK = (24, 28, 54)
INK_SOFT = (34, 40, 78)
SKIN = (255, 224, 197)
SKIN_SH = (247, 204, 172)
WHITE = (252, 252, 254)
FRILL_EDGE = (208, 216, 238)
PINK = (255, 150, 174)
PINK_D = (255, 118, 148)
BOW = (92, 124, 246)
RICE_SH = (226, 230, 246)
HEART = (255, 88, 126)
GOLD = (255, 212, 128)
WATER = (150, 196, 255)
WATER2 = (205, 229, 255)
ANGER = (238, 84, 84)
SCR = (92, 112, 192)
SCR_TXT = (182, 202, 255)

def sample(stops, t):
    if t <= stops[0][0]:
        return stops[0][1]
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return tuple(int(c0[k] + (c1[k] - c0[k]) * f) for k in range(3))
    return stops[-1][1]

def canvas():
    return Image.new('RGBA', (F * S, F * S), (0, 0, 0, 0))

def box(cx, cy, rx, ry):
    return [int((cx - rx) * S), int((cy - ry) * S), int((cx + rx) * S), int((cy + ry) * S)]

def ell(size, cx, cy, rx, ry):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).ellipse(box(cx, cy, rx, ry), fill=255)
    return m

def vgrad(w, h, stops):
    g = Image.new('RGB', (w, h))
    px = g.load()
    for y in range(h):
        c = sample(stops, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = c
    return g

def paste_grad(im, mask, stops):
    bb = mask.getbbox()
    if not bb:
        return
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    grad = vgrad(gw, gh, stops).convert('RGBA')
    grad.putalpha(mask.crop(bb))
    im.paste(grad, (bb[0], bb[1]), grad)
    dil = mask.filter(ImageFilter.MaxFilter(2 * int(1.45 * S) + 1))
    im.paste(INK + (255,), (0, 0), ImageChops.subtract(dil, mask))

def decontaminate(im, col=INK):
    a = im.split()[3]
    solid = Image.new('RGB', im.size, col)
    solid.paste(im.convert('RGB'), (0, 0), a)
    solid.putalpha(a)
    return solid

def outline(im, mask, w=1.45, col=INK):
    dil = mask.filter(ImageFilter.MaxFilter(2 * int(w * S) + 1))
    im.paste(col + (255,), (0, 0), ImageChops.subtract(dil, mask))

# ================================================================ 鲸鱼娘本体
def girl(eyes='open', mouth='smile', bowl='hold', chew=0.0,
         ahoge=0.0, blush=True, tail=0.0,
         brow=False, arms=None, prop=None, headph=False,
         sweat=False, tear=0.0, anger=False, scr=0, paddle=0.0):
    """bowl: 'hold'端胸前/'up'举嘴边/'high'举头顶/None
       arms: None跟随bowl/'hip'叉腰/'paddle'划水
       prop: None/'laptop'打字/'mic'手持话筒   tail: -1..1 摇尾"""
    im = canvas()
    sz = im.size
    d = ImageDraw.Draw(im, 'RGBA')
    CX = 48.0

    # ---------------- 鲸鱼尾巴(身后右侧, 双瓣, 摇摆) ----------------
    w = 3.0 * tail
    bx, by = 57.0, 64.5                       # 根部(被裙子遮住)
    tipx, tipy = 70.5, 62.0 + w * 0.6
    d.polygon([(bx * S, (by - 2.2) * S), (tipx * S, (tipy - 2.0) * S),
               ((tipx - 1.5) * S, (tipy + 4.4) * S), (bx * S, (by + 3.6) * S)],
              fill=TAIL_D, outline=INK_SOFT)
    # 上瓣
    d.polygon([(tipx * S, tipy * S), ((tipx + 13.0) * S, (tipy - 11.0 + 1.6 * tail) * S),
               ((tipx + 3.0) * S, (tipy + 3.2) * S)], fill=TAIL_L, outline=INK_SOFT)
    # 下瓣
    d.polygon([((tipx - 0.5) * S, (tipy + 1.5) * S), ((tipx + 13.5) * S, (tipy + 11.0 - 1.6 * tail) * S),
               ((tipx + 2.5) * S, (tipy + 6.0) * S)], fill=TAIL_D, outline=INK_SOFT)
    d.polygon([((tipx + 1.5) * S, tipy * S), ((tipx + 11.0) * S, (tipy - 7.5 + 1.2 * tail) * S),
               ((tipx + 3.5) * S, (tipy + 4.0) * S)], fill=(48, 62, 128))

    # ---------------- 后发(含两侧发梢) ----------------
    hm = ImageChops.lighter(
        ImageChops.lighter(ell(sz, CX, 31.0, 22.6, 20.2), ell(sz, CX, 40.0, 22.6, 12.5)),
        ImageChops.lighter(ell(sz, 29.0, 44.0, 5.4, 7.2), ell(sz, 67.0, 44.0, 5.4, 7.2)))
    paste_grad(im, hm, HAIR_STOPS)

    # ---------------- 鲸尾呆毛 ----------------
    sw = math.sin(ahoge)
    tx, ty = 52.0, 13.5
    d.polygon([((tx - 0.5) * S, ty * S), ((tx - 7.5 + 1.5 * sw) * S, (ty - 9.5) * S),
               ((tx - 1.0) * S, (ty - 4.5) * S)], fill=(44, 56, 118), outline=INK_SOFT)
    d.polygon([((tx + 0.5) * S, ty * S), ((tx + 7.5 + 1.5 * sw) * S, (ty - 9.0) * S),
               ((tx + 1.2) * S, (ty - 4.2) * S)], fill=(58, 74, 150), outline=INK_SOFT)

    # ---------------- 腿 + 鞋 ----------------
    for lx in (43.5, 52.5):
        d.line([lx * S, 77.5 * S, lx * S, 85.0 * S], fill=SKIN, width=int(2.6 * S))
        d.ellipse(box(lx, 86.4, 3.4, 2.2), fill=DRESS_D, outline=INK)
    d.line([43.5 * S, 81.0 * S, 43.5 * S, 85.0 * S], fill=(238, 240, 250), width=int(2.6 * S))
    d.line([52.5 * S, 81.0 * S, 52.5 * S, 85.0 * S], fill=(238, 240, 250), width=int(2.6 * S))

    # ---------------- 女仆裙 ----------------
    poly = Image.new('L', sz, 0)
    ImageDraw.Draw(poly).polygon([(41.0 * S, 46.0 * S), (55.0 * S, 46.0 * S),
                                  (62.5 * S, 75.0 * S), (33.5 * S, 75.0 * S)], fill=255)
    dm = ImageChops.lighter(poly, ell(sz, CX, 64.5, 14.8, 14.2))
    paste_grad(im, dm, DRESS_STOPS)

    # ---------------- 白围裙 ----------------
    ap = Image.new('L', sz, 0)
    ImageDraw.Draw(ap).polygon([(44.5 * S, 49.0 * S), (51.5 * S, 49.0 * S),
                                (56.5 * S, 72.5 * S), (39.5 * S, 72.5 * S)], fill=255)
    ap = ImageChops.lighter(ap, ell(sz, CX, 69.5, 8.6, 5.6))
    im.paste(WHITE + (255,), (0, 0), ap)
    outline(im, ap, 0.9, FRILL_EDGE)

    fx = [36.2, 40.9, 45.7, 50.5, 55.2, 59.9]
    for x in fx:
        d.ellipse(box(x, 76.6, 2.75, 2.55), fill=WHITE, outline=FRILL_EDGE, width=int(0.7 * S))

    # ---------------- 围裙蝴蝶结 ----------------
    d.polygon([(48.0 * S, 51.6 * S), (42.2 * S, 49.4 * S), (42.2 * S, 54.0 * S)],
              fill=BOW, outline=INK_SOFT)
    d.polygon([(48.0 * S, 51.6 * S), (53.8 * S, 49.4 * S), (53.8 * S, 54.0 * S)],
              fill=BOW, outline=INK_SOFT)
    d.ellipse(box(48.0, 51.6, 1.7, 1.7), fill=BOW, outline=INK_SOFT)

    # ---------------- 泡泡袖 + 白袖口 ----------------
    for sgn in (-1, 1):
        sxp = CX + sgn * 11.5
        d.ellipse(box(sxp, 50.0, 5.2, 4.6), fill=(52, 66, 134), outline=INK)
        d.ellipse(box(sxp, 54.2, 3.1, 1.9), fill=WHITE, outline=FRILL_EDGE, width=int(0.6 * S))

    # ---------------- 衣领 ----------------
    d.ellipse(box(CX, 46.6, 6.6, 2.0), fill=WHITE, outline=FRILL_EDGE, width=int(0.6 * S))

    # ---------------- 脸 ----------------
    fm = ell(sz, CX, 32.0, 16.8, 14.8)
    paste_grad(im, fm, [(0.00, SKIN), (1.00, SKIN_SH)])

    # ---------------- 前发 ----------------
    bang = ImageChops.lighter(
        ImageChops.lighter(ell(sz, 38.0, 20.0, 6.8, 7.2), ell(sz, CX, 18.4, 7.2, 7.6)),
        ell(sz, 58.0, 20.0, 6.8, 7.2))
    bang = ImageChops.lighter(bang, ell(sz, 30.6, 33.0, 4.6, 8.6))
    bang = ImageChops.lighter(bang, ell(sz, 65.4, 33.0, 4.6, 8.6))
    paste_grad(im, bang, HAIR_STOPS)

    # ---------------- 女仆头饰 ----------------
    hb = box(CX, 31.0, 21.4, 19.0)
    d.arc(hb, 196, 344, fill=WHITE, width=int(3.0 * S))
    for adeg in (208, 232, 256, 280, 304, 328):
        a = math.radians(adeg)
        hx = CX + math.cos(a) * 20.4
        hy = 31.0 + math.sin(a) * 18.0
        d.ellipse(box(hx, hy, 2.0, 2.0), fill=WHITE, outline=FRILL_EDGE, width=int(0.6 * S))
    d.polygon([(62.0 * S, 14.6 * S), (66.4 * S, 12.6 * S), (66.0 * S, 16.8 * S)],
              fill=BOW, outline=INK_SOFT)
    d.polygon([(62.0 * S, 14.6 * S), (57.8 * S, 12.4 * S), (58.4 * S, 16.6 * S)],
              fill=BOW, outline=INK_SOFT)

    # ---------------- 耳机(听音乐) ----------------
    if headph:
        d.arc(box(CX, 32.0, 20.6, 18.8), 193, 347, fill=INK, width=int(2.3 * S))
        for ex0 in (28.8, 67.2):
            d.ellipse(box(ex0, 33.0, 4.4, 5.0), fill=(58, 74, 150), outline=INK)
            d.ellipse(box(ex0, 33.0, 1.7, 2.0), fill=PINK)

    # ---------------- 眉毛(生气) ----------------
    if brow:
        d.line([36.4 * S, 29.0 * S, 43.6 * S, 31.8 * S], fill=INK, width=int(1.5 * S))
        d.line([59.6 * S, 29.0 * S, 52.4 * S, 31.8 * S], fill=INK, width=int(1.5 * S))

    # ---------------- 眼睛 ----------------
    exl, exr, eyy = 40.2, 55.8, 36.0
    for ex in (exl, exr):
        if eyes == 'open':
            d.ellipse(box(ex, eyy, 3.5, 4.9), fill=INK)
            d.ellipse(box(ex, eyy + 0.5, 2.5, 3.7), fill=(62, 98, 238))
            d.ellipse(box(ex - 1.2, eyy - 1.9, 1.25, 1.25), fill=(255, 255, 255))
            d.ellipse(box(ex + 1.3, eyy + 2.1, 0.62, 0.62), fill=(232, 240, 255))
        elif eyes == 'closed':
            d.arc(box(ex, eyy + 0.6, 4.4, 3.1), 12, 168, fill=INK, width=int(1.5 * S))
        elif eyes == 'happy':
            d.arc(box(ex, eyy + 2.2, 4.6, 3.6), 200, 340, fill=INK, width=int(1.7 * S))
        elif eyes == 'down':
            d.ellipse(box(ex, eyy + 1.3, 3.1, 3.9), fill=INK)
            d.ellipse(box(ex, eyy + 1.7, 2.2, 2.9), fill=(62, 98, 238))
            d.ellipse(box(ex - 0.9, eyy + 0.7, 0.9, 0.9), fill=(255, 255, 255))
        elif eyes == 'sad':
            d.ellipse(box(ex, eyy + 0.6, 3.3, 4.2), fill=INK)
            d.ellipse(box(ex, eyy + 1.0, 2.3, 3.1), fill=(62, 98, 238))
            d.ellipse(box(ex - 1.0, eyy - 0.6, 1.0, 1.0), fill=(255, 255, 255))
            # 上睑压低(外角下垂)
            lift = SKIN if ex < CX else SKIN
            d.rectangle([int((ex - 4.2) * S), int((eyy - 6.0) * S),
                         int((ex + 4.2) * S), int((eyy - 0.4) * S)], fill=lift)
            o = -1 if ex < CX else 1
            d.line([(ex - o * 3.6) * S, (eyy - 1.6) * S, (ex + o * 3.6) * S, (eyy - 0.2) * S],
                   fill=INK, width=int(1.4 * S))

    # ---------------- 腮红 / 开吃鼓腮 ----------------
    if blush:
        d.ellipse(box(34.2, 41.0, 3.3, 2.0), fill=PINK)
        d.ellipse(box(61.8, 41.0, 3.3, 2.0), fill=PINK)
    if chew > 0.02:
        cxp = 60.2 if chew < 0.5 else 35.8
        rr = 2.6 + 0.8 * min(chew, 1.0 - chew) * 2
        d.ellipse(box(cxp, 41.8, rr, rr * 0.85), fill=PINK_D)

    # ---------------- 嘴 ----------------
    mx, my = CX, 43.2
    if mouth == 'smile':
        d.arc(box(mx, my, 3.4, 2.6), 15, 165, fill=INK, width=int(1.2 * S))
    elif mouth == 'open':
        d.ellipse(box(mx, my + 0.2, 2.9, 2.5), fill=INK)
        d.ellipse(box(mx, my + 1.3, 1.7, 1.3), fill=(255, 128, 152))
    elif mouth == 'frown':
        d.arc(box(mx, my + 2.6, 3.2, 2.8), 195, 345, fill=INK, width=int(1.3 * S))
    elif mouth == 'grit':
        d.line([(mx - 3.1) * S, (my + 0.9) * S, (mx + 3.1) * S, (my + 0.9) * S],
               fill=INK, width=int(1.3 * S))
    elif mouth == 'sing':
        d.ellipse(box(mx, my + 0.4, 3.6, 3.1), fill=INK)
        d.ellipse(box(mx, my + 1.6, 2.0, 1.8), fill=(255, 128, 152))

    # ---------------- 手臂 ----------------
    def arm(x0, y0, x1, y1, hx=None, hy=None):
        d.line([x0 * S, y0 * S, x1 * S, y1 * S], fill=INK, width=int(4.6 * S))
        d.line([x0 * S, y0 * S, x1 * S, y1 * S], fill=SKIN, width=int(3.0 * S))
        if hx is not None:
            d.ellipse(box(hx, hy, 2.3, 2.3), fill=SKIN, outline=INK)

    def bowl_ss(cx, cy, w):
        d.ellipse(box(cx, cy + w * 0.12, w, w * 0.42), fill=WHITE, outline=INK)
        d.arc(box(cx, cy + w * 0.12, w, w * 0.42), 15, 165, fill=(176, 190, 226), width=int(0.9 * S))
        d.ellipse(box(cx, cy - w * 0.42, w * 0.90, w * 0.40), fill=WHITE, outline=INK)
        d.ellipse(box(cx - w * 0.34, cy - w * 0.52, w * 0.30, w * 0.16), fill=RICE_SH)
        for rx0, ry0 in ((-0.45, -0.16), (0.10, -0.30), (0.42, -0.10)):
            d.ellipse(box(cx + w * rx0, cy + w * ry0 - w * 0.34, w * 0.16, w * 0.13), fill=WHITE)

    if bowl == 'hold':
        bowl_ss(CX, 65.0, 10.6)
        arm(36.6, 51.5, 40.8, 61.0, 40.8, 61.0)
        arm(59.4, 51.5, 55.2, 61.0, 55.2, 61.0)
    elif bowl == 'up':
        bowl_ss(CX, 49.6, 10.8)
        arm(36.6, 51.5, 40.4, 54.6, 40.4, 54.6)
        arm(59.4, 51.5, 55.6, 54.6, 55.6, 54.6)
    elif bowl == 'high':
        bowl_ss(CX, 14.6, 10.0)
        arm(36.6, 50.5, 39.4, 19.6, 39.4, 19.6)
        arm(59.4, 50.5, 56.6, 19.6, 56.6, 19.6)
    elif arms == 'hip':
        arm(37.0, 51.5, 33.6, 61.0, 33.6, 61.0)
        arm(59.0, 51.5, 62.4, 61.0, 62.4, 61.0)
    elif arms == 'paddle':
        dx0 = 2.2 * paddle
        arm(37.0, 51.5, 39.5 + dx0, 63.0, 39.5 + dx0, 63.0)
        arm(59.0, 51.5, 56.5 - dx0, 63.0, 56.5 - dx0, 63.0)
    else:   # 垂手
        arm(37.0, 51.5, 36.0, 60.0, 36.0, 60.0)
        arm(59.0, 51.5, 60.0, 60.0, 60.0, 60.0)

    # ---------------- 道具: 笔电(工作忙) ----------------
    if prop == 'laptop':
        hb2 = 0.9 * math.sin(scr * math.pi / 4.0)   # 手部敲击起伏
        d.rounded_rectangle([int(37.5 * S), int(54.0 * S), int(58.5 * S), int(72.0 * S)],
                            radius=int(1.8 * S), fill=(54, 58, 92), outline=INK, width=int(1.2 * S))
        d.rectangle([int(40.0 * S), int(56.5 * S), int(56.0 * S), int(68.5 * S)], fill=SCR)
        for li in range(3):
            ly = 59.5 + li * 3.0
            lw = 8.0 + 4.0 * math.sin(scr * 1.1 + li * 2.1)
            d.line([(48 - lw / 2) * S, ly * S, (48 + lw / 2) * S, ly * S],
                   fill=SCR_TXT, width=int(1.0 * S))
        d.polygon([(35.0 * S, 72.0 * S), (61.0 * S, 72.0 * S),
                   (64.0 * S, 77.0 * S), (32.0 * S, 77.0 * S)],
                  fill=(96, 100, 130), outline=INK)
        arm(36.6, 51.5, 40.0, 73.5 + hb2, 40.0, 73.5 + hb2)
        arm(59.4, 51.5, 56.0, 73.5 - hb2, 56.0, 73.5 - hb2)

    # ---------------- 道具: 话筒(K歌) ----------------
    if prop == 'mic':
        arm(36.8, 51.5, 33.6, 61.0, 33.6, 61.0)          # 左手叉腰
        arm(58.8, 51.5, 64.0, 40.5, 64.0, 40.5)          # 右手举话筒
        d.line([62.6 * S, 43.0 * S, 65.0 * S, 39.0 * S], fill=INK, width=int(2.6 * S))
        d.line([62.8 * S, 42.6 * S, 64.9 * S, 39.3 * S], fill=(150, 156, 182), width=int(1.6 * S))
        d.ellipse(box(65.4, 36.4, 3.1, 3.1), fill=(160, 166, 192), outline=INK)
        d.ellipse(box(64.4, 35.2, 0.9, 0.9), fill=(235, 240, 252))

    # ---------------- 汗滴 / 泪珠 / 怒符 ----------------
    if sweat:
        d.ellipse(box(62.6, 25.6, 1.5, 1.9), fill=WATER2, outline=(120, 170, 240), width=int(0.6 * S))
    if tear > 0.02:
        ty2 = 39.5 + 3.0 * min(tear, 1.0)
        d.ellipse(box(62.6, ty2, 1.3, 1.6), fill=WATER)
    if anger:
        d.line([61.6 * S, 17.2 * S, 66.4 * S, 21.4 * S], fill=ANGER, width=int(1.4 * S))
        d.line([66.4 * S, 17.2 * S, 61.6 * S, 21.4 * S], fill=ANGER, width=int(1.4 * S))
        d.line([68.2 * S, 14.6 * S, 71.4 * S, 17.4 * S], fill=ANGER, width=int(1.2 * S))
        d.line([71.4 * S, 14.6 * S, 68.2 * S, 17.4 * S], fill=ANGER, width=int(1.2 * S))

    return decontaminate(im)

# ---------------------------------------------------------------- 变换
def place(layer, dy=0.0, rot=0.0, sx=1.0, sy=1.0, dim=1.0, dx=0.0, piv=(48.0, 62.0)):
    im = layer
    if sx != 1.0 or sy != 1.0:
        im = im.resize((max(1, int(im.width * sx)), max(1, int(im.height * sy))), Image.LANCZOS)
        piv = (piv[0] * sx, piv[1] * sy)
    if rot:
        im = im.rotate(rot, Image.BICUBIC, center=(piv[0] * S, piv[1] * S))
    if dim != 1.0:
        a = im.split()[3]
        rgb = ImageEnhance.Brightness(im.convert('RGB')).enhance(dim)
        im = rgb.convert('RGBA')
        im.putalpha(a)
    ox, oy = int(round(dx * S)), int(round(dy * S))
    if ox or oy:
        out = Image.new('RGBA', im.size, (0, 0, 0, 0))
        out.paste(im, (ox, oy))
        im = out
    return im

# ---------------------------------------------------------------- 落盘: 二值 alpha
def plug_holes(bg, max_iter=8):
    w, h = bg.size
    for _ in range(max_iter):
        px = bg.load()
        seen = [[False] * w for _ in range(h)]
        st = []
        for x in range(w):
            for y in (0, h - 1):
                if px[x, y] == MAG: st.append((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if px[x, y] == MAG: st.append((x, y))
        while st:
            x, y = st.pop()
            if seen[y][x]: continue
            seen[y][x] = True
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] == MAG:
                    st.append((nx, ny))
        holes = [(x, y) for y in range(h) for x in range(w)
                 if px[x, y] == MAG and not seen[y][x]]
        if not holes:
            return bg
        fix = {}
        for (x, y) in holes:
            cnt = {}
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny] != MAG:
                        cnt[px[nx, ny]] = cnt.get(px[nx, ny], 0) + 1
            if cnt:
                fix[(x, y)] = max(cnt.items(), key=lambda kv: kv[1])[0]
        for (x, y), c in fix.items():
            bg.putpixel((x, y), c)
        if not fix:
            return bg
    return bg

def flatten(layer):
    small = layer.resize((F, F), Image.LANCZOS)
    a = small.split()[3].point(lambda v: 255 if v >= 128 else 0)
    a = a.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    bg = Image.new('RGB', (F, F), MAG)
    bg.paste(small, (0, 0), a)
    return plug_holes(bg)

# ---------------------------------------------------------------- 漂浮配件(最终帧坐标)
def note(d, x, y, s, col=(196, 216, 255)):
    d.ellipse([x - s * 0.30, y + s * 0.20, x + s * 0.30, y + s * 0.72], fill=col)
    d.line([x + s * 0.26, y + s * 0.38, x + s * 0.26, y - s * 0.44], fill=col, width=max(2, int(s * 0.16)))
    d.polygon([(x + s * 0.26, y - s * 0.44), (x + s * 0.72, y - s * 0.24),
               (x + s * 0.26, y - s * 0.08)], fill=col)

def heart(d, x, y, s, col=HEART):
    d.polygon([(x, y + s), (x - s, y - s * 0.14), (x - s * 0.54, y - s * 0.88),
               (x, y - s * 0.34), (x + s * 0.54, y - s * 0.88), (x + s, y - s * 0.14)], fill=col)

def zzz(d, x, y, fi):
    for i in range(3):
        s = 4.4 + i * 3.0
        ph = math.sin(fi * math.pi / 2.0 + i * 1.1)
        zx, zy = x + i * 6.2 + ph * 1.4, y - i * 6.4
        col = (214, 230, 255) if i == 2 else (168, 198, 255)
        w = 2 if i else 1
        d.line([zx - s / 2, zy - s / 2, zx + s / 2, zy - s / 2], fill=col, width=w)
        d.line([zx + s / 2, zy - s / 2, zx - s / 2, zy + s / 2], fill=col, width=w)
        d.line([zx - s / 2, zy + s / 2, zx + s / 2, zy + s / 2], fill=col, width=w)

def sparkle(d, x, y, r, col=GOLD):
    p = []
    for i in range(8):
        a = math.pi / 4 * i
        rr = r if i % 2 == 0 else r * 0.32
        p.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    d.polygon(p, fill=col)
    d.ellipse([x - r * 0.30, y - r * 0.30, x + r * 0.30, y + r * 0.30], fill=col)

def rice_bit(d, x, y):
    d.ellipse([x - 1.4, y - 1.1, x + 1.4, y + 1.1], fill=(255, 255, 255))

def bubble(d, x, y, r, col=WATER2):
    d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=WATER, width=1)

def cloud_drop(d, x, y):
    """伤心小雨点"""
    d.ellipse([x - 1.3, y - 1.6, x + 1.3, y + 1.6], fill=WATER)

# ---------------------------------------------------------------- 十一态
def gen_idle():
    fr = []
    for i in range(8):
        t = i / 8.0 * math.pi * 2
        k = 0.5 - 0.5 * math.cos(t)
        ey = 'happy' if i == 5 else 'open'
        g = girl(eyes=ey, ahoge=0.7 * math.sin(t), tail=0.65 * math.sin(t))
        fr.append(flatten(place(g, dy=-1.8 * math.sin(t),
                                sy=1.0 + 0.010 * k, sx=1.0 - 0.006 * k)))
    return fr

def gen_walk():
    fr = []
    for i in range(6):
        t = i / 6.0 * math.pi * 2
        g = girl(ahoge=1.3 * math.sin(t), tail=1.0 * math.sin(t))
        f = flatten(place(g, dy=-2.2 * abs(math.sin(t)), rot=4.5 * math.sin(t)))
        d = ImageDraw.Draw(f, 'RGBA')
        for j, (nx, ny, szz) in enumerate(((8, 66, 6.0), (3, 50, 5.0), (13, 38, 4.2))):
            if (i + j) % 2 == 0:
                note(d, nx, ny, szz)
        fr.append(f)
    return fr

def gen_eat():
    fr = []
    for i in range(6):
        up = i not in (0, 3)
        ch = (i % 3) / 2.0 if up else 0.0
        g = girl(mouth='smile', bowl='up' if up else 'hold', chew=ch if up else 0.0,
                 ahoge=0.4 * math.sin(i), tail=0.3 * math.sin(i))
        f = flatten(place(g, dy=0.6 * math.sin(i * math.pi / 3.0)))
        d = ImageDraw.Draw(f, 'RGBA')
        if up and i in (2, 5):
            rice_bit(d, 62, 44)
            rice_bit(d, 66, 40)
        if i == 2:
            heart(d, 82, 24, 3.4)
        fr.append(f)
    return fr

def gen_sleep():
    fr = []
    for i in range(4):
        g = girl(eyes='closed', mouth='smile', bowl=None, ahoge=0.3 * math.sin(i),
                 tail=0.15 * math.sin(i))
        f = flatten(place(g, dy=-1.2 * math.sin(i / 4.0 * math.pi * 2), rot=2.5, dim=0.80))
        d = ImageDraw.Draw(f, 'RGBA')
        zzz(d, 76, 40, i)
        fr.append(f)
    return fr

def gen_happy():
    keys = [(0.0, 1.00, 1.00), (-3.5, 1.04, 0.96), (-6.5, 0.99, 1.02),
            (-7.5, 1.00, 1.00), (-6.5, 0.99, 1.02), (-3.5, 1.04, 0.96),
            (0.0, 1.06, 0.94), (0.0, 1.01, 0.99)]
    fr = []
    for i, (dy, sx, sy) in enumerate(keys):
        air = dy < -0.5
        g = girl(eyes='happy' if air else 'open', mouth='open' if air else 'smile',
                 bowl='high' if air else 'hold', ahoge=1.0 if air else 0.0,
                 tail=1.0 if air else 0.4)
        f = flatten(place(g, dy=dy, sx=sx, sy=sy))
        d = ImageDraw.Draw(f, 'RGBA')
        if dy <= -3.5:
            heart(d, 12, 42, 4.0)
            heart(d, 86, 38, 3.0, (255, 150, 174))
        if dy <= -6.5:
            sparkle(d, 17, 20, 4.4)
            sparkle(d, 82, 16, 3.4)
            note(d, 26, 12, 5.0)
        fr.append(f)
    return fr

def gen_sad():
    keys = [(1.6, 2.2, 0), (1.9, 2.6, 0.35), (2.1, 2.9, 0.7), (2.1, 2.9, 1.0),
            (1.9, 2.6, 0.5), (1.6, 2.2, 0.1)]
    fr = []
    for i, (dy, rot, tr) in enumerate(keys):
        g = girl(eyes='sad', mouth='frown', bowl=None, blush=False,
                 tear=tr, ahoge=-0.6, tail=-0.3)
        f = flatten(place(g, dy=dy, rot=rot, dim=0.94))
        d = ImageDraw.Draw(f, 'RGBA')
        cloud_drop(d, 74 - (i % 2), 26 + i * 2.2)
        cloud_drop(d, 20, 30 + ((i + 3) % 4) * 2.4)
        fr.append(f)
    return fr

def gen_work():
    fr = []
    for i in range(8):
        g = girl(eyes='down', mouth='grit', bowl=None, prop='laptop',
                 scr=i, sweat=(i in (2, 6)), ahoge=0.2 * math.sin(i), tail=0.2 * math.sin(i + 1))
        f = flatten(place(g, dy=0.4 * math.sin(i * math.pi / 2.0)))
        d = ImageDraw.Draw(f, 'RGBA')
        if i in (2, 6):
            cloud_drop(d, 66, 24)
        fr.append(f)
    return fr

def gen_music():
    fr = []
    for i in range(8):
        t = i / 8.0 * math.pi * 2
        g = girl(eyes='happy', mouth='sing' if i in (1, 2, 5, 6) else 'smile',
                 bowl=None, headph=True, ahoge=0.8 * math.sin(t), tail=0.8 * math.sin(t))
        f = flatten(place(g, dy=-1.6 * abs(math.sin(t)), rot=4.0 * math.sin(t)))
        d = ImageDraw.Draw(f, 'RGBA')
        if i % 2 == 0:
            note(d, 10, 34 - 3 * (i % 4), 5.2)
            note(d, 84, 46 - 3 * ((i + 1) % 4), 4.4)
        fr.append(f)
    return fr

def gen_ktv():
    fr = []
    for i in range(8):
        t = i / 8.0 * math.pi * 2
        g = girl(eyes='happy' if i % 3 else 'open',
                 mouth='sing' if i % 3 else 'smile',
                 bowl=None, prop='mic', ahoge=0.9 * math.sin(t), tail=0.9 * math.sin(t))
        f = flatten(place(g, dy=-1.4 * abs(math.sin(t)), rot=2.5 * math.sin(t)))
        d = ImageDraw.Draw(f, 'RGBA')
        if i % 3 == 0:
            sparkle(d, 14, 24, 4.2)
            note(d, 82, 18 + 3 * (i % 2), 5.0)
        if i % 3 == 1:
            note(d, 12, 30, 4.6)
            sparkle(d, 84, 34, 3.4)
        fr.append(f)
    return fr

def gen_angry():
    fr = []
    for i in range(8):
        t = i / 8.0 * math.pi * 2
        g = girl(eyes='open', mouth='grit', bowl=None, brow=True, arms='hip',
                 anger=True, blush=False, ahoge=-0.4, tail=-0.7 + 0.2 * math.sin(t))
        f = flatten(place(g, dy=-0.8 * abs(math.sin(t)), dx=0.7 * math.sin(t),
                          sx=1.03, sy=1.02))
        d = ImageDraw.Draw(f, 'RGBA')
        if i % 4 < 2:
            d.ellipse([14 - 2.4, 18 - 2.4, 14 + 2.4, 18 + 2.4], fill=(255, 178, 128))
            d.ellipse([84 - 2.0, 26 - 2.0, 84 + 2.0, 26 + 2.0], fill=(255, 178, 128))
        fr.append(f)
    return fr

def gen_swim():
    fr = []
    for i in range(8):
        t = i / 8.0 * math.pi * 2
        g = girl(eyes='happy', mouth='smile', bowl=None, arms='paddle',
                 paddle=math.sin(t), ahoge=1.0 * math.sin(t), tail=1.1 * math.sin(t))
        f = flatten(place(g, dy=2.0 + 1.6 * math.sin(t), rot=-16))
        d = ImageDraw.Draw(f, 'RGBA')
        # 水面(盖住下半身, 营造泡在水里)
        ph = t
        top = [(x, 63.0 + 3.2 * math.sin(x / 14.0 + ph)) for x in range(0, 97, 4)]
        d.polygon([(0, 96), (0, top[0][1])] + top + [(96, top[-1][1]), (96, 96)],
                  fill=WATER2)
        crest = [(x, top[j][1] - 2.2) for j, x in enumerate(range(0, 97, 4))]
        d.polygon([(0, crest[0][1])] + crest +
                  [(crest[-1][0], top[-1][1])] + list(reversed(top)),
                  fill=WATER)
        # 水里气泡
        for k, (bx0, bph) in enumerate(((14, 0.0), (30, 0.4), (76, 0.8))):
            byy = 92 - 8 * ((i / 8.0 + bph) % 1.0)
            bubble(d, bx0, byy, 1.6 + 0.5 * (k % 2))
        # 水花(划水)
        if i % 4 in (0, 1):
            cloud_drop(d, 24, 60 + 2 * math.sin(t))
            cloud_drop(d, 72, 60 - 2 * math.sin(t))
        fr.append(f)
    return fr

STATES = [('idle', 8, gen_idle), ('walk', 6, gen_walk), ('eat', 6, gen_eat),
          ('sleep', 4, gen_sleep), ('happy', 8, gen_happy), ('sad', 6, gen_sad),
          ('work', 8, gen_work), ('music', 8, gen_music), ('ktv', 8, gen_ktv),
          ('angry', 8, gen_angry), ('swim', 8, gen_swim)]

def on_bg(f, bgc=(64, 68, 88)):
    bg = Image.new('RGB', (F, F), bgc)
    px, bp = f.load(), bg.load()
    for y in range(F):
        for x in range(F):
            r, g, b = px[x, y]
            if not (r == 255 and g == 0 and b == 255):
                bp[x, y] = (r, g, b)
    return bg

def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else 'pet-frames'
    os.makedirs(outdir, exist_ok=True)
    seq, report = [], []
    for name, cnt, fn in STATES:
        frames = [plug_holes(f) for f in fn()]
        assert len(frames) == cnt, (name, len(frames), cnt)
        sheet = Image.new('RGB', (F * cnt, F), MAG)
        for i, f in enumerate(frames):
            sheet.paste(f, (i * F, 0))
        sheet.save(os.path.join(outdir, name + '.bmp'))
        m = sum(1 for p in sheet.getdata() if p == MAG)
        report.append('%s %d frames  magenta %d%%' % (name, cnt, m * 100 // (F * cnt * F)))
        for f in frames:
            seq.append(on_bg(f))
    print('\n'.join(report))
    cols, sc = 8, 2
    rows = (len(seq) + cols - 1) // cols
    grd = Image.new('RGB', (cols * F * sc, rows * F * sc), (46, 48, 62))
    for i, f in enumerate(seq):
        grd.paste(f.resize((F * sc, F * sc), Image.NEAREST),
                  ((i % cols) * F * sc, (i // cols) * F * sc))
    grd.save('preview_sheet.png')
    seq[0].save('pet-preview.gif', save_all=True, append_images=seq[1:], duration=110, loop=0)
    print('gif %d frames, sheet %dx%d' % (len(seq), grd.width, grd.height))

if __name__ == '__main__':
    main()
