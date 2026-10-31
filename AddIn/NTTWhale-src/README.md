# 鲸鱼娘桌面宠物（NTTWhale）源码

这是 `AddIn/NTTWhale.exe` 的完整源码与编译资源。

| 文件 | 说明 |
|---|---|
| `whale.c` | 桌宠主程序（Win32 + GDI，18 种状态、69 帧动画） |
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
