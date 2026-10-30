"""生成 DeepSeek 鲸鱼 logo 的皮肤化变体。

思路：SVG 官方版是「纯蓝 #4468FE + 纯白腹鳍 + 纯黑细线」，直接贴到深蓝皮肤上很跳。
先把 SVG 渲染图按区域分类：
  0 = 主体    1 = 大腹部白块    2 = 眼睛/小白块    3 = 深色嘴线
再按配色方案重新着色。眼睛区域用「周围主体的颜色」填充（用邻域众数，避免出现色斑）。
"""
import math
import collections
import pngio

SVG_4X = 'png/logo_svg4.png'
WORK_W, WORK_H = 370, 380

# 皮肤配色
SKY_TOP = (0x7e, 0xa6, 0xff)
SKY_BOT = (0x2b, 0x4b, 0xd8)
GLOW = (0x4d, 0x6b, 0xfe)
NAVY = (0x1b, 0x2a, 0x63)
BELLY_TOP = (0xe8, 0xf0, 0xff)
BELLY_BOT = (0xa8, 0xc8, 0xff)
FLAT_BODY = (0x4d, 0x6b, 0xfe)
FLAT_BELLY = (0xe6, 0xee, 0xff)
SILHOUETTE = (0x1c, 0x2c, 0x66)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def crop_alpha(rows, w, h, thresh=8):
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        r = rows[y]
        for x in range(w):
            if r[x * 4 + 3] > thresh:
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
    if x1 < 0:
        raise SystemExit('empty logo')
    return [r[x0 * 4:(x1 + 1) * 4] for r in rows[y0:y1 + 1]], x1 - x0 + 1, y1 - y0 + 1


def premult_downsample(rows, sw, sh, dw, dh):
    rgb, alp = [], []
    for dy in range(dh):
        y0 = int(dy * sh / dh)
        y1 = max(y0 + 1, int(math.ceil((dy + 1) * sh / dh)))
        rline = bytearray()
        aline = bytearray()
        for dx in range(dw):
            x0 = int(dx * sw / dw)
            x1 = max(x0 + 1, int(math.ceil((dx + 1) * sw / dw)))
            ar = ag = ab = aa = 0.0
            cnt = 0
            for yy in range(y0, min(y1, sh)):
                r = rows[yy]
                for xx in range(x0, min(x1, sw)):
                    i = xx * 4
                    a = r[i + 3] / 255.0
                    ar += r[i] * a; ag += r[i + 1] * a; ab += r[i + 2] * a; aa += a
                    cnt += 1
            if cnt == 0 or aa <= 0:
                rline += b'\x00\x00\x00'; aline += b'\x00'
            else:
                rline += bytes((min(255, int(round(ar / aa))), min(255, int(round(ag / aa))),
                                min(255, int(round(ab / aa)))))
                aline += bytes((min(255, int(round(aa / cnt * 255))),))
        rgb.append(bytes(rline))
        alp.append(bytes(aline))
    return rgb, alp


def classify(rgb, alp, w, h):
    """0=主体 1=大腹部 2=眼睛小白块 3=深色嘴线"""
    cls = bytearray(w * h)
    white = bytearray(w * h)
    for y in range(h):
        a = alp[y]
        r = rgb[y]
        base = y * w
        for x in range(w):
            if a[x] < 130:
                continue
            i = x * 3
            rr, gg, bb = r[i], r[i + 1], r[i + 2]
            if rr < 110 and gg < 110 and bb < 110:
                cls[base + x] = 3
            elif rr > 195 and gg > 195 and bb > 195:
                white[base + x] = 1
            else:
                cls[base + x] = 0

    seen = bytearray(w * h)
    comps = []
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if white[idx] and not seen[idx]:
                q = collections.deque([(x, y)])
                seen[idx] = 1
                pts = []
                touches = False
                while q:
                    cx, cy = q.popleft()
                    pts.append((cx, cy))
                    if cx == 0 or cy == 0 or cx == w - 1 or cy == h - 1:
                        touches = True
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h:
                            ni = ny * w + nx
                            if white[ni] and not seen[ni]:
                                seen[ni] = 1
                                q.append((nx, ny))
                comps.append((len(pts), touches, pts))
    comps.sort(key=lambda c: c[0], reverse=True)
    # 最大且不贴边的白块 = 腹部；其余白块 = 眼睛等细节
    belly_done = False
    for size, touches, pts in comps:
        if touches or size < 20:
            continue
        k = 2
        if not belly_done:
            k = 1
            belly_done = True
        for (cx, cy) in pts:
            cls[cy * w + cx] = k
    return cls


