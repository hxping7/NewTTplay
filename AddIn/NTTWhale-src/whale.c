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
 */
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <stdlib.h>
#include <stdio.h>

#define FRM 128
#define NST 18
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
    int r = rand() % 100;
    if (r < 20)      set_state(0, 30 + rand() % 40);           /* 待机(呼吸循环) */
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
        if (--g_stateLeft <= 0) rand_behavior();
        /* 按当前状态的 ticks 决定何时推进到下一帧 */
        if (++g_acc >= g_sh[g_state].ticks) {
            g_acc = 0;
            g_frame = (g_frame + 1) % g_sh[g_state].nseq;
        }
        if (g_state == 1) wander();
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
            if (!g_dragMoved) { g_dragMoved = 1; set_state(13, 9999); }
        }
        SetWindowPos(h, NULL, pt.x - g_dragOff.x, pt.y - g_dragOff.y,
                     0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    case WM_LBUTTONUP:
        if (!g_drag) return 0;
        g_drag = 0;
        ReleaseCapture();
        /* 纯单击 = 摸一摸 → 害羞(捂脸红晕); 双击才是喂饭 */
        if (!g_dragMoved && g_state != 2) set_state(14, 24);
        else if (g_dragMoved && g_state == 13) set_state(0, 30);  /* 拖完 → 回待机 */
        return 0;
    /* ---- 单击(抬起且未拖动) = 摸一摸 → 害羞 ---- */
    case WM_LBUTTONDBLCLK:
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
        if (cmd == IDM_FEED)   set_state(2, 36);
        if (cmd == IDM_SLEEP)  set_state(4, 90);
        if (cmd == IDM_PLAY)   set_state(5, 24);
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

    /* 读取配置: 是否随 TTPlayer 启停联动 (默认开启) */
    {
        char fb[8] = "";
        GetPrivateProfileStringA("pet", "follow_tt", "1", fb, sizeof fb, g_ini);
        g_followTT = (fb[0] == '1');
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

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ReleaseMutex(mutex);
    return 0;
}
