import ctypes, sys, struct, zlib, time
from ctypes import wintypes

user32 = ctypes.WinDLL('user32', use_last_error=True)
gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)

class RECT(ctypes.Structure):
    _fields_ = [('left', wintypes.LONG), ('top', wintypes.LONG),
                ('right', wintypes.LONG), ('bottom', wintypes.LONG)]

class BIH(ctypes.Structure):
    _fields_ = [('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG),
                ('biHeight', wintypes.LONG), ('biPlanes', wintypes.WORD),
                ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG),
                ('biYPelsPerMeter', wintypes.LONG), ('biClrUsed', wintypes.DWORD),
                ('biClrImportant', wintypes.DWORD)]


def find(cls_name, pid):
    res = []
    CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, l):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value == pid:
            c = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(h, c, 256)
            if c.value == cls_name:
                res.append(h)
        return True
    user32.EnumWindows(CB(cb), 0)
    return res


def grab(hwnd, out):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    gdi32.BitBlt(mem, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)
    bi = BIH(); bi.biSize = ctypes.sizeof(BIH); bi.biWidth = w
    bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    rows = []
    for y in range(h):
        s = buf.raw[y * w * 4:(y + 1) * w * 4]
        line = bytearray()
        for x in range(w):
            line += bytes((s[x * 4 + 2], s[x * 4 + 1], s[x * 4], 255))
        rows.append(bytes(line))
    raw = b''.join(b'\x00' + rr for rr in rows)
    def ch(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b'')
    open(out, 'wb').write(png)
    gdi32.DeleteObject(bmp); gdi32.DeleteDC(mem); user32.ReleaseDC(hwnd, hdc)
    print('saved', out, w, h)


if __name__ == '__main__':
    cls = sys.argv[1]
    out = sys.argv[2]
    show = len(sys.argv) > 3 and sys.argv[3] == 'show'
    pid = int(sys.argv[4]) if len(sys.argv) > 4 else 17516
    hs = find(cls, pid)
    print('found', hs)
    for h in hs:
        was = user32.IsWindowVisible(h)
        if show:
            user32.ShowWindow(h, 4)
            user32.UpdateWindow(h)
            time.sleep(0.5)
        grab(h, out)
        if show and not was:
            user32.ShowWindow(h, 0)