def fill_detail_with_body(cls, rgb, w, h):
    """把 class 2（眼睛等小白块）和 class 3（嘴线）用周围主体的颜色填充。

    用「同区域内最近的 class0 像素」做 BFS 反向扩散，避免出现异色斑块。
    """
    out = [bytearray(r) for r in rgb]
    # 收集 class0 像素为种子
    dist = {}
    q = collections.deque()
    for y in range(h):
        for x in range(w):
            if cls[y * w + x] == 0:
                dist[(x, y)] = 0
                q.append((x, y))
    targets = {(x, y) for y in range(h) for x in range(w)
               if cls[y * w + x] in (2, 3)}
    # 多源 BFS
    while q:
        cx, cy = q.popleft()
        d = dist[(cx, cy)]
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            if (nx, ny) in dist:
                continue
            if (nx, ny) not in targets and cls[ny * w + nx] != 0:
                continue
            dist[(nx, ny)] = d + 1
            q.append((nx, ny))
    for (x, y) in targets:
        if (x, y) in dist:
            c = rgb[y][x * 3:x * 3 + 3]
            out[y][x * 3:x * 3 + 3] = c
    return [bytes(r) for r in out]


def recolor(rgb, alp, cls, w, h, body_fn, belly_fn, detail_fn):
    out = []
    for y in range(h):
        s = rgb[y]
        line = bytearray()
        for x in range(w):
            k = cls[y * w + x]
            if k == 1:
                c = belly_fn(y / max(1, h - 1))
            elif k == 0:
                c = body_fn(y / max(1, h - 1))
            else:
                c = detail_fn
            line += bytes(c)
        out.append(bytes(line))
    return out


def box_blur_alpha(alp, w, h, radius=6, passes=3):
    cur = [bytearray(r) for r in alp]
    for _ in range(passes):
        nxt = [bytearray(r) for r in cur]
        for y in range(h):
            row = cur[y]; nrow = nxt[y]
            for x in range(w):
                s = 0; n = 0
                for k in range(-radius, radius + 1):
                    xx = x + k
                    if 0 <= xx < w:
                        s += row[xx]; n += 1
                nrow[x] = s // n
        nxt2 = [bytearray(r) for r in nxt]
        for y in range(h):
            for x in range(w):
                s = 0; n = 0
                for k in range(-radius, radius + 1):
                    yy = y + k
                    if 0 <= yy < h:
                        s += nxt[yy][x]; n += 1
                nxt2[y][x] = s // n
        cur = nxt2
    return [bytes(r) for r in cur]


def dilate_alpha(alp, w, h, r=3):
    """alpha 膨胀（取邻域最大值），用于做外发光时把光晕推到轮廓外"""
    cur = [bytearray(r_) for r_ in alp]
    for _ in range(r):
        nxt = [bytearray(r_) for r_ in cur]
        for y in range(h):
            for x in range(w):
                m = cur[y][x]
                for k in (-1, 0, 1):
                    yy = y + k
                    if 0 <= yy < h:
                        if cur[yy][x] > m: m = cur[yy][x]
                        xx = x + k
                        if 0 <= xx < w and cur[yy][xx] > m: m = cur[yy][xx]
                nxt[y][x] = m
        cur = nxt
    return [bytes(r_) for r_ in cur]
