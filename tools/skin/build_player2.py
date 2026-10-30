import skintool as S
import pngio
import collections

W, H = 400, 150
w, h, px = S.load_bmp('player_skin.orig.bmp')
assert (w, h) == (W, H)

# per-row background: median of the panel columns that are never covered by art,
# skipping transparent pixels (rounded corners) so we never paint the key colour.
bg = []
for y in range(H):
    vals = []
    for x in list(range(78, 92)) + list(range(4, 12)):
        c = px[y][x]
        if c != S.KEY:
            vals.append(c)
    if not vals:
        vals = [px[y][x] for x in range(W) if px[y][x] != S.KEY]
    vals.sort(key=lambda c: c[0] + c[1] + c[2])
    bg.append(vals[len(vals) // 2])

PANEL_X1 = 95
mask = [[0] * W for _ in range(H)]
for y in range(H):
    ref = bg[y]
    for x in range(0, PANEL_X1 + 1):
        p = px[y][x]
        if p == S.KEY:
            continue
        if abs(p[0] - ref[0]) + abs(p[1] - ref[1]) + abs(p[2] - ref[2]) > 5:
            mask[y][x] = 1

# drop the tiny stars so they stay
seen = [[0] * W for _ in range(H)]
for y in range(H):
    for x in range(0, PANEL_X1 + 1):
        if mask[y][x] and not seen[y][x]:
            q = collections.deque([(x, y)])
            seen[y][x] = 1
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx <= PANEL_X1 and 0 <= ny < H and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = 1
                        q.append((nx, ny))
            if len(pts) < 40:
                for (cx, cy) in pts:
                    mask[cy][cx] = 0

for y in range(H):
    for x in range(0, PANEL_X1 + 1):
        if mask[y][x]:
            px[y][x] = bg[y]

# ---------------- new character ----------------
SRC = 'D:/TTPlayer/jingyu-niang-assets/frames/L11_happy_0.png'
cw, ch, rows = pngio.load_rgba(SRC)

# keep only the body, drop detached sparkles / hearts
al = [[1 if rows[y][x * 4 + 3] > 8 else 0 for x in range(cw)] for y in range(ch)]
snn = [[0] * cw for _ in range(ch)]
keepm = [[1] * cw for _ in range(ch)]
for _y in range(ch):
    for _x in range(cw):
        if al[_y][_x] and not snn[_y][_x]:
            qq = collections.deque([(_x, _y)])
            snn[_y][_x] = 1
            _pts = []
            while qq:
                _cx, _cy = qq.popleft()
                _pts.append((_cx, _cy))
                for _nx, _ny in ((_cx + 1, _cy), (_cx - 1, _cy), (_cx, _cy + 1), (_cx, _cy - 1)):
                    if 0 <= _nx < cw and 0 <= _ny < ch and al[_ny][_nx] and not snn[_ny][_nx]:
                        snn[_ny][_nx] = 1
                        qq.append((_nx, _ny))
            if len(_pts) < 100000:
                for _cx, _cy in _pts:
                    keepm[_cy][_cx] = 0
rows2 = []
for _y in range(ch):
    _r = bytearray(rows[_y])
    for _x in range(cw):
        if not keepm[_y][_x]:
            _r[_x * 4 + 3] = 0
    rows2.append(bytes(_r))
rows = rows2

x0, y0, x1, y1 = cw, ch, -1, -1
for y in range(ch):
    r = rows[y]
    for x in range(cw):
        if r[x * 4 + 3] > 8:
            x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
crop = [r[x0 * 4:(x1 + 1) * 4] for r in rows[y0:y1 + 1]]
bw, bh = x1 - x0 + 1, y1 - y0 + 1


def box_resize(rows, sw, sh, dw, dh):
    out = []
    for dy in range(dh):
        sy0 = int(dy * sh / dh)
        sy1 = max(sy0 + 1, int(round((dy + 1) * sh / dh)))
        line = bytearray()
        for dx in range(dw):
            sx0 = int(dx * sw / dw)
            sx1 = max(sx0 + 1, int(round((dx + 1) * sw / dw)))
            ar = ag = ab = aa = 0.0
            cnt = 0
            for yy in range(sy0, min(sy1, sh)):
                r = rows[yy]
                for xx in range(sx0, min(sx1, sw)):
                    p = r[xx * 4:xx * 4 + 4]
                    a = p[3] / 255.0
                    ar += p[0] * a; ag += p[1] * a; ab += p[2] * a; aa += a
                    cnt += 1
            if cnt == 0 or aa == 0:
                line += b'\x00\x00\x00\x00'
            else:
                line += bytes((min(255, int(round(ar / aa))), min(255, int(round(ag / aa))),
                               min(255, int(round(ab / aa))), min(255, int(round(aa / cnt * 255)))))
        out.append(bytes(line))
    return out


TARGET_H = 128
tw = int(round(bw * TARGET_H / bh))
th = TARGET_H
big = box_resize(crop, bw, bh, tw, th)
print('scaled', tw, th)

# horizontal crop window centred on the head band (top 5%-30%)
hx = []
for y in range(int(th * 0.04), int(th * 0.24)):
    for x in range(tw):
        if big[y][x * 4 + 3] > 60:
            hx.append(x)
head_cx = (min(hx) + max(hx)) / 2
print('head centre', round(head_cx, 1), 'head span', min(hx), max(hx))

CROP_W = PANEL_X1 + 1
left = int(round(head_cx - CROP_W / 2))
left = max(0, min(tw - CROP_W, left))
TOP = H - th
print('crop left', left, 'top', TOP)

for y in range(th):
    for x in range(CROP_W):
        sxx = left + x
        if sxx >= tw:
            continue
        p = big[y][sxx * 4:sxx * 4 + 4]
        a = p[3] / 255.0
        if a <= 0.004:
            continue
        X, Y = x, TOP + y
        if Y > 146:
            continue
        if X < 8:
            a *= (X + 1) / 8.0
            if a <= 0.004:
                continue
        dst = px[Y][X]
        if dst == S.KEY:
            continue
        px[Y][X] = (int(round(dst[0] * (1 - a) + p[0] * a)),
                    int(round(dst[1] * (1 - a) + p[1] * a)),
                    int(round(dst[2] * (1 - a) + p[2] * a)))

S.save_bmp('player_skin.bmp', W, H, px)
print('saved')
