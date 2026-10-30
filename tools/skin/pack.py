import zipfile, re, shutil, os, time

SRC = r'D:/TTPlayer/Skin/DeepSeekWhale.skn'
WORK = '.'

z = zipfile.ZipFile(SRC)
names = [i.filename for i in z.infolist()]
orig_date = {i.filename: i.date_time for i in z.infolist()}
z.close()

# --- patch Skin.xml: close button rect 11x11 -> 9x9 (native bitmap size)
xml = open('Skin.xml', encoding='utf-8').read()
old = '<exit position="388, 11, 399, 22" image="close.bmp"/>'
new = '<exit position="388, 11, 397, 20" image="close.bmp"/>'
if old in xml:
    xml = xml.replace(old, new)
    open('Skin.xml', 'w', encoding='utf-8', newline='').write(xml)
    print('Skin.xml patched')
else:
    assert new in xml, 'exit line not found'
    print('Skin.xml already patched')

# --- pack
out = 'DeepSeekWhale.new.skn'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zo:
    for n in names:
        zi = zipfile.ZipInfo(n, date_time=orig_date[n])
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o600 << 16
        zo.writestr(zi, open(os.path.join(WORK, n), 'rb').read())
print('packed', out, os.path.getsize(out))

# verify
vz = zipfile.ZipFile(out)
assert vz.testzip() is None
assert [i.filename for i in vz.infolist()] == names
print('verify ok, entries:', len(names))
