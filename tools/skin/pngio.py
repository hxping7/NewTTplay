import struct, zlib


def load_rgba(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', path
    i = 8
    w = h = bd = ct = 0
    idat = b''
    plte = None
    trns = None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        t = d[i + 4:i + 8]
        data = d[i + 8:i + 8 + ln]
        i += 12 + ln
        if t == b'IHDR':
            w, h, bd, ct, comp, filt, il = struct.unpack('>IIBBBBB', data[:13])
            assert bd == 8 and il == 0, (path, bd, il)
        elif t == b'PLTE':
            plte = data
        elif t == b'tRNS':
            trns = data
        elif t == b'IDAT':
            idat += data
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * nch
    out = []
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if f == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x - nch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                b = prev[x]
                c = prev[x - nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(bytes(line))
        prev = line

    rows = []
    for y in range(h):
        line = out[y]
        r = bytearray()
        for x in range(w):
            if ct == 6:
                r += line[x * 4:x * 4 + 4]
            elif ct == 2:
                r += line[x * 3:x * 3 + 3] + b'\xff'
            elif ct == 0:
                v = line[x]
                r += bytes((v, v, v, 255))
            elif ct == 3:
                idx = line[x]
                r += plte[idx * 3:idx * 3 + 3] + bytes(((trns[idx] if trns and idx < len(trns) else 255),))
            elif ct == 4:
                v = line[x * 2]
                r += bytes((v, v, v, line[x * 2 + 1]))
        rows.append(bytes(r))
    return w, h, rows


def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def resize_bilinear(src_w, src_h, rows, dst_w, dst_h):
    """area-average downscale / bilinear upscale, RGBA premultiplied-free simple version."""
    out = []
    for dy in range(dst_h):
        sy = (dy + 0.5) * src_h / dst_h - 0.5
        y0 = max(0, min(src_h - 1, int(sy)))
        y1 = max(0, min(src_h - 1, y0 + 1))
        fy = sy - int(sy) if sy >= 0 else 0
        line = bytearray()
        for dx in range(dst_w):
            sx = (dx + 0.5) * src_w / dst_w - 0.5
            x0 = max(0, min(src_w - 1, int(sx)))
            x1 = max(0, min(src_w - 1, x0 + 1))
            fx = sx - int(sx) if sx >= 0 else 0
            acc = [0.0, 0.0, 0.0, 0.0]
            for (yy, wy) in ((y0, 1 - fy), (y1, fy)):
                r0 = rows[yy]
                for (xx, wx) in ((x0, 1 - fx), (x1, fx)):
                    w_ = wx * wy
                    if w_ == 0:
                        continue
                    p = r0[xx * 4:xx * 4 + 4]
                    acc[0] += p[0] * w_
                    acc[1] += p[1] * w_
                    acc[2] += p[2] * w_
                    acc[3] += p[3] * w_
            line += bytes((int(round(acc[0])), int(round(acc[1])), int(round(acc[2])), int(round(acc[3]))))
        out.append(bytes(line))
    return out
