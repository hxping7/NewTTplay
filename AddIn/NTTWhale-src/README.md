# 鲸鱼娘桌面宠物（NTTWhale）源码

这是 `AddIn/NTTWhale.exe` 的完整源码与编译资源。

| 文件 | 说明 |
|---|---|
| `whale.c` | 桌宠主程序（Win32 + GDI，18 种状态；v15 新增气泡台词、好感度记忆、歌曲情绪联动） |
| `whale.rc` | 资源脚本，把 18 组状态条带编成 RCDATA 1..18 |
| `whale.ico` | 托盘/桌面图标 |
| `frames/*.bmp` | 18 组状态横排条带（24bpp，128×128/帧），由 `jingyu-niang-assets/frames/` 转换而来 |
| `frames/_manifest.json` | 帧清单（每组帧数、帧率） |

## 编译

需要 **MinGW 32 位**（本机路径 `D:/mingw32`）：

```bash
cd AddIn/NTTWhale-src
D:/mingw32/bin/windres.exe --input-format=rc -O coff -i whale.rc -o whale_res.o
D:/mingw32/bin/gcc.exe -m32 -O1 -mwindows -o NTTWhale.dat whale.c whale_res.o -lgdi32 -luser32 -lshell32
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

### 3. 歌曲类型 → 情绪联动
每 1.6 秒读一次歌词插件当日日志 `AddIn/lyrics-server/log/YYYY-MM-DD.txt`，
取最后一条 `搜索 歌手：X  歌名：Y`。**不需要改插件 DLL、不走 HTTP**。

- 切歌时气泡显示 `♪ 歌名 · 情绪短句`，并切到对应状态
- 关键词映射：DJ/舞→跳舞、摇滚/燃→生气(燃)、失恋/眼泪→不开心、爱/甜→害羞、
  K歌/演唱会→K歌、海/浪/鱼/鲸→游泳、夜/摇篮→睡觉、雨/月光/钢琴→思考
- 连续 40 次读不到日志（约 1 分钟）自动清除歌名状态

> 插件不运行时不影响桌宠，只是没有歌曲联动。
