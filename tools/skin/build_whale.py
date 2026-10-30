import pngio, collections, sys

SRC = 'C:/Users/Administrator/.workbuddy-ai/clipboard-images/clipboard-2026-10-28T16-18-39-782Z-63ac5e40.png'
BX0, BY0, BX1, BY1 = 132, 226, 852, 772   # body bbox in source

sw, sh, srows = pngio.load_rgba(SRC)
cw, ch = BX1 - BX0 + 1, BY1 - BY0 + 1

body = [[0] * cw for _ in range(ch)]
for y in range(ch):
    r = srows[BY0 + y]
    line = body[y]
    for x in range(cw):
        i = (BX0 + x) * 4
        rr, gg, bb = r[i], r[i + 1], r[i + 2]
        if bb - rr > 40 and bb > 120:
            line[x] = 1

out = [[0] * cw for _ in range(ch)]
q = collections.deque()
for x in range(cw):
    for y in (0, ch - 1):
        if not body[y][x] and not out[y][x]:
            out[y][x] = 1; q.append((x, y))
for y in range(ch):
    for x in (0, cw - 1):
        if not body[y][x] and not out[y][x]:
            out[y][x] = 1; q.append((x, y))
while q:
    cx, cy = q.popleft()
    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
        if 0 <= nx < cw and 0 <= ny < ch and not body[ny][nx] and not out[ny][nx]:
            out[ny][nx] = 1; q.append((nx, ny))
sil = [[0 if out[y][x] else 1 for x in range(cw)] for y in range(ch)]

BODY_COL = (77, 107, 254)
DETAIL_COL = (226, 238, 255)


def resample(dw, dh):
    cov_b, cov_s = [], []
    for dy in range(dh):
        y0 = int(dy * ch / dh)
        y1 = max(y0 + 1, int(-(-(dy + 1) * ch // dh)))
        rb, rs = [], []
        for dx in range(dw):
            x0 = int(dx * cw / dw)
            x1 = max(x0 + 1, int(-(-(dx + 1) * cw // dw)))
            nb = ns = cnt = 0
            for yy in range(y0, min(y1, ch)):
                brow, srow = body[yy], sil[yy]
                for xx in range(x0, min(x1, cw)):
                    nb += brow[xx]; ns += srow[xx]; cnt += 1
            rb.append(nb / cnt if cnt else 0.0)
            rs.append(ns / cnt if cnt else 0.0)
        cov_b.append(rb); cov_s.append(rs)
    return cov_b, cov_s


def erase_fish(px, w, h, x0=213, y0=25, x1=300, y1=62):
    for y in range(y0, y1 + 1):
        ref = px[y][150]
        for x in range(x0, x1 + 1):
            px[y][x] = ref


def draw_whale(px, left, top, dw, dh, strength=1.0):
    cov_b, cov_s = resample(dw, dh)
    for y in range(dh):
        for x in range(dw):
            a = cov_s[y][x]
            if a <= 0.004:
                continue
            cb = cov_b[y][x]
            cwd = max(0.0, a - cb)
            r = (BODY_COL[0] * cb + DETAIL_COL[0] * cwd) / a
            g = (BODY_COL[1] * cb + DETAIL_COL[1] * cwd) / a
            b = (BODY_COL[2] * cb + DETAIL_COL[2] * cwd) / a
            aa = a * strength
            dst = px[top + y][left + x]
            px[top + y][left + x] = (
                int(round(dst[0] * (1 - aa) + r * aa)),
                int(round(dst[1] * (1 - aa) + g * aa)),
                int(round(dst[2] * (1 - aa) + b * aa)))


if __name__ == '__main__':
    import skintool as S
    w, h, px = S.load_bmp('playlist_skin.bmp')
    for dw, dh in [(37, 28), (45, 34), (30, 23)]:
        prev = [[px[y][x] for x in range(w)] for y in range(h)]
        erase_fish(prev, w, h)
        left, top = 289 - dw, 52 - dh
        draw_whale(prev, left, top, dw, dh)
        S.save_bmp('prev_%dx%d.bmp' % (dw, dh), w, h, prev)
        print('preview', dw, dh, 'at', left, top)
