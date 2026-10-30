"""把 DeepSeek 官方 SVG logo 贴进播放列表皮肤右上角（替换旧鱼）。

九宫格规则（Skin.xml playlist_window resize_rect="64, 52, 305, 188"）：
  位图 313x200 → 实际窗口 400x370
  x < 64 固定 | x 64..305 横向拉伸 | x > 305 固定
  y < 52 固定（1:1）| y 52..188 纵向拉伸
  → 横向拉伸系数 = (400-64-8)/(305-64) = 1.361
所以 logo 必须先横向压窄 1/1.361 画进位图，引擎拉回来后比例才正确。
"""
import math
import pngio
import skintool as S

SVG_PNG = 'png/logo_svg8.png'
SW, SH = 313, 200
STRETCH = (400 - 64 - 8) / (305 - 64)   # 1.3611


def load_logo(path=SVG_PNG):
    return pngio.load_rgba(path)


def crop_alpha(rows, w, h, thresh=8):
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        r = rows[y]
        for x in range(w):
            if r[x * 4 + 3] > thresh:
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
    if x1 < 0:
        return None
    return [r[x0 * 4:(x1 + 1) * 4] for r in rows[y0:y1 + 1]], x1 - x0 + 1, y1 - y0 + 1


def box_downsample(rows, sw, sh, dw, dh):
    """premultiplied-alpha 盒式降采样 -> RGBA 行列表"""
    out = []
    for dy in range(dh):
        y0 = int(dy * sh / dh)
        y1 = max(y0 + 1, int(math.ceil((dy + 1) * sh / dh)))
        line = bytearray()
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
                line += b'\x00\x00\x00\x00'
            else:
                line += bytes((min(255, int(round(ar / aa))), min(255, int(round(ag / aa))),
                               min(255, int(round(ab / aa))), min(255, int(round(aa / cnt * 255)))))
        out.append(bytes(line))
    return out


def make_logo(disp_h, tone=1.0):
    """生成贴到 313x200 位图用的 logo 图层（已预压横向）。

    disp_h = 屏显高度（位图 y<52 纵向 1:1，故等于位图高度）
    返回 (rgba_rows, bw, bh)
    """
    w, h, rows = load_logo()
    cropped, cw, ch = crop_alpha(rows, w, h)
    disp_w = disp_h * cw / ch
    bw = max(1, int(round(disp_w / STRETCH)))
    bh = disp_h
    return box_downsample(cropped, cw, ch, bw, bh), bw, bh


def erase_fish(px, x0=238, x1=303, y0=28, y1=60):
    """逐行用 x=150 的同排背景色回填旧鱼区域"""
    for y in range(y0, y1 + 1):
        ref = px[y][150]
        for x in range(x0, x1 + 1):
            px[y][x] = ref


def paste(px, rgba, bw, bh, left, top, tone=1.0):
    for y in range(bh):
        for x in range(bw):
            p = rgba[y][x * 4:x * 4 + 4]
            a = p[3] / 255.0 * tone
            if a <= 0.004:
                continue
            X, Y = left + x, top + y
            if not (0 <= X < SW and 0 <= Y < SH):
                continue
            dst = px[Y][X]
            px[Y][X] = (int(round(dst[0] * (1 - a) + p[0] * a)),
                        int(round(dst[1] * (1 - a) + p[1] * a)),
                        int(round(dst[2] * (1 - a) + p[2] * a)))
