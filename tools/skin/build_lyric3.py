import skintool as S
import pngio

W, H = 400, 319
w0, h0, old = S.load_bmp('lyric_skin.orig.bmp')
assert (w0, h0) == (400, 200)

PANEL = (14, 26, 74)        # #0e1a4a  == Lyric.xml BkgndColor
GLOW = (23, 42, 106)        # #172a6a  bottom glow
FLAT_END = 194              # lyric fill rect bottom
GLOW_END = 313

new = [[S.KEY] * W for _ in range(H)]
for y in range(0, 32):
    new[y] = list(old[y])

for y in range(32, 314):
    row = new[y]
    for x in range(0, 8):
        row[x] = old[100][x]
    for x in range(392, 400):
        row[x] = old[100][x]
    if y <= FLAT_END:
        c = PANEL
    else:
        t = (y - FLAT_END) / (GLOW_END - FLAT_END)
        t = t * t * (3 - 2 * t)          # smoothstep
        c = S.lerp(PANEL, GLOW, t)
    for x in range(8, 392):
        row[x] = c

for k in range(0, 5):
    y = 318 - k
    if k == 4:
        new[y] = list(old[4])
    else:
        row = new[y]
        for x in range(0, 13):
            row[x] = old[k][x]
        for x in range(387, 400):
            row[x] = old[k][x]
        for x in range(13, 387):
            row[x] = PANEL


def box_resize(rows, sw, sh, dw, dh):
    out = []
    for dy in range(dh):
        y0 = int(dy * sh / dh)
        y1 = max(y0 + 1, int(round((dy + 1) * sh / dh)))
        line = bytearray()
        for dx in range(dw):
            x0 = int(dx * sw / dw)
            x1 = max(x0 + 1, int(round((dx + 1) * sw / dw)))
            ar = ag = ab = aa = 0.0
            n = 0
            for yy in range(y0, min(y1, sh)):
                r = rows[yy]
                for xx in range(x0, min(x1, sw)):
                    p = r[xx * 4:xx * 4 + 4]
                    a = p[3] / 255.0
                    ar += p[0] * a
                    ag += p[1] * a
                    ab += p[2] * a
                    aa += a
                    n += 1
            if n == 0 or aa == 0:
                line += b'\x00\x00\x00\x00'
            else:
                line += bytes((min(255, int(round(ar / aa))), min(255, int(round(ag / aa))),
                               min(255, int(round(ab / aa))), min(255, int(round(aa / n * 255)))))
        out.append(bytes(line))
    return out


cw, ch, crows = pngio.load_rgba('D:/TTPlayer/jingyu-niang-assets/frames/L10_music_0.png')
x0, y0, x1, y1 = cw, ch, -1, -1
for y in range(ch):
    r = crows[y]
    for x in range(cw):
        if r[x * 4 + 3] > 8:
            x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
crop = [r[x0 * 4:(x1 + 1) * 4] for r in crows[y0:y1 + 1]]
bw, bh = x1 - x0 + 1, y1 - y0 + 1

TARGET_H = 142
tw = int(round(bw * TARGET_H / bh))
th = TARGET_H
small = box_resize(crop, bw, bh, tw, th)
print('char', tw, th)

OPACITY = 0.74
FX, FY = 24, 24
px_right, py_bottom = 391, 312
ox, oy = px_right - tw, py_bottom - th
print('at', ox, oy, 'right', ox + tw)

for y in range(th):
    fy = min(1.0, (y + 1) / FY)
    for x in range(tw):
        p = small[y][x * 4:x * 4 + 4]
        a = p[3] / 255.0
        if a <= 0:
            continue
        fx = min(1.0, (x + 1) / FX)
        alpha = a * OPACITY * fx * fy
        if alpha <= 0.004:
            continue
        X, Y = ox + x, oy + y
        if not (0 <= X < W and 0 <= Y < H):
            continue
        dst = new[Y][X]
        if dst == S.KEY:
            continue
        new[Y][X] = (int(round(dst[0] * (1 - alpha) + p[0] * alpha)),
                     int(round(dst[1] * (1 - alpha) + p[1] * alpha)),
                     int(round(dst[2] * (1 - alpha) + p[2] * alpha)))

S.save_bmp('lyric_skin.bmp', W, H, new)
print('saved')
