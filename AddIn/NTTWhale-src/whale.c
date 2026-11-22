/* NTTWhale - DeepSeek 胖鲸鱼娘桌面宠物 v14 (Win32, 单文件, 精灵内嵌资源)
 * 窗口: 128x128 分层色键(品红)置顶工具窗
 * 状态机: 0待机(呼吸) 1走路 2被投喂 3自己吃饭 4睡觉 5开心 6不开心 7工作忙
 *         8听音乐 9K歌 10生气 11游泳 12问候 13被拖拽 14害羞 15思考 16傲娇
 *         17摇尾巴跳舞
 * 交互: 左键拖动 / 单击摸一摸→害羞 / 双击喂饭→张嘴等投喂 / 右键菜单(含场景子菜单);
 *       托盘图标常驻; 位置记忆 whale.ini
 * 联动: 随 TTPlayer 启停 —— 检测主程序进程, TTPlayer 退出则桌宠自动退出,
 *       TTPlayer 启动则桌宠自动唤醒(托盘常驻模式)
 * v13 性能版(2026-10-30): 跟随检测 2s→15s(原 2s 全进程快照是常驻内核负载,
 *       宿主侧歌词插件也改用本进程的 NTTWhalePet 互斥体判活, 与进程名快照等价);
 *       follow_tt 关闭时不再轮询。
 * v14 动作平滑版(2026-10-31): 新增帧序列播放(seq, 支持任意顺序/ping-pong 循环) ——
 *       walk 补成 7 帧 12 相位完整步循环(L05_walk_4..6 为区域镜像合成的反相摆帧,
 *       生成脚本 tools/imgtool/make_walk_mirror.js); 消除 3→0 端碗瞬移回跳;
 *       drag 改 0,1,2,1 四槽左右摆 + 220ms/帧(原 110ms 三帧直循环像抽搐);
 *       右键菜单补「自己吃饭」入口(原 IDM_EATSELF 有处理器无菜单项, eat 状态为死代码)。
 * 资源: 1..18 RCDATA = idle/walk/feed/eat/sleep/happy/sad/work/music/ktv/angry/swim/greet/drag/shy/think/proud/dance.bmp
 *       横排条带, 单帧 128x128, 品红键控
 * 编译(绕过火绒编译查杀): gcc -o NTTWhale.dat ... && ren NTTWhale.dat NTTWhale.exe
 * v15 智能交互版(2026-11-22): 气泡台词窗 + 好感度记忆 + 歌曲类型情绪联动。
 *       气泡是独立 WS_EX_TRANSPARENT 分层窗, 不影响本体拖动/帧逻辑;
 *       歌名来自歌词插件的当日日志(搜索 歌手/歌名 行), 不依赖 HTTP 与插件改动。
 */
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <stdlib.h>
#include <stdio.h>
#include <wchar.h>

#define FRM 128
#define NST 18
#define BUB_W 320                   /* 气泡窗宽 */
#define BUB_H 62                    /* 气泡窗高(含下方尖角) */
#define WM_TRAY (WM_USER + 200)
#define WM_SETSTATE (WM_APP + 1)   /* 外部可发此消息按状态号切换动画: wParam=状态号(0..17), lParam=驻留帧数 */
#define ID_TRAY 7
#define IDM_FEED   3001
#define IDM_SLEEP  3002
#define IDM_PLAY   3003
#define IDM_TOP    3004
#define IDM_EXIT   3005
#define IDM_SAD    3006
#define IDM_WORK   3007
#define IDM_MUSIC  3008
#define IDM_KTV    3009
#define IDM_ANGRY  3010
#define IDM_SWIM   3011
#define IDM_GREET  3012
#define IDM_SHY    3013
#define IDM_THINK  3014
#define IDM_PROUD  3015
#define IDM_EATSELF 3016
#define IDM_HIDE   3017   /* 隐藏桌宠本体(托盘常驻) */
#define IDM_SHOWHIDE 3018 /* 显示/隐藏桌宠本体 */
#define IDM_FOLLOW 3019   /* 随 TTPlayer 启停联动 */
#define IDM_DANCE  3020   /* 摇尾巴跳舞 */

typedef struct {
    HBITMAP bmp[2];       /* [0]原始 [1]水平镜像 */
    HDC mdc[2];
    int frames;
    int ticks;            /* 每帧占几个 tick(110ms), 越大越慢 */
    int nseq;             /* 播放序列长度(<=12), 默认=frames 即顺序循环 */
    unsigned char seq[12];/* 播放序列: 存条带帧号, ping-pong 等非顺序循环用 */
} Sheet;

static Sheet g_sh[NST];  /* 0..17 见文件头 */
static HWND g_wnd;
static int g_state = 0;
static int g_frame, g_frames;
static int g_tick, g_stateLeft;      /* 帧计数/剩余帧数 */
static int g_acc;                    /* 当前状态已累计的 tick 数 */
static int g_dir = 1;                /* 走路朝向 1右 -1左 */
static int g_topmost = 1;
static int g_drag;                  /* 手动拖动中 */
static int g_dragMoved;             /* 本次按下是否发生过移动 */
static int g_bodyHidden;            /* 桌宠本体已隐藏(仅托盘) */
static int g_followTT;              /* 1=随 TTPlayer 启停联动 */
static int g_ttSeen;                /* 检测到 TTPlayer 在运行 */
static POINT g_dragPt, g_dragOff;   /* 按下光标位 / 按下点-窗口原点偏移 */
static NOTIFYICONDATAW g_nid;

