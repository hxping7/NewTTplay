# 鲸鱼娘桌面宠物（NTTWhale）源码

这是 `AddIn/NTTWhale.exe` 的完整源码与编译资源。

| 文件 | 说明 |
|---|---|
| `whale.c` | 桌宠主程序（Win32 + GDI，18 种状态 + 气泡台词 + 见面记忆） |
| `music_brain.c` | **v16 音乐人格**：曲库索引、音频标签读取、喜好评分、歌曲记忆 |
| `whale.ini.example` | 配置模板（喜好清单/曲风偏好说明），复制为 `AddIn/whale.ini` |
| `whale.rc` | 资源脚本，把 18 组状态条带编成 RCDATA 1..18 |
| `whale.ico` | 托盘/桌面图标 |
| `frames/*.bmp` | 18 组状态横排条带（24bpp，128×128/帧），由 `jingyu-niang-assets/frames/` 转换而来 |
| `frames/_manifest.json` | 帧清单（每组帧数、帧率） |

## 编译

需要 **MinGW 32 位**（本机路径 `D:/mingw32`）：

```bash
cd AddIn/NTTWhale-src
D:/mingw32/bin/windres.exe --input-format=rc -O coff -i whale.rc -o whale_res.o
D:/mingw32/bin/gcc.exe -m32 -O1 -mwindows -o NTTWhale.dat whale.c music_brain.c whale_res.o -lgdi32 -luser32 -lshell32
mv NTTWhale.dat ../NTTWhale.exe
```

> **为什么要绕开直接 gcc**：直接链接 exe 会被国产杀软（火绒）误报查杀，
> 先输出 `.dat` 再改名可绕过编译期查杀。

## 帧资源从哪来

`frames/*.bmp` 是**编译产物**，由 `tools/imgtool/gen_pet_bmp.js` 从
`jingyu-niang-assets/frames/` 的透明底 PNG 生成：

```
统一包围盒(并集, 保留帧间相对位移)
  → 等比缩放(高度目标 110px)
  → 二值 alpha
  → 3×3 闭运算
  → plug_holes 补洞
  → 品红键控(#ff00ff 抠透明)
  → 24bpp BMP 横排条带
```

重新生成需要 Node.js 环境（`tools/imgtool/`，依赖 `sharp` + `gifencoder`）：

```bash
cd tools/imgtool && npm install
node gen_pet_bmp.js
```

体检脚本 `check_pet.js` 可验证帧完整性（洞数、品红渗色）。

## 交互语义

| 操作 | 状态 | 说明 |
|---|---|---|
| 单击 | `shy` | 捂脸害羞（比欢呼举碗更适合摸头反馈） |
| 双击 | `feed` | 张嘴等投喂（不是自己吃饭） |
| 拖拽 | `drag` | 惊讶悬空，尾巴摇摆 |
| 随机游走 | `walk` | 侧身帧，引擎水平镜像 |
| 待机 | `L00_idle` 四帧循环 | 呼吸起伏，让最长驻状态也"活"起来 |

## v15 智能交互

桌宠不再是纯随机 GIF，而是**会说话、记得你、听得懂歌**：

### 1. 气泡台词
独立分层窗（`WS_EX_TRANSPARENT` + 色键透明），鼠标穿透、不干扰拖动。
- 单击摸头 / 双击投喂 / 拖拽 / 右键菜单都有对应台词
- 台词随好感度变化：亲近时"最喜欢摸摸了~"，生疏时"哼，别碰我"
- 待机时偶尔冒一句"发呆中…""今天也要元气满满~"

### 2. 好感度与见面记忆（存 `AddIn/whale.ini`）

| 字段 | 含义 |
|---|---|
| `affinity` | 好感度 0–100；摸头 +3、双击投喂 +5、久别重逢 +2 |
| `last_day` | 上次见面日期序号；跨天问候、隔 14 天以上"好久不见" |

好感度还会影响随机行为：≥75 时更常主动问候，<25 时更常不开心。

### 3. v16 音乐人格（取代 v15 的关键词映射）

v15 用歌名关键词猜类型（`爱`→害羞、`DJ`→跳舞）——这是错的：
歌名不反映曲风，而且每首都反应 = 触发器，不是角色。

v16 让她成为**有喜好的挑剔听众**：

| 信号 | 来源 | 用途 |
|---|---|---|
| 歌手 / 歌名 | 歌词插件当日日志 `搜索 歌手：X 歌名：Y` | 完整、不滚动，实时切歌 |
| 曲风 Genre / BPM | 音频文件的 ID3v1/v2、FLAC Vorbis 标签 | **真实曲风，不猜歌名** |
| 完整文件路径 | `Music.library`（TTBL）按歌名定位，约 1 万首 | 读标签用 |
| 播放行为 | 记忆表的播放次数/被摸次数 | 新鲜度与关联记忆 |

**决策公式**：`喜好(歌手±45 / 曲风±20) × 心情 × 新鲜度(+15/-12) × 关联记忆(+20)`，

- 三级反应：**沉默**（大多数歌）/ **轻微**（只冒一句）/ **强烈**（切状态+气泡）
- 心情由好感度和时段决定：兴奋阈值低、低落阈值高
- 喜欢的歌手听第 4 遍会说"又来了，换首嘛~"；你在某歌时摸过她多次，
  下次她会说"这是…我们那首歌吧？"
- 每首歌的记忆存 `whale.ini` 的 `songN`，上限 200 首

配置喜好见 `whale.ini.example`。初始值由曲库统计推断（梁静茹 231 首、
光良 177、周杰伦 57；曲风 Rock/Blues/Funk 居多），可随时编辑。

> 为什么不用 TTPlayer 窗口标题：实测标题是无缝滚动 marquee，
> 同一首歌轮流显示不同片段，无法可靠还原完整歌名。

> 插件不运行时不影响桌宠，只是没有歌曲联动。
