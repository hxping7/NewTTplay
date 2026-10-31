# NewTTplay

千千静听（TTPlayer）播放器 —— 深度定制皮肤与配套桌宠工程。

![皮肤主窗口](jingyu-niang-assets/皮肤_实跑主窗.png)

## 这是什么

以原版 **千千静听 TTPlayer**（2012）为基础，做了一套 **DeepSeek 鲸鱼主题** 的全套换肤工程，
外加一个自制的鲸鱼娘桌面宠物（`NTTWhale.exe`）和一个本地歌词服务器插件。

| 组件 | 说明 |
|---|---|
| `TTPlayer.exe` | 播放器主程序（原版，未修改） |
| `Skin/DeepSeekWhale.skn` | **主皮肤包**，深蓝 + 鲸鱼主题，含主窗/歌词窗/均衡器/播放列表四个窗口的美术 |
| `Skin/DeepSeekWhale-var*.skn` | 播放列表右上角 logo 的四个配色变体（渐变蓝 / 扁平 / 辉光 / 剪影） |
| `AddIn/NTTWhale.exe` | 鲸鱼娘桌面宠物，18 种状态动画（待机/摇尾/游泳/K歌/睡觉/投喂…） |
| `AddIn/NTTWhale-src/` | 桌宠**完整源码**（`whale.c` + `whale.rc` + 18 组状态 BMP），可重新编译 |
| `AddIn/lyrics-server/` | 本地歌词服务器 + `ttp_lrcsh` 插件源码（Node.js + C） |
| `tools/skin/` | 皮肤位图构建工具（纯 Python，零依赖）：BMP/PNG 编解码、九宫格拉伸仿真、logo 变体、打包 |
| `tools/imgtool/` | 素材构建管线（Node.js + sharp）：抠图、帧条带生成、logo 矢量化 |
| `jingyu-niang-assets/` | 鲸鱼娘美术**成品素材包**：19 组动画循环的 PNG 帧序列 + GIF 预览 + 品牌 SVG |
| `jingyu-niang-assets/frames/` | 90 张透明底 PNG 帧（17 状态图 + 73 相位帧），桌宠 `NTTWhale.exe` 的源资源 |
| `jingyu-niang-assets/表情差分/` | 8 个 256×256 表情头像（开心/生气/委屈/惊讶/害羞/困倦/思考/傲娇）+ 总览表 |
| `jingyu-niang-assets/三视图/` | 正面 / 正侧面 / 正背面设定稿，三视图等高共基线 |
| `docs/` | 项目总体计划与交付说明 |

> 设计过程文件（`jingyu-niang-design_assets/`、`jingyu-niang-design.miora`）、
> 参考截图（`images/`）、归档备份（`_backup/` `_reference/`）**仅保留在本地，不入库**。

## 皮肤结构

`.skn` 本质是 **ZIP 包**，内含：

```
Skin.xml          # 窗口布局（position / resize_rect / 图片资源映射）
Lyric.xml         # 歌词窗配色
Playlist.xml      # 播放列表配色
Visual.xml        # 频谱分析配色
*.bmp             # 24bit 位图资源（主窗口 400x150、播放列表 313x200…）
```

### 九宫格拉伸规则（改皮肤必读）

播放列表位图只有 **313×200**，实际窗口是 **400×370**，
`Skin.xml` 里 `resize_rect="64, 52, 305, 188"` 定义了九宫格：

```
x < 64            固定
x 64..305        横向拉伸  →  系数 (400-64-8)/(305-64) = 1.361
x > 305          固定
y < 52           固定 1:1
y 52..188        纵向拉伸
```

**两个坑**：

1. 画在 `x 64..305` 的美术会被**横向拉宽 1.36 倍** —— 想保持圆形/正方比例，
   必须先按 `宽/1.361` 画进位图，引擎拉回来后才是对的。
2. `y > 54` 的区域会被列表底色 `Color_Bkgnd` **不透明覆盖**，
   画在那里的美术根本看不见。所以所有装饰必须收在 `y < 52` 的标题栏内。

主窗口（`player_window`）没有 resize_rect，是 **400×150 1:1**。

### 当前主题配色

| 用途 | 色值 |
|---|---|
| 频谱 高 / 中 / 低 | `#7ea6ff` / `#4d6bfe` / `#2b4bd8` |
| 背景 | `#0e1a4a` |
| 文字 / 高亮 | `#cfe0ff` / `#ffffff` |
| DeepSeek logo | `#4468FE`（官方 SVG） |

## 本地歌词服务器

`AddIn/lyrics-server/` 下是自研的本地歌词插件：

- `server.js` — Node.js 实现的本地 HTTP 服务（默认 `127.0.0.1:89`）
- `ttp_lrcsh_new.c` / `ttp_lrcsh_new.def` — 千千静听侧插件的 C 源码
- `开发进度-交接文档.md` / `逆向报告-千千静听本地歌词服务器.md` — 逆向分析笔记

启动：`AddIn/lyrics-server/启动歌词服务器.cmd`
部署：`AddIn/lyrics-server/部署-替换插件.cmd`

## 桌面宠物

`AddIn/NTTWhale-src/` 是桌宠的完整源码，MinGW 32 位可重新编译：

```bash
cd AddIn/NTTWhale-src
D:/mingw32/bin/windres.exe --input-format=rc -O coff -i whale.rc -o whale_res.o
D:/mingw32/bin/gcc.exe -m32 -O1 -mwindows -o NTTWhale.dat whale.c whale_res.o -lgdi32 -luser32 -lshell32
mv NTTWhale.dat ../NTTWhale.exe
```

先输出 `.dat` 再改名，是为了绕过国产杀软的编译期查杀。
帧 BMP 由 `tools/imgtool/gen_pet_bmp.js` 从 `jingyu-niang-assets/frames/` 的 PNG 转换而来。

交互：单击摸头 → 害羞；双击 → 被投喂；按住拖动 → 被拖拽（松手回待机）；
右键菜单可手动指定各状态；平时由随机行为表按权重轮换全部 18 个状态。

## 皮肤构建工具

`tools/skin/` 为纯 Python、零依赖：

- `skintool.py` — 24bit BMP 读写（`#ff00ff` 抠透明）
- `pngio.py` — PNG 编解码（zlib 手写 chunk）
- SVG → PNG：Chrome headless 渲染
  ```bash
  chrome.exe --headless=new --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 --window-size=W,H --screenshot=out.png page.html
  ```
  须带 `--default-background-color=00000000` 才能得到透明底。

## 致谢

- **千千静听 TTPlayer** — 原版播放器（迅雷 / 酷我）
- **DeepSeek** — 官方 logo 与品牌视觉