/* ---- v15 智能交互 ---- */
static HWND g_bub;                  /* 气泡窗(透明+鼠标穿透) */
static HFONT g_bubFont;
static wchar_t g_bubText[160];      /* 当前气泡文字 */
static int g_bubLeft;               /* 气泡剩余 tick(110ms) */
static int g_aff;                   /* 好感度 0..100 */
static int g_lastDay;               /* 上次见面的日期序号(用于久别问候) */
static wchar_t g_lastSong[200];     /* 上次检测到的歌名(切歌判定) */
static int g_songLeft;              /* 歌曲情绪驻留 tick */
static int g_logStale;              /* 连续读不到日志的计数(>阈值则清歌名) */
static char g_logDir[MAX_PATH];     /* 歌词插件日志目录 */

/* v16 音乐人格(music_brain.c) 接口 */
typedef struct {
    int level;                  /* 0沉默 1轻微 2强烈 */
    int state;                  /* 强烈反应的目标状态号 */
    wchar_t text[200];
} BrainReaction;
void brain_init(const char *iniPathUtf8, const char *libPathUtf8, int aff);
BrainReaction brain_on_song(const wchar_t *artist, const wchar_t *title);
void brain_on_pet(void);
void brain_parse_title(const wchar_t *title, wchar_t *artist, size_t asz,
                       wchar_t *song, size_t sz);
void brain_set_aff(int aff);
void brain_save_all(void);

/* 前向声明(状态机 rand_behavior 早于台词/歌曲函数定义) */
static void say_greet(void);
static void say_idle(void);

/* 菜单文案一律用 L"中文" 宽字面量直接写。
 * 不要再用 "\xNN" 手写 UTF-8 字节——那是逐字节凭记忆拼的, 拼错一位就变成
 * 另一串合法但语义无关的汉字(如"跟随"写成"路随"), 编译期完全无警告, 极难查。
 * MinGW gcc 以 UTF-8 读源码, L"" 字面量直接生成正确的 UTF-16。 */

/* ---------------- 资源 BMP → HBITMAP + 内存DC ---------------- */
static int sheet_load(int resId, int frames, int ticks) {
    HRSRC rc = FindResourceA(NULL, MAKEINTRESOURCEA(resId), MAKEINTRESOURCEA(10)/*RT_RCDATA*/);
    if (!rc) return 0;
    HGLOBAL h = LoadResource(NULL, rc);
    if (!h) return 0;
    unsigned char *data = (unsigned char *)LockResource(h);
    if (!data) return 0;
    unsigned off = *(unsigned *)(data + 10);              /* bfOffBits */
    BITMAPINFO *bi = (BITMAPINFO *)(data + 14);
    int sh = bi->bmiHeader.biHeight;
    void *bits = NULL;
    for (int k = 0; k < 2; k++) {
        bits = NULL;
        HBITMAP bmp = CreateDIBSection(NULL, bi, DIB_RGB_COLORS, &bits, NULL, 0);
        if (!bmp) return 0;
        HDC dc = CreateCompatibleDC(NULL);
        SelectObject(dc, bmp);
        /* 行序自底向上, 直接拷贝像素 */
        unsigned long sz = bi->bmiHeader.biSizeImage;
        if (!sz) sz = 4u * bi->bmiHeader.biWidth * bi->bmiHeader.biHeight;
        memcpy(bits, data + off, sz);
        if (k == 1) {
            /* 镜像副本: 逐帧水平翻转。条带宽 sw = frames*FRM, 必须按 FRM 分段镜像,
               否则整条带翻转会让帧序也倒过来, 与 g_frame 索引不匹配 */
            HDC src = CreateCompatibleDC(NULL);
            SelectObject(src, g_sh[resId - 1].bmp[0]);
            SetStretchBltMode(dc, COLORONCOLOR);
            for (int f = 0; f < frames; f++) {
                StretchBlt(dc, f * FRM, 0, -FRM, sh,
                           src, f * FRM, 0, FRM, sh, SRCCOPY);
            }
            DeleteDC(src);
        }
        g_sh[resId - 1].bmp[k] = bmp;
        g_sh[resId - 1].mdc[k] = dc;
    }
    g_sh[resId - 1].frames = frames;
    g_sh[resId - 1].ticks = ticks > 0 ? ticks : 1;
    g_sh[resId - 1].nseq = frames;
    for (int f = 0; f < frames && f < 12; f++) g_sh[resId - 1].seq[f] = (unsigned char)f;
    return 1;
}

/* 覆盖某状态的帧播放序列(ping-pong 等非顺序循环); 值必须落在条带帧号范围内 */
static void sheet_seq(int resId, const unsigned char *seq, int n) {
    if (n <= 0 || n > 12) return;
    for (int i = 0; i < n; i++)
        if (seq[i] >= g_sh[resId - 1].frames) return;
    g_sh[resId - 1].nseq = n;
    memcpy(g_sh[resId - 1].seq, seq, (size_t)n);
}

/* ---------------- 状态机 ---------------- */
static void set_state(int s, int framesLeft) {
    g_state = s;
    g_frame = 0;
    g_tick = 0;
    g_acc = 0;
    g_stateLeft = framesLeft;
    g_frames = g_sh[s].nseq;
    InvalidateRect(g_wnd, NULL, FALSE);
}

