import skintool as S, sys

SW, SH = 313, 200
WW, WH = 400, 370
RX0, RY0, RX1, RY1 = 64, 52, 305, 188


def maps():
    xm = []
    for X in range(WW):
        if X < RX0:
            xm.append(X)
        elif X < RX0 + (WW - (SW - RX1) - RX0):
            xm.append(RX0 + (X - RX0) * (RX1 - RX0) / (WW - (SW - RX1) - RX0))
        else:
            xm.append(X - (WW - SW))
    ym = []
    for Y in range(WH):
        if Y < RY0:
            ym.append(Y)
        elif Y < RY0 + (WH - (SH - RY1) - RY0):
            ym.append(RY0 + (Y - RY0) * (RY1 - RY0) / (WH - (SH - RY1) - RY0))
        else:
            ym.append(Y - (WH - SH))
    return xm, ym


def bilinear(px, fx, fy, w, h):
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)
    tx, ty = fx - x0, fy - y0
    out = []
    for i in range(3):
        c = (px[y0][x0][i] * (1 - tx) * (1 - ty) + px[y0][x1][i] * tx * (1 - ty)
             + px[y1][x0][i] * (1 - tx) * ty + px[y1][x1][i] * tx * ty)
        out.append(int(round(c)))
    return tuple(out)


if __name__ == '__main__':
    src = sys.argv[1]
    out = sys.argv[2]
    w, h, px = S.load_bmp(src)
    assert (w, h) == (SW, SH)
    xm, ym = maps()
    rows = [[(0, 0, 0)] * WW for _ in range(WH)]
    for Y in range(WH):
        fy = min(ym[Y], SH - 1)
        for X in range(WW):
            fx = min(xm[X], SW - 1)
            rows[Y][X] = bilinear(px, fx, fy, SW, SH)
    S.save_bmp(out, WW, WH, rows)
    print('saved', out)
