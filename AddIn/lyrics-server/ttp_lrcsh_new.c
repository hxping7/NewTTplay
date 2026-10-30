/*
 * ttp_lrcsh.dll — 千千静听歌词插件（Win11 集成版）
 *
 * 逆向来源（REA + Ghidra 12.1.4，原版 ttp_lrcsh.dll 2022）：
 *   接口全链：ttpGetSoundAddIn → factory[GetIfaceC(GUID_C)] → lyrics[GetEngine] →
 *             engine[Initialize/SetSongInfo/SelectResult] → 宿主回调交付歌词
 *   调用约定：stdcall，this 作显式首参（C 风格 vtable）
 *   与原版的差异：本实现不经过 HTTP/127.0.0.1:89，工作线程直接调用
 *   QQ音乐/酷狗 API 取词，歌词经宿主回调直接交付——无外挂服务器、无端口。
 *
 * v3.1 性能版（2026-10-30，实证依据见 WER AppHangB1 记录 + 插件日志）：
 *   ① 桌宠检测改用命名互斥体 NTTWhalePet（宠物 WinMain 创建），替代每次枚举
 *      都跑全进程快照（本机 378 进程实测单次 ~9ms，宿主 3 天枚举 100 次）。
 *   ② 拉起桌宠改经 cmd.exe /c start + 3 分钟去抖：UI 线程不再直接 CreateProcess
 *      新编译的未签名 exe（火绒实时扫描/云裁定可拖住数秒 → AppHangB1 实证 6 次）。
 *   ③ eng_release 不再在宿主线程上等工作线程 3 秒：引擎最终释放移交工作线程自毁。
 *   ④ ttpGetSoundAddIn 里 PIN 本模块：宿主反复 LoadLibrary/FreeLibrary 不再真正
 *      卸载，工作线程在网络操作中时 DLL 被卸载导致代码段消失的崩溃路径被消除。
 * 接口 GUID（原版 .rdata 实证，TTPlayer.exe 已知列表匹配）：
 *   IUnknown  {00000000-0000-0000-C000-000000000046}
 *   GUID_A    {EEC6C534-FEBA-421E-AA5D-10AC66F98784}  factory
 *   GUID_C    {9D5AE963-7DF6-4323-B4CF-FBDA159BFF15}  lyrics
 *   GUID_E    {BF17B3E8-7E33-45E7-9342-CDD34BA55AF9}  engine
 *   GUID_HOST {6F1F38A8-3021-4E2E-BBFB-7F616A5C3D62}  宿主中级接口
 *   GUID_CB   {CA540428-2528-4BBC-87B0-6605F21810C9}  歌词交付回调
 */
#include <windows.h>
#include <wininet.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>

#define USER_AGENT "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:46.0) Gecko/20100101 Firefox/46.0"
#define MAX_BODY   (160 * 1024)
#define MAX_ITEMS  24

/* ================= 接口 GUID ================= */
static const GUID IID_IUnknown_C = { 0x00000000, 0x0000, 0x0000, { 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46 } };
static const GUID IID_Factory_C = { 0xEEC6C534, 0xFEBA, 0x421E, { 0xAA, 0x5D, 0x10, 0xAC, 0x66, 0xF9, 0x87, 0x84 } };
static const GUID IID_Lyrics_C = { 0x9D5AE963, 0x7DF6, 0x4323, { 0xB4, 0xCF, 0xFB, 0xDA, 0x15, 0x9B, 0xFF, 0x15 } };
static const GUID IID_Engine_C = { 0xBF17B3E8, 0x7E33, 0x45E7, { 0x93, 0x42, 0xCD, 0xD3, 0x4B, 0xA5, 0x5A, 0xF9 } };
static const GUID IID_HostMid_C = { 0x6F1F38A8, 0x3021, 0x4E2E, { 0xBB, 0xFB, 0x7F, 0x61, 0x6A, 0x5C, 0x3D, 0x62 } };
static const GUID IID_Callback_C = { 0xCA540428, 0x2528, 0x4BBC, { 0x87, 0xB0, 0x66, 0x05, 0xF2, 0x18, 0x10, 0xC9 } };

/* ================= 基础设施（同一期验证过的实现） ================= */
typedef struct { char *data; size_t len, cap; } Buf;
static void buf_init(Buf *b) { b->data = NULL; b->len = 0; b->cap = 0; }
static void buf_free(Buf *b) { free(b->data); b->data = NULL; b->len = b->cap = 0; }
static void buf_reserve(Buf *b, size_t need) {
    if (b->len + need + 1 > b->cap) {
        size_t nc = b->cap ? b->cap * 2 : 4096;
        while (nc < b->len + need + 1) nc *= 2;
        char *nd = (char *)realloc(b->data, nc);
        if (!nd) return;
        b->data = nd; b->cap = nc;
    }
}
static void buf_add(Buf *b, const char *s, size_t n) {
    buf_reserve(b, n);
    if (!b->data) return;
    memcpy(b->data + b->len, s, n);
    b->len += n;
    b->data[b->len] = 0;
}
static void buf_puts(Buf *b, const char *s) { buf_add(b, s, strlen(s)); }

static char g_dir[MAX_PATH];
static char g_logdir[MAX_PATH];
static void log_msg(const char *fmt, ...) {
    char tmp[1024];
    va_list ap; va_start(ap, fmt);
    _vsnprintf(tmp, sizeof(tmp), fmt, ap); va_end(ap);
    SYSTEMTIME st; GetLocalTime(&st);
    char line[1200];
    _snprintf(line, sizeof(line), "%04d-%02d-%02d %02d:%02d:%02d %s\r\n",
              st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, tmp);
    OutputDebugStringA(line);
    CreateDirectoryA(g_logdir, NULL);
    char path[MAX_PATH];
    _snprintf(path, sizeof(path), "%s\\%04d-%02d-%02d.txt", g_logdir, st.wYear, st.wMonth, st.wDay);
    HANDLE h = CreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        SetFilePointer(h, 0, NULL, FILE_END);
        DWORD w; WriteFile(h, line, (DWORD)strlen(line), &w, NULL);
        CloseHandle(h);
    }
}

static const char HEXCH[] = "0123456789ABCDEF";
static void url_encode(const char *src, char *dst, size_t dstsz) {
    size_t o = 0;
    for (size_t i = 0; src[i] && o + 4 < dstsz; i++) {
        unsigned char c = (unsigned char)src[i];
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') dst[o++] = (char)c;
        else { dst[o++] = '%'; dst[o++] = HEXCH[c >> 4]; dst[o++] = HEXCH[c & 15]; }
    }
    dst[o] = 0;
}
static void to_utf8_maybe_gbk(const char *src, size_t len, Buf *out) {
    int valid = 1;
    for (size_t i = 0; i < len; ) {
        unsigned char c = (unsigned char)src[i];
        if (c < 0x80) { i++; continue; }
        int need = 0;
        if ((c & 0xE0) == 0xC0) need = 1;
        else if ((c & 0xF0) == 0xE0) need = 2;
        else if ((c & 0xF8) == 0xF0) need = 3;
        else { valid = 0; break; }
        if (i + (size_t)need >= len) { valid = 0; break; }
        for (int k = 1; k <= need; k++) if (((unsigned char)src[i + k] & 0xC0) != 0x80) { valid = 0; break; }
        if (!valid) break;
        i += need + 1;
    }
    if (valid) { buf_add(out, src, len); return; }
    int wlen = MultiByteToWideChar(936, 0, src, (int)len, NULL, 0);
    if (wlen <= 0) { buf_add(out, src, len); return; }
    wchar_t *w = (wchar_t *)malloc((wlen + 1) * sizeof(wchar_t));
    if (!w) { buf_add(out, src, len); return; }
    MultiByteToWideChar(936, 0, src, (int)len, w, wlen);
    int u8 = WideCharToMultiByte(CP_UTF8, 0, w, wlen, NULL, 0, NULL, NULL);
    if (u8 > 0) {
        buf_reserve(out, (size_t)u8);
        if (out->data) {
            WideCharToMultiByte(CP_UTF8, 0, w, wlen, out->data + out->len, u8, NULL, NULL);
            out->len += u8; out->data[out->len] = 0;
        }
    }
    free(w);
}
static int b64_val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}
static int b64_decode(const char *in, unsigned char *out, size_t outcap) {
    size_t o = 0; int acc = 0, bits = 0;
    for (const char *p = in; *p; p++) {
        int v = b64_val(*p);
        if (v < 0) continue;
        acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; if (o < outcap) out[o++] = (unsigned char)((acc >> bits) & 0xFF); }
    }
    return (int)o;
}