static void wander(void) {
    RECT wa;
    SystemParametersInfoA(SPI_GETWORKAREA, 0, &wa, 0);
    RECT r;
    GetWindowRect(g_wnd, &r);
    int x = r.left, y = r.top;
    x += g_dir * 2;
    if (x < wa.left + 4) { x = wa.left + 4; g_dir = 1; }
    if (x > wa.right - FRM - 4) { x = wa.right - FRM - 4; g_dir = -1; }
    /* 走路轻微上下起伏 */
    int yy = y;
    SetWindowPos(g_wnd, NULL, x, yy, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

static void rand_behavior(void) {
    /* 歌曲情绪驻留期内: 减少随机跳转, 让"被这首歌带动"的状态演完 */
    if (g_songLeft > 0) { g_songLeft--; return; }
    int r = rand() % 100;
    /* 好感度影响: 亲近时更多问候/傲娇, 生疏时更多不开心 */
    if (g_aff >= 75 && r >= 90) { say_greet(); set_state(12, 40); return; }
    if (g_aff < 25 && r >= 92)  { set_state(6, 48); return; }
    if (r < 20)      { if (rand() % 4 == 0) say_idle(); set_state(0, 30 + rand() % 40); }  /* 待机(呼吸循环) */
    else if (r < 36) { g_dir = (rand() % 2) ? 1 : -1; set_state(1, 30 + rand() % 50); }
    else if (r < 44) set_state(2, 36);                          /* 被投喂 */
    else if (r < 54) set_state(4, 60 + rand() % 60);            /* 睡觉 */
    else if (r < 63) set_state(8, 60 + rand() % 40);            /* 听音乐 */
    else if (r < 70) set_state(7, 80 + rand() % 40);            /* 工作忙 */
    else if (r < 76) set_state(9, 60 + rand() % 30);            /* K歌 */
    else if (r < 81) set_state(11, 60 + rand() % 40);           /* 游泳 */
    else if (r < 85) set_state(5, 24);                          /* 高兴欢呼 */
    else if (r < 88) set_state(6, 48);                          /* 不开心 */
    else if (r < 91) set_state(10, 48);                         /* 生气 */
    else if (r < 94) set_state(14, 40);                         /* 害羞 */
    else if (r < 96) set_state(12, 40);                         /* 问候 */
    else if (r < 97) set_state(15, 40);                         /* 思考 */
    else if (r < 98) set_state(16, 40);                         /* 傲娇得意 */
    else if (r < 100) set_state(17, 48);                        /* 摇尾巴跳舞 */
}

/* ================= v15 智能交互 ================= */
/* ---- 气泡: 独立分层窗, 鼠标穿透, 不干扰本体拖动 ---- */
static void bubble_place(void) {
    if (!g_bub) return;
    RECT r; GetWindowRect(g_wnd, &r);
    int x = r.left + FRM / 2 - BUB_W / 2;
    int y = r.top - BUB_H + 10;               /* 尖角指向角色头顶 */
    if (y < 4) y = r.top + FRM - 10;           /* 顶到屏幕上边则改放脚下 */
    SetWindowPos(g_bub, NULL, x, y, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

static void bubble_show(const wchar_t *txt) {
    if (!g_bub || !txt || !txt[0]) return;
    wcsncpy(g_bubText, txt, 159);
    g_bubText[159] = 0;
    g_bubLeft = 34;                            /* 约 3.7 秒 */
    bubble_place();
    ShowWindow(g_bub, SW_SHOWNOACTIVATE);
    InvalidateRect(g_bub, NULL, FALSE);
}

static void bubble_tick(void) {
    if (!g_bub || g_bubLeft <= 0) return;
    if (--g_bubLeft <= 0) {
        g_bubText[0] = 0;
        ShowWindow(g_bub, SW_HIDE);
    }
}

static LRESULT CALLBACK BubbleProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    (void)w; (void)l;
    if (m == WM_PAINT) {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        /* 圆角气泡 + 底部尖角 + 淡蓝描边 */
        HBRUSH br = CreateSolidBrush(RGB(255, 255, 255));
        HPEN pen = CreatePen(PS_SOLID, 1, RGB(120, 160, 205));
        HBRUSH oldBr = (HBRUSH)SelectObject(dc, br);
        HPEN oldPen = (HPEN)SelectObject(dc, pen);
        RoundRect(dc, 6, 4, BUB_W - 6, BUB_H - 16, 12, 12);
        POINT tri[3] = { { BUB_W / 2 - 10, BUB_H - 18 },
                         { BUB_W / 2 + 10, BUB_H - 18 },
                         { BUB_W / 2,      BUB_H - 4  } };
        HBRUSH br2 = CreateSolidBrush(RGB(255, 255, 255));
        HBRUSH oldBr2 = (HBRUSH)SelectObject(dc, br2);
        BeginPath(dc);
        MoveToEx(dc, tri[0].x, tri[0].y, NULL);
        LineTo(dc, tri[1].x, tri[1].y);
        LineTo(dc, tri[2].x, tri[2].y);
        CloseFigure(dc);
        EndPath(dc);
        FillPath(dc);
        SelectObject(dc, oldBr2);
        DeleteObject(br2);
        SelectObject(dc, oldPen);
        SelectObject(dc, oldBr);
        DeleteObject(pen);
        DeleteObject(br);
        if (g_bubText[0]) {
            HFONT oldFont = (HFONT)SelectObject(dc, g_bubFont);
            SetTextColor(dc, RGB(30, 45, 80));
            SetBkMode(dc, TRANSPARENT);
            RECT rc = { 10, 6, BUB_W - 10, BUB_H - 18 };
            DrawTextW(dc, g_bubText, -1, &rc,
                      DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
            SelectObject(dc, oldFont);
        }
        EndPaint(h, &ps);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

/* ---- 台词池: 同一状态按触发源给不同说法 ---- */
static const wchar_t *pick(const wchar_t *const *arr, int n) {
    return arr[rand() % n];
}
static void say_idle(void) {
    static const wchar_t *a[] = { L"今天也要元气满满~", L"(打了个小哈欠)",
        L"发呆中…", L"窗外天气真好呢", L"悄悄深呼吸~" };
    bubble_show(pick(a, 5));
}
static void say_pet(void) {
    if (g_aff >= 70) {
        static const wchar_t *a[] = { L"最喜欢摸摸了~", L"嘿嘿，好舒服~",
            L"再摸一下嘛！", L"(眯起眼睛蹭蹭)" };
        bubble_show(pick(a, 4));
    } else if (g_aff < 30) {
        static const wchar_t *a[] = { L"哼，别碰我", L"还不熟，别摸",
            L"(躲开一点点)" };
        bubble_show(pick(a, 3));
    } else {
        static const wchar_t *a[] = { L"呀，被摸到了", L"有点害羞…",
            L"谢谢摸摸~", L"(捂脸)" };
        bubble_show(pick(a, 4));
    }
}
static void say_feed(void) {
    if (g_aff >= 70) {
        static const wchar_t *a[] = { L"你最好啦！开动~", L"哇！是大餐！",
            L"我最喜欢你喂我~" };
        bubble_show(pick(a, 3));
    } else {
        static const wchar_t *a[] = { L"啊——张嘴！", L"谢谢投喂~",
            L"好香呀", L"(开心地端起碗)" };
        bubble_show(pick(a, 4));
    }
}
static void say_drag(void) {
    static const wchar_t *a[] = { L"呀！放我下来~", L"头晕头晕…",
        L"你要带我去哪里？", L"(抓住边缘)" };
    bubble_show(pick(a, 4));
}
static void say_greet(void) {
    if (g_aff >= 70) {
        static const wchar_t *a[] = { L"你回来啦！等你好久~", L"最想见的就是你！" };
        bubble_show(pick(a, 2));
    } else {
        static const wchar_t *a[] = { L"嗨，来啦~", L"今天也一起加油吧", L"你好呀！" };
        bubble_show(pick(a, 3));
    }
}
static void aff_change(int d) {
    g_aff += d;
    if (g_aff < 0) g_aff = 0;
    if (g_aff > 100) g_aff = 100;
    brain_set_aff(g_aff);
}

/* ---- 日期序号: 只用于判断"隔了几天" ---- */
static int day_no(void) {
    SYSTEMTIME st; GetLocalTime(&st);
    return (int)(st.wYear * 372 + st.wMonth * 31 + st.wDay);
}

/* v16: 歌手/歌名从歌词插件日志取(完整、不滚动), 曲风从音频标签读。
 * TTPlayer 窗口标题是无缝滚动 marquee(实测同一首歌轮流显示不同片段),
 * 无法可靠还原完整歌名, 故不作数据源。
 *
 * 插件日志路径: exe 在 AddIn\, 日志在 AddIn\lyrics-server\log\YYYY-MM-DD.txt
 * 取最后一条 "搜索 歌手：X  歌名：Y" —— 这是宿主传给插件的完整元数据。
 */
static int song_read_log(wchar_t *artist, size_t asz, wchar_t *title, size_t tsz) {
    SYSTEMTIME st; GetLocalTime(&st);
    char path[MAX_PATH];
    _snprintf(path, sizeof path, "%s\\%04d-%02d-%02d.txt",
              g_logDir, st.wYear, st.wMonth, st.wDay);
    HANDLE f = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return 0;
    DWORD sz = GetFileSize(f, NULL);
    if (sz <= 0 || sz > 4 * 1024 * 1024) { CloseHandle(f); return 0; }
    DWORD back = sz > 32768 ? 32768 : sz;
    SetFilePointer(f, (LONG)(sz - back), NULL, FILE_BEGIN);
    char *buf = (char *)malloc(back + 1);
    if (!buf) { CloseHandle(f); return 0; }
    DWORD rd = 0;
    ReadFile(f, buf, back, &rd, NULL);
    CloseHandle(f);
    buf[rd] = 0;
    char *best = NULL;
    char *p = buf;
    while (p && *p) {
        char *eol = strchr(p, '\n');
        if (eol) *eol = 0;
        if (strstr(p, "搜索 歌手：") && strstr(p, "歌名：")) best = p;
        p = eol ? eol + 1 : NULL;
    }
    if (!best) { free(buf); return 0; }
    char *ta = strstr(best, "搜索 歌手：") + strlen("搜索 歌手：");
    char *tt = strstr(best, "歌名：") + strlen("歌名：");
    /* artist 在 "歌名：" 前截断(日志里歌手与歌名在同一行, 中间还可能有多余空格) */
    char *ea = strstr(ta, "歌名：");
    if (ea) *ea = 0;
    char *et = strstr(tt, "\r"); if (!et) et = strchr(tt, '\n');
    if (et) *et = 0;
    /* trim 尾部空格 */
    while (ea && ea > ta && ea[-1] == ' ') *(--ea) = 0;
    MultiByteToWideChar(CP_UTF8, 0, ta, -1, artist, (int)asz);
    MultiByteToWideChar(CP_UTF8, 0, tt, -1, title, (int)tsz);
    free(buf);
    return title[0] != 0;
}

static void song_poll(void) {
    wchar_t artist[80] = { 0 }, title[120] = { 0 };
    if (!song_read_log(artist, 80, title, 120)) { g_logStale++; return; }
    /* 日志里的歌名有时带 "歌手 - " 前缀, 去掉 */
    wchar_t *dash = wcsstr(title, L" - ");
    if (dash && artist[0] && wcsstr(dash + 3, artist) == NULL) {
        memmove(title, dash + 3, (wcslen(dash + 3) + 1) * sizeof(wchar_t));
    }
    if (!title[0]) return;
    /* 去掉标题尾部的 " -" 残留 */
    size_t tl = wcslen(title);
    while (tl && (title[tl-1] == L' ' || title[tl-1] == L'-')) title[--tl] = 0;

    wchar_t key[220];
    _snwprintf(key, 219, L"%s|%s", artist, title); key[219] = 0;
    if (wcscmp(key, g_lastSong) == 0) return;   /* 同一首: 不重复决策 */
    wcsncpy(g_lastSong, key, 199); g_lastSong[199] = 0;
    g_logStale = 0;

    /* 交给人格评分 */
    BrainReaction r = brain_on_song(artist, title);
    if (r.level == 0) return;                   /* 沉默: 大多数歌 */

    /* 正在交互时不切状态, 只显示气泡 */
    if (g_drag || g_state == 14 || g_state == 2) {
        if (r.text[0]) bubble_show(r.text);
        return;
    }
    if (r.level == 2) {
        set_state(r.state, 70 + rand() % 40);
        g_songLeft = 90;                        /* 情绪驻留约 10 秒 */
    }
    if (r.text[0]) bubble_show(r.text);
}

/* ---------------- 位置记忆 ---------------- */
static char g_ini[MAX_PATH];
static void pos_save(void) {
    RECT r;
    GetWindowRect(g_wnd, &r);
    char buf[64];
    sprintf(buf, "%ld,%ld", (long)r.left, (long)r.top);
    WritePrivateProfileStringA("pet", "pos", buf, g_ini);
    WritePrivateProfileStringA("pet", "topmost", g_topmost ? "1" : "0", g_ini);
}
static void pos_load(void) {
    char buf[64] = "";
    GetPrivateProfileStringA("pet", "pos", "", buf, sizeof buf, g_ini);
    int x = -1, y = -1;
    sscanf(buf, "%d,%d", &x, &y);
    RECT wa;
    SystemParametersInfoA(SPI_GETWORKAREA, 0, &wa, 0);
    if (x < wa.left - 20 || x > wa.right - 40 || y < -20 || y > wa.bottom - 40 || !buf[0]) {
        x = wa.right - FRM - 24;
        y = wa.bottom - FRM - 8;
    }
    SetWindowPos(g_wnd, NULL, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
}

/* ---------------- 与 TTPlayer 的启停联动 ----------------
 * TTPlayer 的 AddIn 目录只加载 ttp_*.dll 音频解码插件, 不会拉起 .exe,
 * 因此桌宠需自行检测主程序进程:
 *   - 检测到 TTPlayer 启动 → 显示桌宠本体
 *   - 检测到 TTPlayer 退出   → 隐藏本体(托盘常驻) 或 直接退出
 */
static int ttplayer_running(void) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);
    int found = 0;
    if (Process32FirstW(snap, &pe)) {
        do {
            if (_wcsicmp(pe.szExeFile, L"TTPlayer.exe") == 0) { found = 1; break; }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return found;
}

/* 依据联动开关, 显示/隐藏桌宠本体 */
static void pet_show(int show) {
    if (show && !g_bodyHidden) return;   /* 已显示 */
    if (!show && g_bodyHidden) return;    /* 已隐藏 */
    g_bodyHidden = show ? 0 : 1;
    if (show) {
        ShowWindow(g_wnd, SW_SHOWNOACTIVATE);
        SetWindowPos(g_wnd, g_topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    } else {
        ShowWindow(g_wnd, SW_HIDE);
        g_bubLeft = 0;
        if (g_bub) ShowWindow(g_bub, SW_HIDE);
    }
}

/* 切换「随 TTPlayer 启停联动」并持久化 */
static void follow_toggle(void) {
    g_followTT = !g_followTT;
    g_ttSeen = ttplayer_running();
    WritePrivateProfileStringA("pet", "follow_tt", g_followTT ? "1" : "0", g_ini);
    /* 关闭联动时立即显示本体 */
    if (!g_followTT) pet_show(1);
}

/* ---------------- 托盘图标 ---------------- */
static void tray_add(void) {
    memset(&g_nid, 0, sizeof(g_nid));
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = g_wnd;
    g_nid.uID = ID_TRAY;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAY;
    g_nid.hIcon = LoadIconW((HINSTANCE)GetWindowLongPtrW(g_wnd, GWLP_HINSTANCE), MAKEINTRESOURCEW(1));
    if (!g_nid.hIcon) g_nid.hIcon = LoadIconW(NULL, IDI_APPLICATION);
    wcscpy(g_nid.szTip, L"鲸鱼娘桌宠");
    Shell_NotifyIconW(NIM_ADD, &g_nid);
}
static void tray_del(void) {
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
}

/* ---------------- 绘制 ---------------- */
static void paint(HDC dc) {
    Sheet *sh = &g_sh[g_state];
    int sx = sh->seq[g_frame] * FRM;
    int k = (g_state == 1 && g_dir < 0) ? 1 : 0;
    BitBlt(dc, 0, 0, FRM, FRM, sh->mdc[k], sx, 0, SRCCOPY);
}

static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE: {
        SetTimer(h, 1, 110, NULL);
        SetTimer(h, 2, 15000, NULL);    /* TTPlayer 联动检测(15s 一次足够; 原 2s 全进程快照是常驻负载) */
        return 0;
    }
    case WM_TIMER: {
        if (w == 2) {
            /* 联动: 跟随 TTPlayer 启停。联动关闭时不做全进程快照 */
            if (!g_followTT) return 0;
            int tt = ttplayer_running();
            if (tt != g_ttSeen) {
                g_ttSeen = tt;
                if (g_followTT) {
                    if (tt) {
                        /* TTPlayer 起来了 → 显示桌宠 */
                        pet_show(1);
                    } else {
                        /* TTPlayer 退出了 → 桌宠本体隐藏, 托盘常驻 */
                        pet_show(0);
                    }
                }
            }
            return 0;
        }
        g_tick++;
        bubble_tick();                             /* 气泡倒计时 */
        /* 歌曲检测: 每 15 tick(约 1.6s) 读一次歌词日志; 无日志超过 40 次则清歌名 */
        if (g_tick % 15 == 0) {
            song_poll();
            if (g_logStale > 40 && g_lastSong[0]) {
                g_lastSong[0] = 0;
                g_logStale = 0;
            }
        }
        if (--g_stateLeft <= 0) rand_behavior();
        /* 按当前状态的 ticks 决定何时推进到下一帧 */
        if (++g_acc >= g_sh[g_state].ticks) {
            g_acc = 0;
            g_frame = (g_frame + 1) % g_sh[g_state].nseq;
        }
        if (g_state == 1) wander();
        bubble_place();                            /* 气泡跟随本体 */
        InvalidateRect(h, NULL, FALSE);
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        paint(dc);
        EndPaint(h, &ps);
        return 0;
    }
    /* ---- 外部按状态号切换动画（调试 / 自动化验证用） ---- */
    case WM_SETSTATE: {
        int s = (int)w;
        if (s >= 0 && s < NST) {
            int frames = (l > 0) ? (int)l : 40;
            set_state(s, frames);
            return 0;
        }
        return 0;
    }
    /* ---- 托盘图标 ---- */
    case WM_TRAY: {
        if (l == WM_RBUTTONUP || l == WM_LBUTTONUP) {
            POINT pt;
            GetCursorPos(&pt);
            bubble_show(L"想让我做什么？");
            HMENU mn = CreatePopupMenu();
            AppendMenuW(mn, MF_STRING, IDM_FEED, L"喂饭");
            AppendMenuW(mn, MF_STRING, IDM_SLEEP, L"睡觉");
            AppendMenuW(mn, MF_STRING, IDM_PLAY, L"玩耍");
            AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
            AppendMenuW(mn, MF_STRING, IDM_SHOWHIDE,
                        g_bodyHidden ? L"显示本体" : L"隐藏本体");
            AppendMenuW(mn, MF_STRING | (g_followTT ? MF_CHECKED : 0), IDM_FOLLOW,
                        L"随 TTPlayer 自动启停");
            AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
            AppendMenuW(mn, MF_STRING | (g_topmost ? MF_CHECKED : 0), IDM_TOP, L"窗口置顶");
            AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
            AppendMenuW(mn, MF_STRING, IDM_EXIT, L"退出");
            SetForegroundWindow(h);
            int cmd = TrackPopupMenu(mn, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, h, NULL);
            DestroyMenu(mn);
            if (cmd == IDM_FEED)   set_state(2, 36);
            if (cmd == IDM_SLEEP)  set_state(4, 90);
            if (cmd == IDM_PLAY)   set_state(5, 24);
            if (cmd == IDM_TOP) { g_topmost = !g_topmost;
                SetWindowPos(h, g_topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
            if (cmd == IDM_SHOWHIDE) { pet_show(g_bodyHidden); }
            if (cmd == IDM_FOLLOW) follow_toggle();
            if (cmd == IDM_EXIT) DestroyWindow(h);
            return 0;
        }
        return 0;
    }
    /* ---- 手动拖动(单击点偏移记忆, 移动阈值 4px 区分点击与拖动) ---- */
    case WM_LBUTTONDOWN:
        g_drag = 1;
        g_dragMoved = 0;
        GetCursorPos(&g_dragPt);
        RECT r;
        GetWindowRect(h, &r);
        g_dragOff.x = g_dragPt.x - r.left;
        g_dragOff.y = g_dragPt.y - r.top;
        SetCapture(h);
        return 0;
    case WM_MOUSEMOVE:
        if (!g_drag) return 0;
        POINT pt;
        GetCursorPos(&pt);
        if (abs(pt.x - g_dragPt.x) + abs(pt.y - g_dragPt.y) > 4) {
            /* 首次判定为拖动 → 切到「被拖拽」状态(惊讶悬空, 尾巴摇摆) */
            if (!g_dragMoved) { g_dragMoved = 1; set_state(13, 9999); say_drag(); }
        }
        SetWindowPos(h, NULL, pt.x - g_dragOff.x, pt.y - g_dragOff.y,
                     0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    case WM_LBUTTONUP:
        if (!g_drag) return 0;
        g_drag = 0;
        ReleaseCapture();
        /* 纯单击 = 摸一摸 → 害羞(捂脸红晕); 双击才是喂饭 */
        if (!g_dragMoved && g_state != 2) { aff_change(3); brain_on_pet(); say_pet(); set_state(14, 24); }
        else if (g_dragMoved && g_state == 13) set_state(0, 30);  /* 拖完 → 回待机 */
        return 0;
    /* ---- 单击(抬起且未拖动) = 摸一摸 → 害羞 ---- */
    case WM_LBUTTONDBLCLK:
        aff_change(5); say_feed();
        set_state(2, 36);              /* 双击 = 喂饭 → 张嘴等投喂 */
        return 0;
    case WM_RBUTTONUP: {
        POINT pt = { LOWORD(l), HIWORD(l) };
        ClientToScreen(h, &pt);
        HMENU sub = CreatePopupMenu();
        HMENU mn = CreatePopupMenu();
        AppendMenuW(mn, MF_STRING, IDM_FEED, L"喂饭");
        AppendMenuW(mn, MF_STRING, IDM_EATSELF, L"自己吃饭");
        AppendMenuW(mn, MF_STRING, IDM_SLEEP, L"睡觉");
        AppendMenuW(mn, MF_STRING, IDM_PLAY, L"玩耍");
        AppendMenuW(sub, MF_STRING, IDM_SAD, L"不开心");
        AppendMenuW(sub, MF_STRING, IDM_WORK, L"工作忙");
        AppendMenuW(sub, MF_STRING, IDM_MUSIC, L"听音乐");
        AppendMenuW(sub, MF_STRING, IDM_KTV, L"K歌");
        AppendMenuW(sub, MF_STRING, IDM_ANGRY, L"生气");
        AppendMenuW(sub, MF_STRING, IDM_SWIM, L"游泳");
        AppendMenuW(sub, MF_STRING, IDM_GREET, L"问候");
        AppendMenuW(sub, MF_STRING, IDM_SHY, L"害羞");
        AppendMenuW(sub, MF_STRING, IDM_THINK, L"思考");
            AppendMenuW(sub, MF_STRING, IDM_PROUD, L"傲娇");
            AppendMenuW(sub, MF_STRING, IDM_DANCE, L"摇尾巴跳舞");
            AppendMenuW(mn, MF_POPUP, (UINT_PTR)sub, L"场景");
        AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
        AppendMenuW(mn, MF_STRING, IDM_SHOWHIDE,
                    g_bodyHidden ? L"显示本体" : L"隐藏本体");
        AppendMenuW(mn, MF_STRING | (g_followTT ? MF_CHECKED : 0), IDM_FOLLOW,
                    L"随 TTPlayer 自动启停");
        AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
        AppendMenuW(mn, MF_STRING | (g_topmost ? MF_CHECKED : 0), IDM_TOP, L"窗口置顶");
        AppendMenuW(mn, MF_SEPARATOR, 0, NULL);
        AppendMenuW(mn, MF_STRING, IDM_EXIT, L"退出");
        int cmd = TrackPopupMenu(mn, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, h, NULL);
        DestroyMenu(mn);
        if (cmd == IDM_FEED)   { aff_change(5); say_feed(); set_state(2, 36); }
        if (cmd == IDM_SLEEP)  { bubble_show(L"晚安，做个好梦~"); set_state(4, 90); }
        if (cmd == IDM_PLAY)   { bubble_show(L"一起玩吧！"); set_state(5, 24); }
        if (cmd == IDM_SAD)    set_state(6, 48);
        if (cmd == IDM_WORK)   set_state(7, 80);
        if (cmd == IDM_MUSIC)  set_state(8, 60);
        if (cmd == IDM_KTV)    set_state(9, 60);
        if (cmd == IDM_ANGRY)  set_state(10, 48);
        if (cmd == IDM_SWIM)   set_state(11, 60);
        if (cmd == IDM_GREET)  set_state(12, 40);
        if (cmd == IDM_SHY)    set_state(14, 40);
        if (cmd == IDM_THINK)  set_state(15, 40);
        if (cmd == IDM_PROUD)  set_state(16, 40);
        if (cmd == IDM_DANCE)  set_state(17, 40);
        if (cmd == IDM_EATSELF) set_state(3, 40);
        if (cmd == IDM_SHOWHIDE) pet_show(g_bodyHidden);
        if (cmd == IDM_FOLLOW) follow_toggle();
        if (cmd == IDM_TOP) { g_topmost = !g_topmost;
            SetWindowPos(h, g_topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
        if (cmd == IDM_EXIT) DestroyWindow(h);
        return 0;
    }
    case WM_DESTROY:
        KillTimer(h, 1);
        KillTimer(h, 2);
        tray_del();
        pos_save();
        {
            char b[32];
            _snprintf(b, sizeof b, "%d", g_aff);
            WritePrivateProfileStringA("pet", "affinity", b, g_ini);
            _snprintf(b, sizeof b, "%d", day_no());
            WritePrivateProfileStringA("pet", "last_day", b, g_ini);
        }
        brain_save_all();                     /* v16: 保存歌曲记忆 */
        if (g_bub) DestroyWindow(g_bub);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

int WINAPI WinMain(HINSTANCE hi, HINSTANCE prev, LPSTR cmd, int show) {
    (void)prev; (void)cmd; (void)show;
    HANDLE mutex = CreateMutexA(NULL, TRUE, "NTTWhalePet");
    if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;
    srand(GetTickCount());
    /* 精灵加载(任一失败则退出) —— 帧数须与 frames 子目录里各 bmp 的实际帧数一致 */
    /* ticks = 每帧占几个 110ms tick: 呼吸/静态慢, 动作快 */
    if (!sheet_load(1, 4, 2))  return 1;   /* idle    呼吸 4 帧 x220ms */
    if (!sheet_load(2, 7, 1))  return 1;   /* walk    端碗碎步 7 帧 x110ms(seq 12 相位) */
    if (!sheet_load(3, 3, 2))  return 1;   /* feed    张嘴等投喂 3 帧 x220ms */
    if (!sheet_load(4, 4, 1))  return 1;   /* eat     吃饭 4 帧 x110ms */
    if (!sheet_load(5, 4, 3))  return 1;   /* sleep   睡觉呼吸 4 帧 x330ms */
    if (!sheet_load(6, 4, 1))  return 1;   /* happy   欢呼跳跃 4 帧 x110ms */
    if (!sheet_load(7, 3, 2))  return 1;   /* sad     不开心 3 帧 x220ms */
    if (!sheet_load(8, 4, 1))  return 1;   /* work    工作忙 4 帧 x110ms */
    if (!sheet_load(9, 4, 2))  return 1;   /* music   听音乐 4 帧 x220ms */
    if (!sheet_load(10, 4, 2)) return 1;   /* ktv     K歌 4 帧 x220ms */
    if (!sheet_load(11, 4, 1)) return 1;   /* angry   生气 4 帧 x110ms */
    if (!sheet_load(12, 4, 2)) return 1;   /* swim    游泳 4 帧 x220ms */
    if (!sheet_load(13, 3, 2)) return 1;   /* greet   问候挥手 3 帧 x220ms */
    if (!sheet_load(14, 3, 2)) return 1;   /* drag    被拖拽摇摆 3 姿态 x220ms(seq 4 槽) */
    if (!sheet_load(15, 3, 2)) return 1;   /* shy     害羞 3 帧 x220ms */
    if (!sheet_load(16, 3, 3)) return 1;   /* think   思考 3 帧 x330ms */
    if (!sheet_load(17, 3, 2)) return 1;   /* proud   傲娇得意 3 帧 x220ms */
    if (!sheet_load(18, 8, 1)) return 1;   /* dance   摇尾巴跳舞 8 帧 x110ms */

    /* 帧播放序列覆盖: 完整步循环 = 右摆出去 → 回中 → 左摆出去 → 回中 */
    { static const unsigned char sq_walk[] = { 0, 1, 2, 3, 2, 1, 0, 4, 5, 6, 5, 4 };
      sheet_seq(2, sq_walk, 12); }         /* walk  12 相位 x110ms, 4..6 为镜像反相摆帧 */
    { static const unsigned char sq_drag[] = { 0, 1, 2, 1 };
      sheet_seq(14, sq_drag, 4); }         /* drag  悬空摇摆: 左右摆各经中间帧, 4 槽 x220ms */

    char exe[MAX_PATH];
    GetModuleFileNameA(NULL, exe, MAX_PATH);
    char *slash = strrchr(exe, '\\');
    if (slash) *(slash + 1) = 0;
    _snprintf(g_ini, sizeof g_ini, "%swhale.ini", exe);

    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hi;
    wc.lpszClassName = L"NTTWhalePet";
    wc.style = CS_DBLCLKS;           /* 双击消息需要 */
    wc.hIcon = LoadIconW(hi, MAKEINTRESOURCEW(1));
    RegisterClassW(&wc);
    g_wnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        L"NTTWhalePet", L"NTTWhale", WS_POPUP, 0, 0, FRM, FRM, NULL, NULL, hi, NULL);
    SetLayeredWindowAttributes(g_wnd, RGB(255, 0, 255), 0, LWA_COLORKEY);
    pos_load();

    /* 气泡窗: 透明键控 + 鼠标穿透, 不抢本体的点击/拖动 */
    {
        WNDCLASSW bw = { 0 };
        bw.lpfnWndProc = BubbleProc;
        bw.hInstance = hi;
        bw.lpszClassName = L"NTTWhaleBubble";
        bw.hCursor = LoadCursor(NULL, IDC_ARROW);
        RegisterClassW(&bw);
        g_bub = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW |
                                WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
                                L"NTTWhaleBubble", L"", WS_POPUP, 0, 0, BUB_W, BUB_H,
                                NULL, NULL, hi, NULL);
        SetLayeredWindowAttributes(g_bub, RGB(255, 0, 255), 0, LWA_COLORKEY);
        g_bubFont = CreateFontW(-16, 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                DEFAULT_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Microsoft YaHei");
    }

    /* 读取配置: 是否随 TTPlayer 启停联动 (默认开启) */
    {
        char fb[8] = "";
        GetPrivateProfileStringA("pet", "follow_tt", "1", fb, sizeof fb, g_ini);
        g_followTT = (fb[0] == '1');
    }
    /* v15: 好感度 / 上次见面 / 歌词日志目录 */
    {
        char b[32] = "";
        GetPrivateProfileStringA("pet", "affinity", "50", b, sizeof b, g_ini);
        g_aff = atoi(b);
        if (g_aff < 0) g_aff = 0;
        if (g_aff > 100) g_aff = 100;
        g_lastDay = 0;
        GetPrivateProfileStringA("pet", "last_day", "", b, sizeof b, g_ini);
        if (b[0]) g_lastDay = atoi(b);
        /* 歌词插件日志目录 */
        char dir[MAX_PATH];
        _snprintf(dir, sizeof dir, "%slyrics-server\\log", exe);
        strncpy(g_logDir, dir, MAX_PATH - 1);
        g_logDir[MAX_PATH - 1] = 0;

        /* v16: 音乐人格初始化(曲库索引 + 喜好配置 + 记忆表) */
        char iniUtf8[MAX_PATH * 3], libUtf8[MAX_PATH * 3];
        strncpy(iniUtf8, g_ini, sizeof iniUtf8 - 1);   /* g_ini 已是 char*(ANSI/ASCII 路径) */
        iniUtf8[sizeof iniUtf8 - 1] = 0;
        /* Music.library 在项目根: exe 在 AddIn\, 上一级即项目根 */
        char root[MAX_PATH];
        strncpy(root, exe, sizeof root - 1);
        root[MAX_PATH - 1] = 0;
        /* exe = "D:\TTPlayer\AddIn\" → 去掉末尾 "AddIn\" 得到项目根 */
        size_t rl = strlen(root);
        while (rl > 0 && (root[rl-1] == '\\' || root[rl-1] == '/')) root[--rl] = 0;
        char *bs = strrchr(root, '\\');
        if (bs) *(bs + 1) = 0;                  /* 保留 "D:\TTPlayer\" */
        _snprintf(libUtf8, sizeof libUtf8, "%sMusic.library", root);
        brain_init(iniUtf8, libUtf8, g_aff);
    }

    /* 托盘常驻 */
    tray_add();

    /* 联动初始状态: TTPlayer 在跑就显示本体, 否则隐藏只留托盘 */
    g_ttSeen = ttplayer_running();
    if (g_followTT && !g_ttSeen) {
        g_bodyHidden = 1;
        ShowWindow(g_wnd, SW_HIDE);
    } else {
        ShowWindow(g_wnd, SW_SHOWNOACTIVATE);
    }
    set_state(0, 60);

    /* 见面记忆: 久别重逢 / 每天第一次见面给不同问候 */
    {
        int today = day_no();
        int gap = g_lastDay ? today - g_lastDay : -1;
        if (gap < 0) {
            if (g_aff >= 70) bubble_show(L"初次见面，请多关照！以后常来找我玩~");
            else bubble_show(L"嗨，我是鲸鱼娘~ 点点我可以摸摸头");
        } else if (gap >= 14) {
            bubble_show(g_aff >= 70 ? L"好久好久不见！我一直在等你呢~" : L"好久不见！最近还好吗？");
            aff_change(2);
        } else if (gap >= 1) {
            const wchar_t *a[] = { L"新的一天，一起加油吧！", L"你来啦~ 今天想听什么歌？" };
            bubble_show(pick(a, 2));
        }
        char b[32];
        _snprintf(b, sizeof b, "%d", g_aff);
        WritePrivateProfileStringA("pet", "affinity", b, g_ini);
        _snprintf(b, sizeof b, "%d", today);
        WritePrivateProfileStringA("pet", "last_day", b, g_ini);
    }

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ReleaseMutex(mutex);
    return 0;
}
