import struct, zlib, sys, os

def bmp_to_rgba(path, key=(255, 0, 255)):
    d = open(path, 'rb').read()
    off = struct.unpack('<I', d[10:14])[0]
    w, h = struct.unpack('<ii', d[18:26])
    bpp = struct.unpack('<H', d[28:30])[0]
    assert bpp == 24, (path, bpp)
    flip = h > 0
    h = abs(h)
    stride = (w * 3 + 3) & ~3
    rows = []
    for y in range(h):
        sy = (h - 1 - y) if flip else y
        base = off + sy * stride
        row = d[base:base + w * 3]
        out = bytearray()
        for x in range(w):
            b, g, r = row[x * 3], row[x * 3 + 1], row[x * 3 + 2]
            a = 0 if (r, g, b) == key else 255
            out += bytes((r, g, b, a))
        rows.append(bytes(out))
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

if __name__ == '__main__':
    outdir = sys.argv[1] if len(sys.argv) > 1 else 'png'
    os.makedirs(outdir, exist_ok=True)
    for f in sys.argv[2:]:
        w, h, rows = bmp_to_rgba(f)
        out = os.path.join(outdir, os.path.splitext(os.path.basename(f))[0] + '.png')
        write_png(out, w, h, rows)
        print(out, w, h)