/* ================= 迷你 JSON ================= */
static const char *jws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    return p;
}
static const char *jstr_end(const char *p) {
    p++;
    while (*p && *p != '"') { if (*p == '\\' && p[1]) p += 2; else p++; }
    if (*p == '"') p++;
    return p;
}
static const char *jskip(const char *p) {
    p = jws(p);
    if (*p == '"') return jstr_end(p);
    if (*p == '{' || *p == '[') {
        char close = (*p == '{') ? '}' : ']';
        int isObj = (*p == '{');
        p++; p = jws(p);
        if (*p == close) return p + 1;
        while (*p) {
            if (isObj) {                       // 对象：先跳键名，再跳冒号
                if (*p == '"') p = jstr_end(p);
                p = jws(p);
                if (*p == ':') p = jws(p + 1);
            }
            p = jskip(p); p = jws(p);
            if (*p == ',') { p++; p = jws(p); continue; }
            if (*p == close) return p + 1;
            break;
        }
        return p;
    }
    while (*p && *p != ',' && *p != '}' && *p != ']') p++;
    return p;
}
static const char *jfind(const char *obj, const char *objend, const char *key) {
    const char *p = jws(obj + 1);
    size_t klen = strlen(key);
    while (p < objend && *p) {
        if (*p == '}') return NULL;
        if (*p != '"') { p = jskip(p); p = jws(p); if (*p == ',') p++; continue; }
        const char *ks = p + 1;
        const char *ke = jstr_end(p);
        size_t kl = (size_t)(ke - 1 - ks);
        p = jws(ke);
        if (*p != ':') return NULL;
        p = jws(p + 1);
        if (kl == klen && !strncmp(ks, key, klen)) return p;
        p = jskip(p); p = jws(p);
        if (*p == ',') p++;
    }
    return NULL;
}
static int jget_str(const char *obj, const char *objend, const char *key, char *out, size_t outsz) {
    const char *v = jfind(obj, objend, key);
    if (!v || *v != '"') return 0;
    v++;
    size_t i = 0;
    while (*v && *v != '"' && i + 1 < outsz) {
        if (*v == '\\' && v[1]) {
            v++;
            if (*v == 'u') {
                unsigned cp = 0;
                for (int k = 1; k <= 4; k++) {
                    char c = v[k]; cp <<= 4;
                    if (c >= '0' && c <= '9') cp |= (unsigned)(c - '0');
                    else if (c >= 'a' && c <= 'f') cp |= (unsigned)(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F') cp |= (unsigned)(c - 'A' + 10);
                }
                v += 4;
                if (cp < 0x80) out[i++] = (char)cp;
                else if (cp < 0x800 && i + 2 < outsz) {
                    out[i++] = (char)(0xC0 | (cp >> 6)); out[i++] = (char)(0x80 | (cp & 0x3F));
                } else if (i + 3 < outsz) {
                    out[i++] = (char)(0xE0 | (cp >> 12));
                    out[i++] = (char)(0x80 | ((cp >> 6) & 0x3F));
                    out[i++] = (char)(0x80 | (cp & 0x3F));
                }
            } else {
                switch (*v) {
                case 'n': out[i++] = '\n'; break;
                case 't': out[i++] = '\t'; break;
                case 'r': out[i++] = '\r'; break;
                default: out[i++] = *v;
                }
                v++;
            }
        } else out[i++] = *v++;
    }
    out[i] = 0;
    return 1;
}
static const char *jdoc_array(const char *json, const char *key) {
    char pat[128];
    _snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return NULL;
    p = jws(p + strlen(pat));
    if (*p != ':') return NULL;
    p = jws(p + 1);
    if (*p != '[') return NULL;
    return p;
}

/* ================= HTTP GET ================= */
/* 单次尝试：openType = INTERNET_OPEN_TYPE_PRECONFIG / INTERNET_OPEN_TYPE_DIRECT
   返回 HTTP 状态码；失败返回 -1(InternetOpen 失败) / -2(InternetOpenUrl 失败) / -3(读超时无数据) */
static int http_try(const char *url, DWORD openType, Buf *out, DWORD *lastErr) {
    HINTERNET hInet = InternetOpenA(USER_AGENT, openType, NULL, NULL, 0);
    if (!hInet) {
        if (lastErr) *lastErr = GetLastError();
        return -1;
    }
    DWORD tmo = 8000;
    InternetSetOptionA(hInet, INTERNET_OPTION_CONNECT_TIMEOUT, &tmo, sizeof(tmo));
    InternetSetOptionA(hInet, INTERNET_OPTION_RECEIVE_TIMEOUT, &tmo, sizeof(tmo));
    HINTERNET hUrl = InternetOpenUrlA(hInet, url, NULL, 0,
        INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_NO_COOKIES, 0);
    if (!hUrl) {
        if (lastErr) *lastErr = GetLastError();
        InternetCloseHandle(hInet);
        return -2;
    }
    char chunk[16384];
    DWORD n = 0, total = 0;
    while (InternetReadFile(hUrl, chunk, sizeof(chunk), &n) && n > 0) {
        buf_add(out, chunk, n);
        total += n;
        if (total > MAX_BODY) break;
    }
    DWORD status = 0, slen = sizeof(status);
    HttpQueryInfoA(hUrl, HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER, &status, &slen, NULL);
    InternetCloseHandle(hUrl);
    InternetCloseHandle(hInet);
    return (int)status;
}

/* 先走系统代理配置（PRECONFIG）；失败则直连重试。
   实测 TTPlayer 进程内 PRECONFIG 会因 IE 代理配置失效而全部超时（错误码 12002），
   而 curl/独立进程正常，故必须有直连兜底。 */
static int http_get(const char *url, const char *referer, Buf *out) {
    (void)referer;
    DWORD e1 = 0, e2 = 0;
    int st = http_try(url, INTERNET_OPEN_TYPE_PRECONFIG, out, &e1);
    if (st > 0) return st;
    size_t got = out ? out->len : 0;
    if (out) out->len = got;              /* 保留已读内容（失败时一般为空） */
    log_msg("PRECONFIG 失败 st=%d err=%lu，改直连重试", st, (unsigned long)e1);
    st = http_try(url, INTERNET_OPEN_TYPE_DIRECT, out, &e2);
    if (st <= 0) log_msg("直连也失败 st=%d err=%lu", st, (unsigned long)e2);
    return st;
}

/* ================= 文本规范化（v3：繁→简 / 比较键 / 歌名清洗） ================= */
#ifndef LCMAP_SIMPLIFIED_CHINESE
#define LCMAP_SIMPLIFIED_CHINESE 0x02000000
#endif
#ifndef LCMAP_TRADITIONAL_CHINESE
#define LCMAP_TRADITIONAL_CHINESE 0x04000000
#endif
#define LCID_ZHCN 0x0804

static int u8_to_wide(const char *s, wchar_t **out) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (n <= 0) return 0;
    wchar_t *w = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
    if (!w) return 0;
    MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
    *out = w;
    return n;
}
static int wide_to_u8n(const wchar_t *w, int wlen, char *out, size_t outsz) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, wlen, NULL, 0, NULL, NULL);
    if (n <= 0 || (size_t)n >= outsz) { if (outsz) out[0] = 0; return 0; }
    WideCharToMultiByte(CP_UTF8, 0, w, wlen, out, n, NULL, NULL);
    out[n] = 0;
    return n;
}
/* 繁体→简体（Windows LCMapString，保留空格/标点），供搜索关键词变体 */
static void t2s_utf8(const char *src, char *dst, size_t dstsz) {
    wchar_t *w = NULL; int n;
    dst[0] = 0;
    if (!src || !src[0] || !(n = u8_to_wide(src, &w))) return;
    wchar_t *ws = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
    if (ws) {
        if (LCMapStringW(LCID_ZHCN, LCMAP_SIMPLIFIED_CHINESE, w, n - 1, ws, n) > 0)
            wide_to_u8n(ws, n - 1, dst, dstsz);
        free(ws);
    }
    free(w);
    if (!dst[0]) _snprintf(dst, dstsz, "%s", src);
}
static int w_is_word(wchar_t c) {
    if (c >= '0' && c <= '9') return 1;
    if (c >= 'A' && c <= 'Z') return 1;
    if (c >= 'a' && c <= 'z') return 1;
    if (c >= 0x3040 && c <= 0x9FFF) return 1;   /* 假名/注音 + CJK 统一表意 */
    if (c >= 0xAC00 && c <= 0xD7AF) return 1;   /* 谚文 */
    if (c >= 0xF900 && c <= 0xFAFF) return 1;   /* CJK 兼容表意 */
    return 0;
}
/* 比较键：繁→简 + 全角折半角 + 小写，只保留字母数字/中日韩文字，丢弃空格与标点 */
static void norm_key(const char *src, char *dst, size_t dstsz) {
    wchar_t *w = NULL; int n;
    dst[0] = 0;
    if (!src || !src[0] || !(n = u8_to_wide(src, &w))) return;
    wchar_t *t = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
    if (t) {
        if (LCMapStringW(LCID_ZHCN, LCMAP_SIMPLIFIED_CHINESE, w, n - 1, t, n) > 0) {
            wchar_t *l = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
            const wchar_t *sw = t;
            if (l && LCMapStringW(LCID_ZHCN, LCMAP_LOWERCASE, t, n - 1, l, n) > 0) sw = l;
            wchar_t *o = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
            if (o) {
                int m = 0;
                for (int i = 0; i < n - 1 && m < n - 1; i++) {
                    wchar_t c = sw[i];
                    if (c >= 0xFF01 && c <= 0xFF5E) c = (wchar_t)(c - 0xFEE0);  /* 全角→半角 */
                    if (w_is_word(c)) o[m++] = c;
                }
                o[m] = 0;
                wide_to_u8n(o, m, dst, dstsz);
                free(o);
            }
            free(l);
        }
        free(t);
    }
    free(w);
}
/* 清洗歌名：剥掉 "136. " 这类序号前缀（数字≤4 位且后接 .、．、、_ · 或空格+分隔符），两端去空白 */
static void clean_title(const char *utf8, char *dst, size_t dstsz) {
    wchar_t *w = NULL; int n;
    if (!(n = u8_to_wide(utf8, &w))) { _snprintf(dst, dstsz, "%s", utf8 ? utf8 : ""); return; }
    wchar_t *p = w;
    for (int pass = 0; pass < 2; pass++) {
        while (*p == L' ' || *p == 0x3000 || *p == L'\t') p++;
        int d = 0;
        while (p[d] >= L'0' && p[d] <= L'9' && d < 5) d++;
        if (d == 0 || d > 4) break;
        int e = d;
        while (p[e] == L' ' || p[e] == 0x3000) e++;
        wchar_t c = p[e];
        int sep = (c == L'.' || c == 0xFF0E || c == 0x3001 || c == 0x00B7 || c == 0x30FB ||
                   c == L'_' || c == 0xFF3F);
        /* 数字后直接跟 CJK 也视为曲目号（"07别人的天长地久"） */
        if (!sep && !(c >= 0x2E80 && c <= 0x9FFF)) break;
        e++;
        while (p[e] == L' ' || p[e] == 0x3000) e++;
        if (!p[e]) break;               /* 只有数字没有歌名 */
        p += e;
    }
    int end = lstrlenW(p);
    while (end > 0 && (p[end - 1] == L' ' || p[end - 1] == 0x3000)) end--;
    if (!wide_to_u8n(p, end, dst, dstsz)) _snprintf(dst, dstsz, "%s", utf8);
    free(w);
}
/* 去掉全部括号段：（..） (..) 【..】 [..] → 供 "歌名(现场版)" 变体 */
static void strip_parens_utf8(const char *utf8, char *dst, size_t dstsz) {
    wchar_t *w = NULL; int n;
    if (!(n = u8_to_wide(utf8, &w))) { _snprintf(dst, dstsz, "%s", utf8 ? utf8 : ""); return; }
    wchar_t *o = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
    if (!o) { _snprintf(dst, dstsz, "%s", utf8); free(w); return; }
    int m = 0, depth = 0;
    for (int i = 0; i < n - 1; i++) {
        wchar_t c = w[i];
        int open = (c == L'(' || c == 0xFF08 || c == 0x3010 || c == L'[');
        int close = (c == L')' || c == 0xFF09 || c == 0x3011 || c == L']');
        if (open) { depth++; continue; }
        if (close) { if (depth > 0) depth--; continue; }
        if (depth == 0) o[m++] = c;
    }
    o[m] = 0;
    int end = m;
    while (end > 0 && (o[end - 1] == L' ' || o[end - 1] == 0x3000 || o[end - 1] == L'-')) end--;
    o[end] = 0;
    if (!wide_to_u8n(o, end, dst, dstsz)) _snprintf(dst, dstsz, "%s", utf8);
    free(o);
    free(w);
}
/* 找分隔用连字符：要么 " - "（空格夹持），要么紧贴但左侧是 CJK 且右侧是数字/CJK
   （"示例歌手-07别人的天长地久"）。返回宽字符下标或 -1。 */
static int find_dash_split(const wchar_t *w) {
    for (int i = 1; w[i]; i++) {
        if (w[i] == L'-' || w[i] == 0x2013 || w[i] == 0x2014) {
            if ((w[i - 1] == L' ' || w[i - 1] == 0x3000) &&
                (w[i + 1] == L' ' || w[i + 1] == 0x3000))
                return i;
            if ((w[i - 1] >= 0x2E80 && w[i - 1] <= 0x9FFF) &&
                ((w[i + 1] >= L'0' && w[i + 1] <= L'9') ||
                 (w[i + 1] >= 0x2E80 && w[i + 1] <= 0x9FFF)))
                return i;
        }
    }
    return -1;
}

/* ================= 播放列表反查（无标签文件的歌手兜底） =================
   宿主对无标签 WAV 只传文件名标题、歌手为空。播放列表 .ttbl 的条目是
   "标题 + 完整路径"（UTF-16LE），按歌名反查路径后：
   ① 直接读该文件的内嵌标签拿歌手/标题（即「歌曲信息」对话框显示的那份数据，
      2013 版宿主不把它传给歌词插件）——WAV 尾部 'id3 ' chunk(ID3v2.3)、
      RIFF LIST INFO(IART/INAM)、头部/尾部 ID3v2、尾部 ID3v1 都覆盖；
   ② 标签缺失再退回文件夹名猜测（示例专辑 → 示例歌手）。 */

