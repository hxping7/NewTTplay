# 构建工具

本机 **没有 Pillow / ImageMagick / Inkscape / rsvg**，且 pip 无可用源，
所以皮肤与素材的构建工具都是自写的。

## `skin/` —— 皮肤位图工具（纯 Python，零依赖）

| 文件 | 作用 |
|---|---|
| `skintool.py` | 24bit BMP 读写（`#ff00ff` 抠透明） |
| `pngio.py` | PNG 编解码（zlib 手写 chunk） |
| `bmp2png.py` | BMP → PNG 批量转换 |
| `stretch_sim.py` | 模拟皮肤九宫格拉伸，用于出图前校验 |
| `pack.py` | 把皮肤目录按原 zip 条目顺序打包成 `.skn` |
| `grab.py` | 用 ctypes + GDI BitBlt 截取播放器窗口（`ShowWindow` 显示 → 截 → 还原） |
| `build_whale.py` | 绘制鲸鱼 logo（掩码 + 剪影 + 盒式降采样） |
| `svg_logo.py` / `svg_variants.py` / `make_variants.py` | SVG logo 的四个配色变体 |
| `build_lyric3.py` | 重建歌词窗背景（400×319，角色放在固定底条内不被拉伸） |
| `build_player2.py` | 重建主窗口左侧角色立绘 |

### SVG → PNG

```bash
chrome.exe --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --window-size=W,H --screenshot=out.png page.html
```

`--default-background-color=00000000` **必须带**，否则背景是白色不透���。
Chrome 会打印一条 gmail webapp 安装失败的 ERROR，无害。

## `imgtool/` —— 素材构建管线（Node.js）

依赖 `sharp` + `gifencoder`：

```bash
cd tools/imgtool && npm install
```

| 文件 | 作用 |
|---|---|
| `gen_pet_bmp.js` | 桌宠帧 PNG → 24bpp BMP 横排条带 |
| `check_pet.js` | 体检：帧数、洞数、品红渗色 |
| `build2.js` / `build3.js` | 抠图、对齐、帧表、GIF 输出 |
| `ds_logo_vectorize5.js` | 官方 logo 位图 → SVG 矢量化（洪水填充 + 轮廓追踪 + RDP 简化） |
| `ds_logo_extract.js` / `ds_logo_alpha.js` | logo 抠图与透明通道提取 |
| `skin_build.js` / `skinpipe.js` | 皮肤位图流水线 |
| `build_scrollbar.js` | 滚动条样式 |

## 截图脚本（Windows）

`tools/skin/grab.py` 用 ctypes 调 GDI 截播放器窗口：

```python
user32.ShowWindow(hwnd, 4)      # SW_SHOW
user32.UpdateWindow(hwnd)
gdi32.BitBlt(mem, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)   # SRCCOPY
```

- **隐藏窗口不能用 `PrintWindow`**（返回全黑），必须先 `ShowWindow` 再 BitBlt，截完再隐藏。
- 窗口句柄每次启动都会变，用 `grab.py <窗口类名> <输出> [show] <pid>` 现场枚举。
