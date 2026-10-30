import struct

KEY = (255, 0, 255)


def load_bmp(path):
    d = open(path, 'rb').read()
    off = struct.unpack('<I', d[10:14])[0]
    w, h = struct.unpack('<ii', d[18:26])
    bpp = struct.unpack('<H', d[28:30])[0]
    assert bpp == 24, (path, bpp)
    flip = h > 0
    h = abs(h)
    stride = (w * 3 + 3) & ~3
    px = [[(0, 0, 0)] * w for _ in range(h)]
    for y in range(h):
        sy = (h - 1 - y) if flip else y
        base = off + sy * stride
        row = px[y]
        for x in range(w):
            b, g, r = d[base + x * 3], d[base + x * 3 + 1], d[base + x * 3 + 2]
            row[x] = (r, g, b)
    return w, h, px


def save_bmp(path, w, h, px):
    stride = (w * 3 + 3) & ~3
    pad = stride - w * 3
    data = bytearray()
    for y in range(h - 1, -1, -1):
        row = px[y]
        for x in range(w):
            r, g, b = row[x]
            data += bytes((b, g, r))
        data += b'\x00' * pad
    size = 54 + len(data)
    hdr = b'BM' + struct.pack('<IHHI', size, 0, 0, 54)
    info = struct.pack('<IiiHHIIiiII', 40, w, h, 1, 24, 0, len(data), 2835, 2835, 0, 0)
    open(path, 'wb').write(hdr + info + bytes(data))


def lerp(c0, c1, t):
    return tuple(int(round(c0[i] + (c1[i] - c0[i]) * t)) for i in range(3))


def rounded_rect_mask(w, h, x0, y0, x1, y1, r):
    """1 inside an anti-alias-free rounded rect (inclusive coords)."""
    m = [[0] * w for _ in range(h)]
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            cx = min(max(x, x0 + r), x1 - r)
            cy = min(max(y, y0 + r), y1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r:
                m[y][x] = 1
    return m