/* UTF-16 字节流（可带 BOM）→ UTF-8；be=1 表示大端 */
static int utf16_bytes_to_utf8(const unsigned char *b, size_t n, int be,
                               char *out, size_t outsz) {
    if (n < 2) return 0;
    if (b[0] == 0xFF && b[1] == 0xFE) { be = 0; b += 2; n -= 2; }
    else if (b[0] == 0xFE && b[1] == 0xFF) { be = 1; b += 2; n -= 2; }
    if (n >= 2 && b[n - 1] == 0 && b[n - 2] == 0) n -= 2;   /* 去结尾 NUL */
    size_t nw = n / 2;
    if (!nw) return 0;
    wchar_t *w = (wchar_t *)malloc((nw + 1) * sizeof(wchar_t));
    if (!w) return 0;
    for (size_t i = 0; i < nw; i++)
        w[i] = be ? (wchar_t)((b[i * 2] << 8) | b[i * 2 + 1])
                  : (wchar_t)((b[i * 2 + 1] << 8) | b[i * 2]);
    w[nw] = 0;
    int ok = wide_to_u8n(w, (int)lstrlenW(w), out, outsz);
    free(w);
    return ok;
}
/* ID3v2 文本帧解码（enc: 0=ANSI/GBK 1=UTF-16+BOM 2=UTF-16BE 3=UTF-8） */
static void id3_text_to_utf8(const unsigned char *d, size_t n, char *out, size_t outsz) {
    out[0] = 0;
    if (!n) return;
    unsigned char enc = d[0];
    d++; n--;
    while (n && (d[n - 1] == 0)) n--;                       /* 去尾 NUL */
    if (!n) return;
    if (enc == 1 || enc == 2) {
        utf16_bytes_to_utf8(d, n, enc == 2, out, outsz);
        return;
    }
    if (enc == 3) {
        size_t m = (n < outsz - 1) ? n : outsz - 1;
        memcpy(out, d, m); out[m] = 0;
        return;
    }
    /* enc 0：本地 ANSI（本机 936），失败退 UTF-8 原样 */
    int wlen = MultiByteToWideChar(936, 0, (const char *)d, (int)n, NULL, 0);
    if (wlen <= 0) {
        size_t m = (n < outsz - 1) ? n : outsz - 1;
        memcpy(out, d, m); out[m] = 0;
        return;
    }
    wchar_t *w = (wchar_t *)malloc((size_t)(wlen + 1) * sizeof(wchar_t));
    if (!w) return;
    MultiByteToWideChar(936, 0, (const char *)d, (int)n, w, wlen);
    w[wlen] = 0;
    wide_to_u8n(w, wlen, out, outsz);
    free(w);
}
/* RIFF LIST INFO 字符串解码：裸文本（无 ID3 编码字节），先严格 UTF-8、失败按本机 ANSI/GBK */
static void info_text_to_utf8(const unsigned char *d, size_t n, char *out, size_t outsz) {
    out[0] = 0;
    while (n && d[n - 1] == 0) n--;
    if (!n) return;
    UINT cp = CP_UTF8;
    int ulen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)d, (int)n, NULL, 0);
    if (ulen <= 0) {
        cp = 936;
        ulen = MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, (const char *)d, (int)n, NULL, 0);
    }
    if (ulen <= 0) {
        size_t m = (n < outsz - 1) ? n : outsz - 1;
        memcpy(out, d, m); out[m] = 0;
        return;
    }
    wchar_t *w = (wchar_t *)malloc((size_t)(ulen + 1) * sizeof(wchar_t));
    if (!w) return;
    MultiByteToWideChar(cp, 0, (const char *)d, (int)n, w, ulen);
    w[ulen] = 0;
    wide_to_u8n(w, ulen, out, outsz);
    free(w);
}
/* 解析 ID3v2 (v2.3/v2.4) 标签体，取 TPE1/TIT2 */
static int parse_id3v2(const unsigned char *t, size_t len,
                       char *artist, size_t asz, char *title, size_t tsz) {
    if (len < 10 || t[0] != 'I' || t[1] != 'D' || t[2] != '3') return 0;
    int ver = t[3];
    if (ver < 3 || ver > 4) return 0;
    size_t size = ((size_t)t[6] << 24) | ((size_t)t[7] << 16) | ((size_t)t[8] << 8) | t[9];
    if (ver == 4)   /* v2.4 与部分 v2.3 写入方使用 syncsafe */
        size = (((size_t)t[6] & 0x7F) << 21) | (((size_t)t[7] & 0x7F) << 14) |
               (((size_t)t[8] & 0x7F) << 7) | ((size_t)t[9] & 0x7F);
    else if (size > len - 10)
        size = (((size_t)t[6] & 0x7F) << 21) | (((size_t)t[7] & 0x7F) << 14) |
               (((size_t)t[8] & 0x7F) << 7) | ((size_t)t[9] & 0x7F);
    if (size > len - 10) size = len - 10;
    size_t pos = 10, end = 10 + size;
    while (pos + 10 <= end) {
        const unsigned char *id = t + pos;
        int okid = 1;
        for (int k = 0; k < 4; k++) {
            unsigned char c = id[k];
            if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) { okid = 0; break; }
        }
        if (!okid) break;
        size_t fsize = ((size_t)t[pos + 4] << 24) | ((size_t)t[pos + 5] << 16) |
                       ((size_t)t[pos + 6] << 8) | (size_t)t[pos + 7];
        if (ver == 4)
            fsize = (((size_t)t[pos + 4] & 0x7F) << 21) | (((size_t)t[pos + 5] & 0x7F) << 14) |
                    (((size_t)t[pos + 6] & 0x7F) << 7) | ((size_t)t[pos + 7] & 0x7F);
        if (fsize == 0 || pos + 10 + fsize > end) break;
        const unsigned char *data = t + pos + 10;
        if (id[0] == 'T') {
            if (id[1] == 'P' && id[2] == 'E' && id[3] == '1' && !artist[0])
                id3_text_to_utf8(data, fsize, artist, asz);
            else if (id[1] == 'I' && id[2] == 'T' && id[3] == '2' && !title[0])
                id3_text_to_utf8(data, fsize, title, tsz);
        }
        pos += 10 + fsize;
    }
    return artist[0] || title[0];
}
/* 修剪路径尾部误吞的垃圾（ttbl 路径后紧跟的 dword 字节），只保留已知音频扩展名 */
static void trim_known_audio_ext(wchar_t *pathW) {
    static const wchar_t *exts[] = { L".wav", L".mp3", L".flac", L".ape", L".wma",
        L".ogg", L".m4a", L".aac", L".tak", L".tta", L".wv", L".ofr", L".dsf", L".dff", NULL };
    int n = lstrlenW(pathW);
    for (int i = n - 1; i > 0; i--) {
        if (pathW[i] != L'.') continue;
        for (int e = 0; exts[e]; e++) {
            int el = lstrlenW(exts[e]);
            if (n - i >= el) {
                int match = 1;
                for (int k = 0; k < el; k++) {
                    wchar_t a = pathW[i + k], b = exts[e][k];
                    if (a >= L'A' && a <= L'Z') a = (wchar_t)(a + 32);
                    if (a != b) { match = 0; break; }
                }
                if (match) { pathW[i + el] = 0; return; }
            }
        }
    }
}
/* 读文件内嵌标签。返回 1=拿到歌手或标题 */
static int read_tag_from_file_w(const wchar_t *pathW,
                                char *artist, size_t asz, char *title, size_t tsz) {
    artist[0] = 0; title[0] = 0;
    HANDLE f = CreateFileW(pathW, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return 0;
    LARGE_INTEGER li;
    if (!GetFileSizeEx(f, &li) || li.QuadPart < 16) { CloseHandle(f); return 0; }
    long long fsize = li.QuadPart;
    unsigned char hdr[512];
    DWORD got = 0;
    ReadFile(f, hdr, sizeof(hdr), &got, NULL);
    int isRiff = (got >= 16 && !memcmp(hdr, "RIFF", 4) && !memcmp(hdr + 8, "WAVE", 4));
    int ok = 0;
    if (isRiff) {
        long long pos = 12;
        for (int ci = 0; ci < 64 && pos + 8 < fsize; ci++) {
            unsigned char ch[8];
            DWORD r = 0;
            LARGE_INTEGER sq; sq.QuadPart = pos;
            if (!SetFilePointerEx(f, sq, NULL, FILE_BEGIN)) break;
            if (!ReadFile(f, ch, 8, &r, NULL) || r != 8) break;
            long long csz = (long long)((unsigned)ch[4] | ((unsigned)ch[5] << 8) |
                                        ((unsigned)ch[6] << 16) | ((unsigned)ch[7] << 24));
            if (pos + 8 + csz > fsize) break;
            if (!memcmp(ch, "id3 ", 4) && csz > 10 && csz <= 1024 * 1024) {
                unsigned char *body = (unsigned char *)malloc((size_t)csz);
                if (body) {
                    if (ReadFile(f, body, (DWORD)csz, &r, NULL) && r == (DWORD)csz)
                        ok |= parse_id3v2(body, (size_t)csz, artist, asz, title, tsz);
                    free(body);
                }
            } else if (!memcmp(ch, "LIST", 4) && csz > 12 && csz <= 65536) {
                unsigned char *body = (unsigned char *)malloc((size_t)csz);
                if (body) {
                    if (ReadFile(f, body, (DWORD)csz, &r, NULL) && r == (DWORD)csz &&
                        !memcmp(body, "INFO", 4)) {
                        size_t p = 4;
                        while (p + 8 <= (size_t)csz) {
                            size_t ssz = (size_t)body[p + 4] | ((size_t)body[p + 5] << 8) |
                                         ((size_t)body[p + 6] << 16) | ((size_t)body[p + 7] << 24);
                            if (p + 8 + ssz > (size_t)csz) break;
                            if (!memcmp(body + p, "IART", 4) && !artist[0])
                                info_text_to_utf8(body + p + 8, ssz, artist, asz);
                            else if (!memcmp(body + p, "INAM", 4) && !title[0])
                                info_text_to_utf8(body + p + 8, ssz, title, tsz);
                            p += 8 + ssz + (ssz & 1);
                        }
                        ok |= artist[0] || title[0];
                    }
                    free(body);
                }
            }
            if (artist[0] && title[0]) break;   /* 都拿到就不用再翻 */
            pos += 8 + csz + (csz & 1);
        }
    } else if (got >= 10 && !memcmp(hdr, "ID3", 3)) {
        /* MP3 等：头部 ID3v2（可能超过 512 字节，按头里声明的大小整读） */
        size_t tsz2 = ((size_t)hdr[6] << 21) | ((size_t)hdr[7] << 14) |
                      ((size_t)hdr[8] << 7) | (size_t)hdr[9];
        tsz2 += 10;
        if (tsz2 <= 1024 * 1024 && (long long)tsz2 <= fsize) {
            unsigned char *body = (unsigned char *)malloc(tsz2);
            if (body) {
                LARGE_INTEGER sq; sq.QuadPart = 0;
                SetFilePointerEx(f, sq, NULL, FILE_BEGIN);
                DWORD r = 0;
                if (ReadFile(f, body, (DWORD)tsz2, &r, NULL) && r == (DWORD)tsz2)
                    ok |= parse_id3v2(body, tsz2, artist, asz, title, tsz);
                free(body);
            }
        }
    }
    if (!artist[0] || !title[0]) {
        /* 尾部：RIFF 'id3 ' chunk / 裸 ID3v2 / ID3v1 */
        DWORD tlen = 262144;
        if ((long long)tlen > fsize) tlen = (DWORD)fsize;
        unsigned char *tail = (unsigned char *)malloc(tlen);
        if (tail) {
            LARGE_INTEGER sq; sq.QuadPart = fsize - tlen;
            DWORD r = 0;
            if (SetFilePointerEx(f, sq, NULL, FILE_BEGIN) && ReadFile(f, tail, tlen, &r, NULL) && r > 16) {
                for (long long p = (long long)r - 16; p >= 0; p--) {
                    if (!memcmp(tail + p, "id3 ", 4)) {
                        size_t csz = (size_t)tail[p + 4] | ((size_t)tail[p + 5] << 8) |
                                     ((size_t)tail[p + 6] << 16) | ((size_t)tail[p + 7] << 24);
                        if (csz > 10 && csz <= 1024 * 1024 && (size_t)p + 8 + csz <= (size_t)r &&
                            !memcmp(tail + p + 8, "ID3", 3)) {
                            ok |= parse_id3v2(tail + p + 8, csz, artist, asz, title, tsz);
                            break;
                        }
                    }
                }
                if (r >= 128 && !memcmp(tail + r - 128, "TAG", 3) && !artist[0]) {
                    const unsigned char *t1 = tail + r - 128 + 3;
                    info_text_to_utf8(t1 + 30, 30, artist, asz);   /* ID3v1: 30 标题 + 30 歌手，裸文本 */
                    for (char *q = artist; *q; q++) if (*q < 0x20) { *q = 0; break; }
                }
            }
            free(tail);
        }
    }
    CloseHandle(f);
    return ok;
}

static void playlist_folder_to_artist(const char *folderUtf8, char *out, size_t sz) {
    const char *leaf = strrchr(folderUtf8, '\\');
    leaf = leaf ? leaf + 1 : folderUtf8;
    char t[256];
    _snprintf(t, sizeof(t), "%s", leaf);
    t2s_utf8(t, out, (int)sz);
    /* 反复剥掉目录名里常见的非歌手后缀 */
    static const char *suffixes[] = {
        "无损合集", "无损音乐", "无损", "合集", "音乐", "歌曲", "精选", "全集",
        "专辑", "歌单", "的歌", "高清", "ktv", "mv", "songs", "music", "cd",
        "wav", "mp3", "flac", "ape", "wma", NULL
    };
    int changed = 1;
    while (changed) {
        changed = 0;
        size_t l = strlen(out);
        for (int i = 0; suffixes[i]; i++) {
            size_t sl = strlen(suffixes[i]);
            if (l > sl && _strnicmp(out + l - sl, suffixes[i], sl) == 0) {
                out[l - sl] = 0;
                changed = 1;
                break;
            }
        }
    }
    size_t l = strlen(out);
    while (l && (out[l - 1] == ' ' || out[l - 1] == '-')) out[--l] = 0;
    if (l < 2) out[0] = 0;      /* 剥完不剩有效内容则放弃 */
}
/* 反查 + 读标签。out=歌手（标签优先，文件夹兜底），tagTitle=文件标签里的标题（可能比文件名标题更准） */
static void guess_artist_from_playlist(const char *hostT, const char *cleanT,
                                       char *out, size_t sz,
                                       char *tagTitle, size_t tsz) {
    out[0] = 0;
    tagTitle[0] = 0;
    char dir[MAX_PATH], pat[MAX_PATH];
    /* 部署位 AddIn\ttp_lrcsh.dll → ..\PlayList；源码位 lyrics-server → ..\..\PlayList */
    WIN32_FIND_DATAA fd;
    HANDLE h;
    _snprintf(dir, sizeof(dir), "%s\\..\\PlayList", g_dir);
    _snprintf(pat, sizeof(pat), "%s\\*.ttbl", dir);
    h = FindFirstFileA(pat, &fd);
    if (h == INVALID_HANDLE_VALUE) {
        _snprintf(dir, sizeof(dir), "%s\\..\\..\\PlayList", g_dir);
        _snprintf(pat, sizeof(pat), "%s\\*.ttbl", dir);
        h = FindFirstFileA(pat, &fd);
    }
    if (h == INVALID_HANDLE_VALUE) return;
    char hKey[160], cKey[160];
    norm_key(hostT, hKey, sizeof(hKey));
    norm_key(cleanT, cKey, sizeof(cKey));
    char best[160], tagTitleBest[256], folderBest[160];
    best[0] = 0; tagTitleBest[0] = 0; folderBest[0] = 0;
    int opened = 0;
    do {
        char full[MAX_PATH];
        _snprintf(full, sizeof(full), "%s\\%s", dir, fd.cFileName);
        HANDLE f = CreateFileA(full, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               NULL, OPEN_EXISTING, 0, NULL);
        if (f == INVALID_HANDLE_VALUE) continue;
        DWORD size = GetFileSize(f, NULL), got = 0;
        if (size == INVALID_FILE_SIZE || size < 4 || size > 8 * 1024 * 1024) { CloseHandle(f); continue; }
        char *buf = (char *)malloc(size);
        if (!buf) { CloseHandle(f); continue; }
        if (!ReadFile(f, buf, size, &got, NULL) || got < 4) { free(buf); CloseHandle(f); continue; }
        CloseHandle(f);
        wchar_t *w = (wchar_t *)buf;
        int wn = (int)(got / 2);
        for (int i = 0; i + 3 < wn && !best[0]; i++) {
            if (!((w[i] >= L'A' && w[i] <= L'Z') && w[i + 1] == L':' && w[i + 2] == L'\\'))
                continue;
            int j = i + 3;
            while (j < wn && j - i < 300 && w[j] >= 0x20 && w[j] != 0xFFFD) j++;
            int plen = j - i;
            if (plen < 6) { if (j > i + 1) i = j - 1; continue; }
            wchar_t pathW[320];
            memcpy(pathW, w + i, (size_t)plen * sizeof(wchar_t));
            pathW[plen] = 0;
            int slash = -1, dot = -1;
            for (int k = plen - 1; k >= 0; k--)
                if (pathW[k] == L'\\') { slash = k; break; }
            if (slash > 0) {
                for (int k = plen - 1; k > slash; k--)
                    if (pathW[k] == L'.') { dot = k; break; }
            }
            if (slash > 0 && dot > slash + 1) {
                char base[256], folder[256];
                wide_to_u8n(pathW + slash + 1, dot - slash - 1, base, sizeof(base));
                wide_to_u8n(pathW, slash, folder, sizeof(folder));
                char bKey[160];
                norm_key(base, bKey, sizeof(bKey));
                if (bKey[0] &&
                    (!strcmp(bKey, hKey) || (cKey[0] && !strcmp(bKey, cKey)))) {
                    /* 命中播放列表条目：优先读文件内嵌标签（歌曲信息里那份），文件夹名兜底 */
                    if (!folderBest[0]) _snprintf(folderBest, sizeof(folderBest), "%s", folder);
                    if (opened < 4) {
                        opened++;
                        trim_known_audio_ext(pathW);
                        char ta[160], tt[256];
                        if (read_tag_from_file_w(pathW, ta, sizeof(ta), tt, sizeof(tt)) && ta[0]) {
                            _snprintf(best, sizeof(best), "%s", ta);
                            if (tt[0]) _snprintf(tagTitleBest, sizeof(tagTitleBest), "%s", tt);
                            log_msg("播放列表反查→文件标签: 歌手「%s」标题「%s」(%ls)",
                                    best, tt[0] ? tt : "-", pathW);
                        }
                    }
                }
            }
            if (j > i + 1) i = j - 1;
        }
        free(buf);
    } while (FindNextFileA(h, &fd) && !best[0]);
    FindClose(h);
    if (!best[0] && folderBest[0]) {
        playlist_folder_to_artist(folderBest, best, sizeof(best));
        if (best[0]) log_msg("播放列表反查→文件夹猜测歌手: 「%s」", best);
    }
    if (best[0]) _snprintf(out, sz, "%s", best);
    if (tagTitleBest[0]) _snprintf(tagTitle, tsz, "%s", tagTitleBest);
}

/* ================= 音源客户端 ================= */
typedef struct {
    char platform[8];
    char key1[160];
    char key2[160];
    char artist[128];
    char title[128];
    int  score;      /* 最终得分（排序用） */
    int  hits;       /* 跨源/跨变体命中次数（共识加分） */
} SongItem;

/* 一次搜索的查询变体：(歌手, 歌名)；歌手可为空 */
typedef struct { char artist[160]; char title[160]; } QueryVar;

static int add_var(QueryVar *vars, int *nv, int max, const char *a, const char *t) {
    if (!t || !t[0] || *nv >= max) return 0;
    for (int i = 0; i < *nv; i++)
        if (!strcmp(vars[i].artist, a ? a : "") && !strcmp(vars[i].title, t)) return 0;
    _snprintf(vars[*nv].artist, sizeof(vars[*nv].artist), "%s", a ? a : "");
    _snprintf(vars[*nv].title, sizeof(vars[*nv].title), "%s", t);
    (*nv)++;
    return 1;
}

static void mk_keyword(const char *artist, const char *title, char *out, size_t sz) {
    _snprintf(out, sz, "%s %s", artist ? artist : "", title ? title : "");
    char *w = out, *r = out; int sp = 0;
    while (*r) {
        if (*r == ' ') { if (!sp) *w++ = ' '; sp = 1; }
        else { *w++ = *r; sp = 0; }
        r++;
    }
    *w = 0;
    size_t l = strlen(out);
    while (l && out[l - 1] == ' ') out[--l] = 0;
}

/* 变体歌手与结果歌手一致时给的加分（在解析处预记，评分阶段合并） */
static int variant_artist_bonus(const char *varArtist, const char *resArtist) {
    if (!varArtist[0] || !resArtist[0]) return 0;
    char va[160], ra[160];
    norm_key(varArtist, va, sizeof(va));
    norm_key(resArtist, ra, sizeof(ra));
    if (!va[0] || !ra[0]) return 0;
    if (!strcmp(va, ra)) return 150;
    if (strstr(ra, va) || strstr(va, ra)) return 80;
    return 0;
}

static int qq_search(const QueryVar *vars, int nvars, SongItem *items, int max) {
    int n = 0, lastSt = 0;
    for (int v = 0; v < nvars && n < max; v++) {
        char kw[512], kwenc[1024];
        mk_keyword(vars[v].artist, vars[v].title, kw, sizeof(kw));
        if (!kw[0]) continue;
        url_encode(kw, kwenc, sizeof(kwenc));
        char url[2048];
        _snprintf(url, sizeof(url),
            "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?_=%u&cv=4747474&ct=24&format=json"
            "&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0"
            "&g_tk_new_20200303=5381&g_tk=5381&hostUin=22126403&is_xml=0&key=%s",
            (unsigned)GetTickCount(), kwenc);
        Buf resp; buf_init(&resp);
        int st = http_get(url, "https://c.y.qq.com/", &resp);
        lastSt = st;
        int added = 0;
        if (st == 200 && resp.data) {
            Buf u8; buf_init(&u8);
            to_utf8_maybe_gbk(resp.data, resp.len, &u8);
            const char *arr = jdoc_array(u8.data ? u8.data : "", "itemlist");
            if (arr) {
                const char *e = jws(arr + 1);
                while (*e && *e != ']' && n < max) {
                    const char *oe = jskip(e);
                    if (*e == '{') {
                        SongItem it; memset(&it, 0, sizeof(it));
                        strcpy(it.platform, "QQ");
                        if (jget_str(e, oe, "mid", it.key1, sizeof(it.key1)) && it.key1[0]) {
                            jget_str(e, oe, "name", it.title, sizeof(it.title));
                            jget_str(e, oe, "singer", it.artist, sizeof(it.artist));
                            if (!it.title[0]) strcpy(it.title, vars[v].title);
                            if (!it.artist[0]) strcpy(it.artist, vars[v].artist);
                            it.score = variant_artist_bonus(vars[v].artist, it.artist);
                            items[n++] = it; added++;
                        }
                    }
                    e = jws(oe);
                    if (*e == ',') e = jws(e + 1);
                }
            }
            buf_free(&u8);
        }
        log_msg("QQ 变体[%s %s]: + %d 条 (HTTP %d)", vars[v].artist, vars[v].title, added, st);
        if (n >= 8) break;      /* 首个变体已足够，免多余请求 */
    }
    log_msg("QQ 搜索合计: %d 条 (末次 HTTP %d)", n, lastSt);
    return n;
}
static int qq_lyric(const SongItem *it, Buf *out) {
    char url[2048];
    _snprintf(url, sizeof(url),
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=%u&cv=4747474&ct=24&format=json"
        "&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0"
        "&g_tk_new_20200303=5381&g_tk=5381&loginUin=0&songmid=%s",
        (unsigned)GetTickCount(), it->key1);
    Buf resp; buf_init(&resp);
    int st = http_get(url, "https://c.y.qq.com/", &resp);
    int ok = 0;
    if (st == 200 && resp.data) {
        char b64[131072];
        if (jget_str(resp.data, resp.data + resp.len, "lyric", b64, sizeof(b64)) && b64[0]) {
            size_t cap = strlen(b64) * 3 / 4 + 16;
            unsigned char *raw = (unsigned char *)malloc(cap);
            if (raw) {
                int rl = b64_decode(b64, raw, cap);
                if (rl > 0) {
                    Buf u8; buf_init(&u8);
                    to_utf8_maybe_gbk((const char *)raw, (size_t)rl, &u8);
                    if (u8.data) { buf_add(out, u8.data, u8.len); ok = 1; }
                    buf_free(&u8);
                }
                free(raw);
            }
        }
    } else log_msg("QQ 歌词失败 HTTP %d", st);
    buf_free(&resp);
    return ok;
}
static int kg_search(const QueryVar *vars, int nvars, SongItem *items, int max) {
    int n = 0, lastSt = 0;
    for (int v = 0; v < nvars && n < max; v++) {
        char kw[512], kwenc[1024];
        mk_keyword(vars[v].artist, vars[v].title, kw, sizeof(kw));
        if (!kw[0]) continue;
        url_encode(kw, kwenc, sizeof(kwenc));
        char url[2048];
        _snprintf(url, sizeof(url),
            "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=%s&page=1&pagesize=20&showtype=1",
            kwenc);
        Buf resp; buf_init(&resp);
        int st = http_get(url, NULL, &resp);
        lastSt = st;
        int added = 0;
        if (st == 200 && resp.data) {
            Buf u8; buf_init(&u8);
            to_utf8_maybe_gbk(resp.data, resp.len, &u8);
            const char *arr = jdoc_array(u8.data ? u8.data : "", "info");
            if (!arr) arr = jdoc_array(u8.data ? u8.data : "", "lists");
            if (arr) {
                const char *e = jws(arr + 1);
                while (*e && *e != ']' && n < max) {
                    const char *oe = jskip(e);
                    if (*e == '{') {
                        SongItem it; memset(&it, 0, sizeof(it));
                        strcpy(it.platform, "KuGou");
                        if (jget_str(e, oe, "hash", it.key1, sizeof(it.key1)) && it.key1[0]) {
                            jget_str(e, oe, "album_audio_id", it.key2, sizeof(it.key2));
                            jget_str(e, oe, "songname", it.title, sizeof(it.title));
                            jget_str(e, oe, "singername", it.artist, sizeof(it.artist));
                            if (!it.title[0]) strcpy(it.title, vars[v].title);
                            if (!it.artist[0]) strcpy(it.artist, vars[v].artist);
                            it.score = variant_artist_bonus(vars[v].artist, it.artist);
                            items[n++] = it; added++;
                        }
                    }
                    e = jws(oe);
                    if (*e == ',') e = jws(e + 1);
                }
            }
            buf_free(&u8);
        }
        log_msg("酷狗 变体[%s %s]: + %d 条 (HTTP %d)", vars[v].artist, vars[v].title, added, st);
        if (n >= 8) break;
    }
    log_msg("酷狗 搜索合计: %d 条 (末次 HTTP %d)", n, lastSt);
    return n;
}
static int kg_lyric(const SongItem *it, Buf *out) {
    char url[2048];
    _snprintf(url, sizeof(url),
        "http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=%s&album_audio_id=%s",
        it->key1, it->key2);
    Buf resp; buf_init(&resp);
    int st = http_get(url, NULL, &resp);
    int ok = 0;
    if (st == 200 && resp.data) {
        const char *arr = jdoc_array(resp.data, "candidates");
        if (arr) {
            /* 逐个候选尝试（首个可能缺 accesskey 或下载失败），最多 3 个 */
            const char *e = jws(arr + 1);
            for (int ci = 0; *e && *e != ']' && ci < 3 && !ok; ci++) {
                const char *oe = jskip(e);
                if (*e == '{') {
                    char cid[64], akey[160];
                    if (jget_str(e, oe, "id", cid, sizeof(cid)) &&
                        jget_str(e, oe, "accesskey", akey, sizeof(akey)) && cid[0] && akey[0]) {
                        char durl[2048];
                        _snprintf(durl, sizeof(durl),
                            "http://lyrics.kugou.com/download?ver=1&client=pc&id=%s&accesskey=%s&fmt=lrc&charset=utf8",
                            cid, akey);
                        Buf d; buf_init(&d);
                        int ds = http_get(durl, NULL, &d);
                        if (ds == 200 && d.data) {
                            char b64[131072];
                            if (jget_str(d.data, d.data + d.len, "content", b64, sizeof(b64)) && b64[0]) {
                                size_t cap = strlen(b64) * 3 / 4 + 16;
                                unsigned char *raw = (unsigned char *)malloc(cap);
                                if (raw) {
                                    int rl = b64_decode(b64, raw, cap);
                                    if (rl > 0) {
                                        Buf u8; buf_init(&u8);
                                        to_utf8_maybe_gbk((const char *)raw, (size_t)rl, &u8);
                                        if (u8.data) { buf_add(out, u8.data, u8.len); ok = 1; }
                                        buf_free(&u8);
                                    }
                                    free(raw);
                                }
                            }
                        } else log_msg("酷狗歌词下载失败 HTTP %d (候选%d)", ds, ci);
                        buf_free(&d);
                    }
                }
                e = jws(oe);
                if (*e == ',') e = jws(e + 1);
            }
        }
    } else log_msg("酷狗候选查询失败 HTTP %d (body %u)", st, resp.len);
    if (resp.len > 0 && resp.len < 300) log_msg("酷狗候选响应: %s", resp.data);
    buf_free(&resp);
    return ok;
}

/* ---- 网易云音源（2026-10-24 curl 实测全链路可用，作为酷狗之外的兜底） ---- */
static int ne_search(const QueryVar *vars, int nvars, SongItem *items, int max) {
    int n = 0, lastSt = 0;
    for (int v = 0; v < nvars && n < max; v++) {
        char kw[512], kwenc[1024];
        mk_keyword(vars[v].artist, vars[v].title, kw, sizeof(kw));
        if (!kw[0]) continue;
        url_encode(kw, kwenc, sizeof(kwenc));
        char url[2048];
        _snprintf(url, sizeof(url),
            "https://music.163.com/api/search/get?s=%s&type=1&limit=8&offset=0", kwenc);
        Buf resp; buf_init(&resp);
        int st = http_get(url, "https://music.163.com/", &resp);
        lastSt = st;
        int added = 0;
        if (st == 200 && resp.data) {
            Buf u8; buf_init(&u8);
            to_utf8_maybe_gbk(resp.data, resp.len, &u8);
            const char *arr = jdoc_array(u8.data ? u8.data : "", "songs");
            if (arr) {
                const char *e = jws(arr + 1);
                while (*e && *e != ']' && n < max) {
                    const char *oe = jskip(e);
                    if (*e == '{') {
                        SongItem it; memset(&it, 0, sizeof(it));
                        strcpy(it.platform, "Netease");
                        /* 歌曲自身 id 是数字；jfind 平铺扫描，嵌套 album.id 会被整体跳过 */
                        const char *idv = jfind(e, oe, "id");
                        if (idv && *idv >= '0' && *idv <= '9') {
                            int k = 0;
                            while (idv[k] >= '0' && idv[k] <= '9' && k < 15) { it.key1[k] = idv[k]; k++; }
                            it.key1[k] = 0;
                        }
                        jget_str(e, oe, "name", it.title, sizeof(it.title));
                        /* artists[0].name */
                        const char *arts = jfind(e, oe, "artists");
                        if (arts && *arts == '[') {
                            const char *a0 = jws(arts + 1);
                            if (*a0 == '{') jget_str(a0, jskip(a0), "name", it.artist, sizeof(it.artist));
                        }
                        if (it.key1[0] && it.title[0]) {
                            if (!it.artist[0]) strcpy(it.artist, vars[v].artist);
                            it.score = variant_artist_bonus(vars[v].artist, it.artist);
                            items[n++] = it; added++;
                        }
                    }
                    e = jws(oe);
                    if (*e == ',') e = jws(e + 1);
                }
            }
            buf_free(&u8);
        }
        log_msg("网易 变体[%s %s]: + %d 条 (HTTP %d)", vars[v].artist, vars[v].title, added, st);
        if (n >= 8) break;
    }
    log_msg("网易 搜索合计: %d 条 (末次 HTTP %d)", n, lastSt);
    return n;
}
static int ne_lyric(const SongItem *it, Buf *out) {
    char url[2048];
    _snprintf(url, sizeof(url),
        "https://music.163.com/api/song/lyric?id=%s&lv=1&kv=1&tv=-1", it->key1);
    Buf resp; buf_init(&resp);
    int st = http_get(url, "https://music.163.com/", &resp);
    int ok = 0;
    if (st == 200 && resp.data) {
        /* {"lrc":{"version":70,"lyric":"[00:00.000] ..."},"uncollected":true?} */
        const char *lrcobj = jfind(resp.data, resp.data + resp.len, "lrc");
        if (lrcobj && *lrcobj == '{') {
            char lrc[131072];
            if (jget_str(lrcobj, jskip(lrcobj), "lyric", lrc, sizeof(lrc)) && lrc[0]) {
                buf_add(out, lrc, strlen(lrc));
                ok = 1;
            }
        }
    } else log_msg("网易歌词失败 HTTP %d", st);
    buf_free(&resp);
    return ok;
}

/* ================= 引擎对象 ================= */
typedef struct Engine {
    void **vtbl;
    LONG  ref;
    int   mode;
    CRITICAL_SECTION cs;
    HANDLE work;        /* 命令事件 */
    HANDLE started;     /* 线程启动事件 */
    HANDLE thread;
    volatile LONG cmd;  /* 1=搜索 2=下载 3=退出 */
    volatile LONG stop;
    /* 宿主回调（QI 自宿主中级接口） */
    void *cbIface;
    /* 当前歌曲 */
    char curArtist[256];
    char curTitle[256];
    char lastArtist[160];   /* 本次搜索实际采用的歌手（宿主/标签/文件夹猜测），下载回退时用于过滤 */
    char lastTitleKey[160]; /* 清洗后歌名的比较键，下载回退时须同歌手且歌名相关 */
    /* 结果集 */
    SongItem items[MAX_ITEMS];
    int itemCount;
    int selected;
    char serverName[128];
    char serverUrl[128];
} Engine;

/* ---- 引擎内部逻辑 ---- */
static wchar_t *dup_wide_from_utf8(const char *s) {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (wlen <= 0) wlen = 1;
    wchar_t *w = (wchar_t *)CoTaskMemAlloc((size_t)wlen * sizeof(wchar_t));
    if (!w) return NULL;
    MultiByteToWideChar(CP_UTF8, 0, s, -1, w, wlen);
    return w;
}

/* 合并去重 + 评分 + 降序排序，返回保留条数（≤maxOut）。
   评分：宿主歌手匹配 > 歌名匹配（全名 > 去括号名）> 变体歌手预加分 > 跨源共识 > 音源微调。
   宿主拿到列表后自行挑选（观测为取第一个标题匹配项），本排序决定自动挑选的命中面。 */
static int rank_results(SongItem *raw, int n, const char *expArtist,
                        const char *expTitleFull, const char *expTitleShort,
                        const char *expTitleTag,
                        SongItem *out, int maxOut) {
    char eA[256], eT1[256], eT2[256], eT3[256];
    norm_key(expArtist, eA, sizeof(eA));
    norm_key(expTitleFull, eT1, sizeof(eT1));
    norm_key(expTitleShort, eT2, sizeof(eT2));
    if (expTitleTag) norm_key(expTitleTag, eT3, sizeof(eT3)); else eT3[0] = 0;

    int m = 0;
    for (int i = 0; i < n; i++) {
        if (!raw[i].title[0]) continue;
        char ka[160], kt[160];
        norm_key(raw[i].artist, ka, sizeof(ka));
        norm_key(raw[i].title, kt, sizeof(kt));
        if (!kt[0]) continue;                       /* 没有歌名的结果无从匹配 */
        int found = -1;
        for (int j = 0; j < m; j++) {
            char ja[160], jt[160];
            norm_key(out[j].artist, ja, sizeof(ja));
            norm_key(out[j].title, jt, sizeof(jt));
            int sameArtist = (ja[0] && ka[0]) ? (!strcmp(ja, ka)) : (!ja[0] && !ka[0]);
            if (sameArtist && !strcmp(jt, kt)) { found = j; break; }
        }
        if (found >= 0) { out[found].hits++; continue; }   /* 同曲：跨源/跨变体共识 */
        if (m >= maxOut) continue;
        raw[i].hits = 1;
        out[m++] = raw[i];
    }
    for (int j = 0; j < m; j++) {
        char ja[160], jt[160];
        norm_key(out[j].artist, ja, sizeof(ja));
        norm_key(out[j].title, jt, sizeof(jt));
        int s = out[j].score;                        /* 变体歌手预加分 */
        if (eA[0] && ja[0]) {
            if (!strcmp(ja, eA)) s += 200;           /* 歌手精确匹配 */
            else if (strstr(ja, eA) || strstr(eA, ja)) s += 80;
        }
        if (jt[0]) {
            /* 歌名精确匹配是决定性权重：必须压过 Live/翻唱版的跨源共识加分 */
            if (eT1[0] && !strcmp(jt, eT1)) s += 500;
            else if (eT2[0] && !strcmp(jt, eT2)) s += 480;
            else if (eT3[0] && !strcmp(jt, eT3)) s += 460;
            else if (eT1[0] && (strstr(jt, eT1) || strstr(eT1, jt))) s += 120;
            else if (eT2[0] && (strstr(jt, eT2) || strstr(eT2, jt))) s += 110;
        }
        s += out[j].hits * 40;                        /* 多个音源都返回这首 */
        s += (out[j].platform[0] == 'Q') ? 3 : (out[j].platform[0] == 'K') ? 2 : 1;
        out[j].score = s;
    }
    for (int i = 0; i < m; i++) {                     /* 选择排序，分数降序 */
        int best = i;
        for (int j = i + 1; j < m; j++)
            if (out[j].score > out[best].score) best = j;
        if (best != i) { SongItem t = out[i]; out[i] = out[best]; out[best] = t; }
    }
    for (int i = 0; i < m && i < 6; i++)
        log_msg("  排名#%d [%d分 %d源] %s - %s (%s)",
                i + 1, out[i].score, out[i].hits, out[i].artist, out[i].title, out[i].platform);
    return m;
}

static void engine_do_search(Engine *e) {
    char hostA[256], hostT[256];
    EnterCriticalSection(&e->cs);
    memcpy(hostA, e->curArtist, sizeof(hostA));
    memcpy(hostT, e->curTitle, sizeof(hostT));
    LeaveCriticalSection(&e->cs);
    log_msg("搜索 歌手：%s  歌名：%s", hostA, hostT);

    char cleanT[256], t2sT[256], noParT[256];
    clean_title(hostT, cleanT, sizeof(cleanT));
    t2s_utf8(cleanT, t2sT, sizeof(t2sT));
    strip_parens_utf8(cleanT, noParT, sizeof(noParT));
    if (strcmp(cleanT, hostT)) log_msg("歌名清洗: 「%s」→「%s」", hostT, cleanT);

    /* 歌手来源优先级：宿主 > 文件内嵌标签（歌曲信息那份） > 文件夹名猜测 > 空 */
    char guessA[160], tagT[256], tagTc[256];
    guessA[0] = 0; tagT[0] = 0; tagTc[0] = 0;
    if (!hostA[0]) guess_artist_from_playlist(hostT, cleanT, guessA, sizeof(guessA),
                                              tagT, sizeof(tagT));
    const char *effArtist = hostA[0] ? hostA : guessA;
    if (tagT[0]) clean_title(tagT, tagTc, sizeof(tagTc));

    /* 查询变体：歌手+歌名（简/繁/去括号）；歌名内嵌歌手的剥除；"A - B" 双向拆分 */
    QueryVar vars[8];
    int nv = 0;
    memset(vars, 0, sizeof(vars));
    add_var(vars, &nv, 8, effArtist, cleanT);
    add_var(vars, &nv, 8, effArtist, t2sT);
    add_var(vars, &nv, 8, effArtist, noParT);
    if (tagTc[0]) add_var(vars, &nv, 8, effArtist, tagTc);   /* 标签标题往往比文件名标题准 */
    if (!effArtist[0] || (guessA[0] && !hostA[0]))
        add_var(vars, &nv, 8, "", cleanT);          /* 纯歌名兜底 */
    {
        char aNorm[160];
        norm_key(effArtist, aNorm, sizeof(aNorm));
        wchar_t *wt = NULL;
        if (aNorm[0] && u8_to_wide(cleanT, &wt)) {
            int lt = lstrlenW(wt);
            /* 前缀式：歌名以歌手开头，后跟 "-"（"示例歌手-07别人的天长地久"） */
            wchar_t *wa = NULL;
            if (u8_to_wide(effArtist, &wa)) {
                int lw = lstrlenW(wa);
                if (lw > 0 && lt > lw) {
                    int k = 0;
                    while (k < lw && wt[k] == wa[k]) k++;
                    if (k == lw) {
                        int s = k;
                        while (s < lt && (wt[s] == L' ' || wt[s] == 0x3000)) s++;
                        if (s < lt && (wt[s] == L'-' || wt[s] == 0x2013 || wt[s] == 0x2014)) {
                            s++;
                            while (s < lt && (wt[s] == L' ' || wt[s] == 0x3000)) s++;
                            if (s < lt) {
                                char rest[256];
                                wide_to_u8n(wt + s, lt - s, rest, sizeof(rest));
                                char restC[256];
                                clean_title(rest, restC, sizeof(restC));
                                if (add_var(vars, &nv, 8, effArtist, restC))
                                    log_msg("歌名内嵌歌手前缀: 「%s」→「%s」", cleanT, restC);
                            }
                        }
                    }
                }
                /* "A - B" 且一侧是/含歌手：保留另一侧当歌名 */
                int d = find_dash_split(wt);
                if (d > 0) {
                    int total = lt;
                    int ll = d, rs = d + 1;
                    while (ll > 0 && (wt[ll - 1] == L' ' || wt[ll - 1] == 0x3000)) ll--;
                    while (rs < total && (wt[rs] == L' ' || wt[rs] == 0x3000)) rs++;
                    if (ll > 0 && rs < total) {
                        char L[160] = "", R[160] = "";
                        wide_to_u8n(wt, ll, L, sizeof(L));
                        wide_to_u8n(wt + rs, total - rs, R, sizeof(R));
                        char ln[160], rn[160];
                        norm_key(L, ln, sizeof(ln));
                        norm_key(R, rn, sizeof(rn));
                        if (ln[0] && !strcmp(ln, aNorm)) add_var(vars, &nv, 8, effArtist, R);
                        else if (rn[0] && strstr(rn, aNorm)) add_var(vars, &nv, 8, effArtist, L);
                    }
                }
                free(wa);
            }
            free(wt);
        }
        /* 歌手为空且无猜测时：把 "A - B" 两种解释都当查询 */
        if (!effArtist[0]) {
            wchar_t *w = NULL;
            if (u8_to_wide(cleanT, &w)) {
                int d = find_dash_split(w);
                if (d > 0) {
                    int total = lstrlenW(w);
                    int ll = d, rs = d + 1;
                    while (ll > 0 && (w[ll - 1] == L' ' || w[ll - 1] == 0x3000)) ll--;
                    while (rs < total && (w[rs] == L' ' || w[rs] == 0x3000)) rs++;
                    if (ll > 0 && rs < total) {
                        char L[160] = "", R[160] = "";
                        wide_to_u8n(w, ll, L, sizeof(L));
                        wide_to_u8n(w + rs, total - rs, R, sizeof(R));
                        add_var(vars, &nv, 8, L, R);    /* 解释一：A 是歌手 */
                        add_var(vars, &nv, 8, R, L);    /* 解释二：B 是歌手 */
                        log_msg("歌名拆分候选: 「%s」/「%s」", L, R);
                    }
                }
                free(w);
            }
        }
    }
    log_msg("查询变体 %d 个", nv);

    SongItem raw[48], items[MAX_ITEMS];
    memset(raw, 0, sizeof(raw));
    memset(items, 0, sizeof(items));
    int n = 0;
    n += qq_search(vars, nv, raw + n, 12);
    n += kg_search(vars, nv, raw + n, 16);
    n += ne_search(vars, nv, raw + n, 12);

    int kept = rank_results(raw, n, effArtist, cleanT, noParT[0] ? noParT : cleanT,
                            tagTc[0] ? tagTc : NULL, items, MAX_ITEMS);
    log_msg("合并排序后 %d 条 (原始 %d 条)", kept, n);

    EnterCriticalSection(&e->cs);
    memcpy(e->items, items, sizeof(SongItem) * (size_t)kept);
    e->itemCount = kept;
    e->selected = -1;
    _snprintf(e->lastArtist, sizeof(e->lastArtist), "%s", effArtist);
    norm_key(cleanT, e->lastTitleKey, sizeof(e->lastTitleKey));
    LeaveCriticalSection(&e->cs);

    if (!e->cbIface) return;
    /* callback[3] (+0xc): (cb, count, wchar_t** artists, wchar_t** titles) */
    typedef HRESULT(__stdcall * cb_results_t)(void *, int, wchar_t **, wchar_t **);
    void **cbvt = *(void ***)e->cbIface;
    cb_results_t fn = (cb_results_t)cbvt[3];
    if (kept > 0) {
        wchar_t **arts = (wchar_t **)CoTaskMemAlloc(sizeof(wchar_t *) * (size_t)kept);
        wchar_t **ttls = (wchar_t **)CoTaskMemAlloc(sizeof(wchar_t *) * (size_t)kept);
        if (arts && ttls) {
            for (int i = 0; i < kept; i++) {
                arts[i] = dup_wide_from_utf8(items[i].artist);
                ttls[i] = dup_wide_from_utf8(items[i].title);
            }
            fn(e->cbIface, kept, arts, ttls);
            for (int i = 0; i < kept; i++) {
                if (arts[i]) CoTaskMemFree(arts[i]);
                if (ttls[i]) CoTaskMemFree(ttls[i]);
            }
        }
        if (arts) CoTaskMemFree(arts);
        if (ttls) CoTaskMemFree(ttls);
    } else {
        fn(e->cbIface, 0, NULL, NULL);
    }
}

/* 下载内容自检：歌词头部 [ti:] 与期望歌名相关性。完全不相关=不同歌=丢弃。
   无 [ti:]、空键、纯 ASCII 短键（缩写如 L.I.E）不判，放行。 */
static int lyric_title_related(const char *lrcUtf8, const char *expTitleKey) {
    if (!expTitleKey || !expTitleKey[0]) return 1;
    int expAscii = 1;
    for (const char *p = expTitleKey; *p; p++)
        if ((unsigned char)*p >= 0x80) { expAscii = 0; break; }
    if (expAscii && strlen(expTitleKey) <= 6) return 1;
    char ti[256] = "";
    const char *t = strstr(lrcUtf8, "[ti:");
    if (t && t - lrcUtf8 < 600) {
        t += 4;
        size_t i = 0;
        while (*t && *t != ']' && i + 1 < sizeof(ti)) ti[i++] = *t++;
        ti[i] = 0;
    }
    if (!ti[0]) return 1;
    char tk[256];
    norm_key(ti, tk, sizeof(tk));
    if (!tk[0]) return 1;
    if (strstr(tk, expTitleKey) || strstr(expTitleKey, tk)) return 1;
    /* 至少共享一个汉字才算相关（繁简已被 norm_key 归一） */
    for (const char *p = tk; *p; p += (unsigned char)*p >= 0x80 ? 3 : 1) {
        if ((unsigned char)*p < 0x80) continue;
        if (strlen(p) < 3) break;
        char one[4] = { p[0], p[1], p[2], 0 };
        if (strstr(expTitleKey, one)) return 1;
    }
    return 0;
}

static int fetch_lyric_for(const SongItem *it, Buf *lrc) {
    log_msg("取词尝试 %s %s - %s", it->platform, it->artist, it->title);
    if (!strcmp(it->platform, "QQ")) return qq_lyric(it, lrc);
    if (!strcmp(it->platform, "KuGou")) return kg_lyric(it, lrc);
    if (!strcmp(it->platform, "Netease")) return ne_lyric(it, lrc);
    return 0;
}

static void engine_do_download(Engine *e) {
    int idx = e->selected;
    SongItem snap[MAX_ITEMS];
    int cnt;
    char expA[160], expT[160];
    EnterCriticalSection(&e->cs);
    cnt = e->itemCount;
    memcpy(snap, e->items, sizeof(SongItem) * (size_t)cnt);
    _snprintf(expA, sizeof(expA), "%s", e->lastArtist);
    _snprintf(expT, sizeof(expT), "%s", e->lastTitleKey);
    LeaveCriticalSection(&e->cs);
    if (idx < 0 || idx >= cnt) {
        log_msg("下载失败：无有效选择");
        return;
    }
    /* 主选失败时按评分顺序回退到"同歌手且歌名相关"的其他结果（防串歌），最多共试 4 条 */
    char expKey[160];
    norm_key(expA, expKey, sizeof(expKey));
    int tried[MAX_ITEMS];
    memset(tried, 0, sizeof(tried));
    Buf lrc; buf_init(&lrc);
    int ok = 0, usedIdx = -1, cur = idx;
    for (int attempt = 0; attempt < 4 && cur >= 0 && cur < cnt && !ok; attempt++) {
        tried[cur] = 1;
        char ka[160], kt[160];
        norm_key(snap[cur].artist, ka, sizeof(ka));
        norm_key(snap[cur].title, kt, sizeof(kt));
        int artistOk = !expKey[0] || (ka[0] && strstr(ka, expKey));
        int titleOk = !expT[0] || (kt[0] && (strstr(kt, expT) || strstr(expT, kt)));
        int allowed = (attempt == 0) || (artistOk && titleOk);
        if (allowed) {
            buf_free(&lrc); buf_init(&lrc);
            if (fetch_lyric_for(&snap[cur], &lrc) && lrc.len > 0) {
                if (lyric_title_related(lrc.data, expT)) { ok = 1; usedIdx = cur; break; }
                log_msg("歌词标题不相关(#%d %s - %s)，丢弃", cur + 1, snap[cur].artist, snap[cur].title);
            } else if (attempt == 0) log_msg("主选(#%d)下载失败，开始同歌手回退", idx + 1);
        }
        int nx = -1;
        for (int k = 0; k < cnt; k++) if (!tried[k]) { nx = k; break; }
        cur = nx;
    }
    if (!ok || lrc.len == 0) {
        log_msg("下载失败（已含回退）%s %s - %s", snap[idx].platform, snap[idx].artist, snap[idx].title);
        buf_free(&lrc);
        return;
    }
    if (usedIdx != idx) log_msg("回退命中 #%d %s - %s", usedIdx + 1, snap[usedIdx].artist, snap[usedIdx].title);
    log_msg("下载成功 %u bytes", (unsigned)lrc.len);
    if (e->cbIface && lrc.data && lrc.len) {
        /* callback[4] (+0x10): (cb, 字符数, UTF-16LE 文本, s1, s2)
           实证（2026-10-24，从 TTPlayer 落盘的 .lrc 反推）：宿主把第三个参数按
           wchar_t* 解析 —— 传 UTF-8 字节流会被两两打包成汉字（[ti: → 楛㩤），
           且 len 按“宽字符个数”使用（会多读一倍字节，故缓冲多留余量）。 */
        int wlen = MultiByteToWideChar(CP_UTF8, 0, lrc.data, (int)lrc.len, NULL, 0);
        if (wlen > 0) {
            /* 尾部多留 64 个宽字符的 0，防御宿主可能的越界读 */
            wchar_t *wbuf = (wchar_t *)calloc((size_t)wlen + 64, sizeof(wchar_t));
            if (wbuf) {
                MultiByteToWideChar(CP_UTF8, 0, lrc.data, (int)lrc.len, wbuf, wlen);
                typedef HRESULT(__stdcall * cb_lyric_t)(void *, int, const wchar_t *, const wchar_t *, const wchar_t *);
                void **cbvt = *(void ***)e->cbIface;
                cb_lyric_t fn = (cb_lyric_t)cbvt[4];
                static const wchar_t empty[] = L"";
                fn(e->cbIface, wlen, wbuf, empty, empty);
                free(wbuf);
            } else log_msg("下载交付失败：内存不足");
        } else log_msg("下载交付失败：UTF-8→UTF-16 转换失败 (%d)", wlen);
    }
    buf_free(&lrc);
}

static DWORD WINAPI engine_worker(LPVOID param) {
    Engine *e = (Engine *)param;
    SetEvent(e->started);
    while (1) {
        WaitForSingleObject(e->work, INFINITE);
        ResetEvent(e->work);
        LONG cmd = InterlockedExchange(&e->cmd, 0);
        if (cmd == 3 || e->stop) break;
        if (cmd == 1) engine_do_search(e);
        else if (cmd == 2) engine_do_download(e);
    }
    /* 线程自毁式收尾：eng_release 只发信号不等待，本线程是引擎最后的持有者。
       模块已 PIN，即使宿主此刻 FreeLibrary 也不会卸载本 DLL，这里可以安全收尾。
       若正在网络操作中，引擎随本线程完成后自然回收，宿主线程不阻塞。 */
    CloseHandle(e->thread);
    CloseHandle(e->work);
    CloseHandle(e->started);
    if (e->cbIface) {
        typedef ULONG(__stdcall * rel_t)(void *);
        rel_t rel = (rel_t)(*(void ***)e->cbIface)[2];
        rel(e->cbIface);
    }
    DeleteCriticalSection(&e->cs);
    log_msg("工作线程退出");
    free(e);
    return 0;
}

/* ---- 引擎 COM 方法 ---- */
static HRESULT __stdcall eng_initialize(Engine *this, void *host, void *initData);
static HRESULT __stdcall eng_setsong(Engine *this, const wchar_t *artist, const wchar_t *title);
static HRESULT __stdcall eng_select(Engine *this, int index);
static HRESULT __stdcall eng_twostr(Engine *this, wchar_t **out1, wchar_t **out2);
static HRESULT __stdcall eng_dtor(Engine *this, BYTE flag);
static ULONG __stdcall eng_addref(Engine *this);

static HRESULT __stdcall eng_qi(Engine *this, REFIID riid, void **ppv) {
    if (!ppv) return E_POINTER;
    if (IsEqualGUID(riid, &IID_IUnknown_C) || IsEqualGUID(riid, &IID_Engine_C)) {
        *ppv = this;
        eng_addref(this);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG __stdcall eng_addref(Engine *this) {
    return (ULONG)InterlockedIncrement(&this->ref);
}
static ULONG __stdcall eng_release(Engine *this) {
    ULONG r = (ULONG)InterlockedDecrement(&this->ref);
    if (r == 0) {
        /* 只发退出信号、不等工作线程（本函数常在宿主 UI 线程调用，等待会把
           网络耗时变成界面卡顿）。引擎的句柄/回调/临界区由工作线程退出前自毁，
           见 engine_worker 尾部。 */
        InterlockedExchange(&this->stop, 1);
        InterlockedExchange(&this->cmd, 3);
        if (this->work) SetEvent(this->work);
    }
    return r;
}
static HRESULT __stdcall eng_initialize(Engine *this, void *host, void *initData) {
    (void)initData;
    if (!host) return E_INVALIDARG;
    /* 宿主 → QI(GUID_HOST) → QI(GUID_CB) 两级取回调（与原版一致） */
    typedef HRESULT(__stdcall * qi_t)(void *, REFIID, void **);
    void **hostvt = *(void ***)host;
    qi_t hostQI = (qi_t)hostvt[0];
    void *mid = NULL;
    HRESULT hr = hostQI(host, &IID_HostMid_C, &mid);
    if (hr < 0 || !mid) {
        log_msg("Initialize: 宿主无中级接口 hr=0x%08lx", (unsigned long)hr);
        return hr;
    }
    void **midvt = *(void ***)mid;
    qi_t midQI = (qi_t)midvt[0];
    hr = midQI(mid, &IID_Callback_C, &this->cbIface);
    typedef ULONG(__stdcall * rel_t)(void *);
    rel_t midRel = (rel_t)midvt[2];
    midRel(mid);
    if (hr < 0 || !this->cbIface) {
        log_msg("Initialize: 无歌词回调 hr=0x%08lx", (unsigned long)hr);
        return hr;
    }
    /* 启动工作线程 */
    this->work = CreateEventA(NULL, TRUE, FALSE, NULL);
    this->started = CreateEventA(NULL, TRUE, FALSE, NULL);
    if (!this->work || !this->started) return E_OUTOFMEMORY;
    this->thread = CreateThread(NULL, 0, engine_worker, this, 0, NULL);
    if (!this->thread) return E_OUTOFMEMORY;
    if (WaitForSingleObject(this->started, 5000) != WAIT_OBJECT_0) return E_FAIL;
    log_msg("Initialize 完成（回调已连接，工作线程就绪）");
    return S_OK;
}
static HRESULT __stdcall eng_setsong(Engine *this, const wchar_t *artist, const wchar_t *title) {
    if (!artist || !title) return E_INVALIDARG;
    EnterCriticalSection(&this->cs);
    WideCharToMultiByte(CP_UTF8, 0, artist, -1, this->curArtist, sizeof(this->curArtist), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, title, -1, this->curTitle, sizeof(this->curTitle), NULL, NULL);
    LeaveCriticalSection(&this->cs);
    InterlockedExchange(&this->cmd, 1);
    SetEvent(this->work);
    return S_OK;
}
static HRESULT __stdcall eng_select(Engine *this, int index) {
    if (index < 0) return E_INVALIDARG;
    EnterCriticalSection(&this->cs);
    int cnt = this->itemCount;
    LeaveCriticalSection(&this->cs);
    if (index >= cnt) return E_INVALIDARG;
    EnterCriticalSection(&this->cs);
    this->selected = index;
    LeaveCriticalSection(&this->cs);
    InterlockedExchange(&this->cmd, 2);
    SetEvent(this->work);
    return S_OK;
}
static HRESULT __stdcall eng_twostr(Engine *this, wchar_t **out1, wchar_t **out2) {
    (void)this;
    if (!out1 || !out2) return E_INVALIDARG;
    *out1 = dup_wide_from_utf8("本地歌词");
    *out2 = dup_wide_from_utf8("");
    return S_OK;
}
static HRESULT __stdcall eng_dtor(Engine *this, BYTE flag) {
    (void)flag;
    return S_OK;
}

static void *g_engine_vtbl[] = {
    (void *)eng_qi, (void *)eng_addref, (void *)eng_release,
    (void *)eng_initialize, (void *)eng_setsong, (void *)eng_select,
    (void *)eng_twostr, (void *)eng_dtor
};

/* ================= 歌词接口对象（12 字节） ================= */
typedef struct { void **vtbl; LONG mode; LONG ref; } Lyrics;

static HRESULT __stdcall lyr_qi(Lyrics *this, REFIID riid, void **ppv) {
    if (!ppv) return E_POINTER;
    if (IsEqualGUID(riid, &IID_IUnknown_C) || IsEqualGUID(riid, &IID_Lyrics_C)) {
        *ppv = this;
        InterlockedIncrement(&this->ref);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG __stdcall lyr_addref(Lyrics *this) { return (ULONG)InterlockedIncrement(&this->ref); }
static ULONG __stdcall lyr_release(Lyrics *this) {
    ULONG r = (ULONG)InterlockedDecrement(&this->ref);
    if (r == 0) free(this);
    return r;
}
static HRESULT __stdcall lyr_getengine(Lyrics *this, void **ppv) {
    if (!ppv) return E_INVALIDARG;
    Engine *e = (Engine *)calloc(1, sizeof(Engine));
    if (!e) return E_OUTOFMEMORY;
    e->vtbl = g_engine_vtbl;
    e->ref = 1;
    e->mode = (int)this->mode;
    e->selected = -1;
    InitializeCriticalSection(&e->cs);
    *ppv = e;   /* 等价于 QI(engine, GUID_E) 后 Release */
    return S_OK;
}
static HRESULT __stdcall lyr_getstr(Lyrics *this, void **out) {
    (void)this;
    if (!out) return E_INVALIDARG;
    *out = dup_wide_from_utf8("本地歌词");
    return S_OK;
}
static void *g_lyrics_vtbl[] = {
    (void *)lyr_qi, (void *)lyr_addref, (void *)lyr_release,
    (void *)lyr_getengine, (void *)lyr_getstr
};

/* ================= 工厂对象（8 字节） ================= */
typedef struct { void **vtbl; LONG ref; } Factory;

static HRESULT __stdcall fac_qi(Factory *this, REFIID riid, void **ppv) {
    if (!ppv) return E_POINTER;
    if (IsEqualGUID(riid, &IID_IUnknown_C) || IsEqualGUID(riid, &IID_Factory_C)) {
        *ppv = this;
        InterlockedIncrement(&this->ref);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG __stdcall fac_addref(Factory *this) { return (ULONG)InterlockedIncrement(&this->ref); }
static ULONG __stdcall fac_release(Factory *this) {
    ULONG r = (ULONG)InterlockedDecrement(&this->ref);
    if (r == 0) free(this);
    return r;
}
static HRESULT __stdcall fac_getifacec(Factory *this, int mode, GUID *guidOut, void **ppv) {
    if (!guidOut || !ppv) return E_INVALIDARG;
    /* 只声明 1 个歌词接口（mode 0）。原版对 mode>=1 返回失败以结束宿主枚举循环；
       若这里放行 1，TTPlayer 会注册两份相同插件 → 歌词服务器列表出现"两个本地歌词"。 */
    if (mode != 0) return E_FAIL;
    *guidOut = IID_Lyrics_C;    /* 声明：歌词接口 */
    Lyrics *l = (Lyrics *)calloc(1, sizeof(Lyrics));
    if (!l) return E_OUTOFMEMORY;
    l->vtbl = g_lyrics_vtbl;
    l->mode = mode;
    l->ref = 1;
    *ppv = l;
    return S_OK;
}
static void *g_factory_vtbl[] = {
    (void *)fac_qi, (void *)fac_addref, (void *)fac_release, (void *)fac_getifacec
};

/* ================= 桌宠联动 =================
 * 千千静听启动时必定加载本插件(歌词插件), 借此拉起「鲸鱼娘桌宠」NTTWhale.exe,
 * 实现「随千千静听开箱即用」, 不再依赖开机自启 + 轮询那种慢半拍、
 * 且本次会话可能压根没起来的方案。
 *
 * 关键约束(踩过的坑):
 *  - 钩子点不能放在 DllMain 里派生的线程上。千千静听会反复
 *    加载/卸载本插件(实测单日 32 次加载记录), DLL 一旦被卸载,
 *    DLL 内代码段随之消失, 睡眠中的线程会被静默杀掉 —— 日志里
 *    连一行都留不下, 表现为「插件明明加载了, 桌宠却没起来」。
 *  - 也不能在 DllMain 里同步 CreateProcess: 加载器锁下拉进程有死锁风险。
 *  - 故改在宿主主动调用的导出函数 ttpGetSoundAddIn() 内同步拉起:
 *    此处已脱离加载器锁, 且调用返回前子进程已创建完毕,
 *    之后 DLL 即便被卸载也不影响已拉起的桌宠。
 */
#define PET_EXE_NAME "NTTWhale.exe"
#define PET_INI_NAME "whale.ini"
#define PET_MUTEX_NAME "NTTWhalePet"
#define PET_LAUNCH_DEBOUNCE_MS 180000   /* 宿主枚举风暴时 3 分钟内不重复发拉起指令 */

/* 桌宠是否允许随 TTPlayer 联动(读 whale.ini; 未配置则默认允许) */
static int pet_follow_enabled(const char *addindir) {
    char ini[MAX_PATH];
    _snprintf(ini, sizeof ini, "%s\\%s", addindir, PET_INI_NAME);
    char fb[8] = "";
    if (GetPrivateProfileStringA("pet", "follow_tt", "1", fb, sizeof fb, ini) == 0) return 1;
    return fb[0] != '0';
}

/* 桌宠是否已在运行：查宠物 WinMain 自建的命名互斥体（进程亡互斥体即消失）。
   本函数在宿主枚举插件的线程上被反复调用（实测宿主单日加载本 DLL 数十次），
   原全进程快照单次 ~9ms 且系统繁忙时有毛刺，互斥体检测近乎零开销。 */
static int pet_process_exists(void) {
    HANDLE m = OpenMutexA(SYNCHRONIZE, FALSE, PET_MUTEX_NAME);
    if (!m) return 0;
    CloseHandle(m);
    return 1;
}

/* 确保桌宠在运行; 已在运行则什么都不做 */
static void pet_ensure_running(const char *addindir) {
    /* addindir 即插件所在目录(D:\TTPlayer\AddIn), 直接拼文件名即可。
     * 不要在这里再 strrchr 截断 —— 目录名里没有尾斜杠, 二次截断会吃掉一级目录。 */
    char exe[MAX_PATH];
    _snprintf(exe, sizeof exe, "%s\\%s", addindir, PET_EXE_NAME);

    if (GetFileAttributesA(exe) == INVALID_FILE_ATTRIBUTES) {
        log_msg("桌宠联动: 未找到 %s, 跳过", exe);
        return;
    }
    if (!pet_follow_enabled(addindir)) {
        log_msg("桌宠联动: whale.ini follow_tt=0 (用户已关闭联动), 跳过");
        return;
    }
    if (pet_process_exists()) {
        return;     /* 常态路径，不打日志免刷屏 */
    }
    /* 去抖：静态变量随会话存活（模块已 PIN，不再随宿主 FreeLibrary 复位）。
       防止"桌宠被杀 → 每次枚举都发拉起"的连环风暴。 */
    {
        static volatile LONG lastTick;
        DWORD now = GetTickCount();
        DWORD last = (DWORD)InterlockedCompareExchange(&lastTick, 0, 0);
        if (last && (DWORD)(now - last) < PET_LAUNCH_DEBOUNCE_MS) return;
        InterlockedExchange(&lastTick, (LONG)now);
    }
    /* 经 cmd.exe /c start 拉起：cmd 是系统签名文件、创建快且被安全软件信任缓存，
       本线程不直接 CreateProcess 新编译的未签名 exe（避免实时扫描/云裁定拖住数秒）。 */
    char sysdir[MAX_PATH], cmdline[MAX_PATH + 96];
    GetSystemDirectoryA(sysdir, MAX_PATH);
    _snprintf(cmdline, sizeof cmdline, "\"%s\\cmd.exe\" /c start \"\" \"%s\"", sysdir, exe);
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof si); si.cb = sizeof si;
    ZeroMemory(&pi, sizeof pi);
    if (CreateProcessA(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, addindir, &si, &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        log_msg("桌宠联动: 已发出拉起指令(cmd start) %s", exe);
    } else {
        log_msg("桌宠联动: 拉起失败 err=%lu", (unsigned long)GetLastError());
    }
}

/* ================= 入口 ================= */
__declspec(dllexport) HRESULT __stdcall ttpGetSoundAddIn(void **ppv) {
    if (!ppv) return E_POINTER;
    /* 首次取用即 PIN 本模块：宿主反复加载/卸载本插件（实测单日数十次），且
       eng_release 改为不等待后，工作线程可能在网络操作中时宿主就 FreeLibrary。
       PIN 后 FreeLibrary 不再真正卸载（96KB 驻留可忽略），消除"DLL 代码段随卸载
       消失、睡眠中的工作线程被静默杀掉/跑飞"的整类崩溃；静态变量也因此可跨枚举存活。 */
    {
        static int pinned;
        if (!pinned) {
            HMODULE self = NULL;
            if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN |
                                   GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                                   (LPCWSTR)&ttpGetSoundAddIn, &self) && self)
                pinned = 1;
        }
    }
    /* 宿主取用插件 → 此刻拉起桌宠(已脱离加载器锁) */
    pet_ensure_running(g_dir);
    Factory *f = (Factory *)calloc(1, sizeof(Factory));
    if (!f) return E_OUTOFMEMORY;
    f->vtbl = g_factory_vtbl;
    f->ref = 1;
    HRESULT hr = fac_qi(f, &IID_Factory_C, ppv);
    fac_release(f);
    return hr;
}

BOOL WINAPI DllMain(HINSTANCE hInst, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        GetModuleFileNameA(hInst, g_dir, MAX_PATH);
        char *slash = strrchr(g_dir, '\\');
        if (slash) *slash = 0;
        _snprintf(g_logdir, sizeof(g_logdir), "%s\\log", g_dir);
        log_msg("ttp_lrcsh 集成版 v3.1 已加载（v3 + 桌宠联动轻量化/去抖 + 引擎释放不阻塞 + 模块 PIN）");
        /* 注意: 桌宠联动不在此处触发 —— 本插件会被宿主反复加载/卸载,
         * DllMain 派生的线程会随 DLL 卸载被静默杀掉。钩子见 ttpGetSoundAddIn()。 */
    }
    return TRUE;
}
