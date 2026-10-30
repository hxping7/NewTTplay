"""生成 DeepSeek 鲸鱼 logo 的 4 个皮肤化变体"""
import math
import pngio
import svg_variants as V


def to_rgba_rows(rgb, alp, w, h):
    out = []
    for y in range(h):
        line = bytearray()
        r = rgb[y]
        a = alp[y]
        for x in range(w):
            line += bytes((r[x * 3], r[x * 3 + 1], r[x * 3 + 2], a[x]))
        out.append(bytes(line))
    return out


def build(style, rgb, alp, cls, w, h):
    if style == 'A':      # 渐变蓝 + 淡蓝腹
        body = lambda t: V.lerp(V.SKY_TOP, V.SKY_BOT, t)
        belly = lambda t: V.lerp(V.BELLY_TOP, V.BELLY_BOT, t)
        detail = (0x2a, 0x3f, 0x8c)
        glow = 0
    elif style == 'B':    # 扁平纯色（官方但去纯黑线）
        body = lambda t: V.FLAT_BODY
        belly = lambda t: V.FLAT_BELLY
        detail = (0x2a, 0x3f, 0x8c)
        glow = 0
    elif style == 'C':    # 渐变蓝 + 柔和外发光
        body = lambda t: V.lerp(V.SKY_TOP, V.SKY_BOT, t)
        belly = lambda t: V.lerp(V.BELLY_TOP, V.BELLY_BOT, t)
        detail = (0x2a, 0x3f, 0x8c)
        glow = 9
    else:                 # D 低调剪影
        body = lambda t: V.SILHOUETTE
        belly = lambda t: V.lerp(V.SILHOUETTE, V.BELLY_BOT, 0.30)
        detail = (0x0d, 0x14, 0x36)
        glow = 0

    # 眼睛/嘴线用周围主体色填掉
    filled = V.fill_detail_with_body(cls, rgb, w, h)

    # 上色：先按 class 给主体和腹部上色，再把细节区还原为 filled 的主体色
    out = []
    for y in range(h):
        s = filled[y]
        line = bytearray()
        for x in range(w):
            k = cls[y * w + x]
            if k == 1:
                c = belly(y / max(1, h - 1))
            elif k == 0:
                c = body(y / max(1, h - 1))
            else:
                c = detail
            line += bytes(c)
        out.append(bytes(line))

    if glow:
        # 外发光：alpha 先膨胀再模糊，形成向外扩散的柔光
        dil = V.dilate_alpha(alp, w, h, r=4)
        soft = V.box_blur_alpha(dil, w, h, radius=glow, passes=4)
        # 压低强度，避免变成白边
        soft = [bytes(min(255, int(v * 0.55)) for v in row) for row in soft]
        final_rgb = []
        final_alp = []
        for y in range(h):
            line = bytearray()
            ar = bytearray()
            for x in range(w):
                a = alp[y][x] / 255.0
                g = soft[y][x] / 255.0
                c = out[y][x * 3:x * 3 + 3]
                gc = V.GLOW
                ga = g * (1 - a)
                tot = a + ga
                if tot <= 1e-6:
                    line += b'\x00\x00\x00'
                else:
                    r = int(round((c[0] * a + gc[0] * ga) / tot))
                    gg = int(round((c[1] * a + gc[1] * ga) / tot))
                    b = int(round((c[2] * a + gc[2] * ga) / tot))
                    line += bytes((min(255, r), min(255, gg), min(255, b)))
                ar.append(min(255, int(round(max(a, g) * 255))))
            final_rgb.append(bytes(line))
            final_alp.append(bytes(ar))
        out = final_rgb
        alp = final_alp

    return out, alp


if __name__ == '__main__':
    w0, h0, rows0 = pngio.load_rgba(V.SVG_4X)
    cropped, cw, ch = V.crop_alpha(rows0, w0, h0)
    rgb, alp = V.premult_downsample(cropped, cw, ch, V.WORK_W, V.WORK_H)
    cls = V.classify(rgb, alp, V.WORK_W, V.WORK_H)
    from collections import Counter
    print('classes', Counter(cls))

    for style in ('A', 'B', 'C', 'D'):
        r, a = build(style, rgb, alp, cls, V.WORK_W, V.WORK_H)
        rgba = to_rgba_rows(r, a, V.WORK_W, V.WORK_H)
        pngio.write_png('png/var_%s.png' % style, V.WORK_W, V.WORK_H, rgba)
        print('variant', style, 'ok')
