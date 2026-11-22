/* music_brain.c — 鲸鱼娘音乐人格 v16
 *
 * 不再是"歌名关键词→情绪"的机械触发器，而是一个有喜好的挑剔听众：
 *   - 从 TTPlayer 窗口标题取「歌手 - 歌名」
 *   - 在 Music.library(TTBL) 里定位音频文件路径
 *   - 读音频文件自带标签(ID3v1/v2、FLAC Vorbis)的 Genre/BPM，不猜歌名
 *   - 喜好(歌手/曲风) × 心情 × 新鲜度 × 关联记忆 → 评分决策
 *   - 三级反应：0沉默 / 1轻微(只表情) / 2强烈(切状态+气泡)
 *
 * 所有配置与记忆存 whale.ini 的 [music] 段。
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <ctype.h>

#define MAX_PATHS 12000
#define PATH_LEN  520
#define MAX_MEM   220
#define MAX_LIKE  64

/* 反应结果 */
typedef struct {
    int  level;                 /* 0沉默 1轻微 2强烈 */
    int  state;                 /* 强烈反应的目标状态号(0..17) */
    wchar_t text[200];          /* 气泡文字(level>=1) */
} BrainReaction;

/* 歌曲记忆 */
typedef struct {
    wchar_t key[180];           /* "歌手|歌名" */
    int  plays;                 /* 播放次数 */
    int  pets;                  /* 在这首歌期间被摸次数 */
    int  lastDay;               /* 上次听的日期序号 */
    int  liked;                 /* 累计好感倾向 */
} SongMem;

static char    g_iniPath[MAX_PATH];   /* ANSI, 给 GetPrivateProfileStringA */
static wchar_t g_libPath[MAX_PATH];
static wchar_t *g_paths[MAX_PATHS];   /* 曲库路径缓存 */
static int     g_npaths = 0;
static SongMem g_mem[MAX_MEM];
static int     g_nmem = 0;

/* 喜好清单 */
static wchar_t g_likeArtists[MAX_LIKE][80];
static int     g_nLikeArtists = 0;
static wchar_t g_dislikeArtists[MAX_LIKE][80];
static int     g_nDislikeArtists = 0;
static wchar_t g_likeGenres[MAX_LIKE][40];
static int     g_nLikeGenres = 0;
static wchar_t g_dislikeGenres[MAX_LIKE][40];
static int     g_nDislikeGenres = 0;

/* 当前歌曲上下文 */
static wchar_t g_curKey[180];
static wchar_t g_curArtist[80];
static wchar_t g_curTitle[120];
static int     g_curMood;             /* 0低落 1平静 2兴奋 */
static int     g_aff;                 /* 好感度 */

/* ID3v1 标准流派表 */
static const wchar_t *const ID3GENRES[] = {
    L"Blues", L"Classic Rock", L"Country", L"Dance", L"Disco", L"Funk", L"Grunge",
    L"Hip-Hop", L"Jazz", L"Metal", L"New Age", L"Oldies", L"Other", L"Pop", L"R&B",
    L"Rap", L"Reggae", L"Rock", L"Techno", L"Industrial", L"Alternative", L"Ska",
    L"Death Metal", L"Pranks", L"Soundtrack", L"Euro-Techno", L"Ambient", L"Trip-Hop",
    L"Vocal", L"Jazz+Funk", L"Fusion", L"Trance", L"Classical", L"Instrumental",
    L"Acid", L"House", L"Game", L"Sound Clip", L"Gospel", L"Noise", L"AlternRock",
    L"Bass", L"Soul", L"Punk", L"Space", L"Meditative", L"Instrumental Pop",
    L"Instrumental Rock", L"Ethnic", L"Gothic", L"Darkwave", L"Techno-Industrial",
    L"Electronic", L"Pop-Folk", L"Eurodance", L"Dream", L"Southern Rock", L"Comedy",
    L"Cult", L"Gangsta", L"Top 40", L"Christian Rap", L"Pop/Funk", L"Jungle",
    L"Native American", L"Cabaret", L"New Wave", L"Psychadelic", L"Rave", L"Showtunes",
    L"Trailer", L"Lo-Fi", L"Tribal", L"Acid Punk", L"Acid Jazz", L"Polka", L"Retro",
    L"Musical", L"Rock & Roll", L"Hard Rock"
};
#define NGENRE ((int)(sizeof ID3GENRES / sizeof ID3GENRES[0]))

/* ---------------- 工具 ---------------- */
static int day_no(void) {
    SYSTEMTIME st; GetLocalTime(&st);
    return (int)(st.wYear * 372 + st.wMonth * 31 + st.wDay);
}

static void lower_ascii(wchar_t *s) {
    for (; *s; s++) if (*s >= L'A' && *s <= L'Z') *s += 32;
}

static int list_contains(const wchar_t *list, int itemLen, int n, const wchar_t *v) {
    wchar_t a[80], b[80];
    wcsncpy(a, v, 79); a[79] = 0; lower_ascii(a);
    for (int i = 0; i < n; i++) {
        const wchar_t *slot = list + (size_t)i * itemLen;
        wcsncpy(b, slot, 79); b[79] = 0; lower_ascii(b);
        if (wcsstr(a, b) || wcsstr(b, a)) return 1;
    }
    return 0;
}

/* 解析逗号分隔的 UTF-8 配置到宽字符清单(每项最多 itemLen 字符) */
static void parse_list(const char *val, wchar_t *out, int itemLen, int *n) {
    *n = 0;
    if (!val || !*val) return;
    char buf[2048];
    strncpy(buf, val, sizeof buf - 1); buf[sizeof buf - 1] = 0;
    char *tok = strtok(buf, ",，");
    while (tok && *n < MAX_LIKE) {
        while (*tok == ' ') tok++;
        if (*tok) {
            wchar_t *slot = out + (size_t)(*n) * itemLen;
            MultiByteToWideChar(CP_UTF8, 0, tok, -1, slot, itemLen);
            (*n)++;
        }
        tok = strtok(NULL, ",，");
    }
}

/* ---------------- 曲库索引 ---------------- */
static void library_load(void) {
    HANDLE f = CreateFileW(g_libPath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return;
    DWORD sz = GetFileSize(f, NULL);
    if (sz <= 0 || sz > 64 * 1024 * 1024) { CloseHandle(f); return; }
    char *raw = (char *)malloc(sz + 2);
    if (!raw) { CloseHandle(f); return; }
    DWORD rd = 0;
    ReadFile(f, raw, sz, &rd, NULL);
    raw[rd] = 0; raw[rd + 1] = 0;
    CloseHandle(f);

    /* TTBL 是 UTF-16LE 字符串流; 直接扫字节找 "X:\" 开头到扩展名结尾 */
    wchar_t *t = (wchar_t *)raw;
    int nchars = (int)(rd / 2);
    static const wchar_t *exts[] = { L".mp3", L".flac", L".wav", L".ape", L".wma", L".m4a", L".ogg" };
    for (int i = 0; i < nchars && g_npaths < MAX_PATHS; i++) {
        /* 盘符 X: 后跟 \ 或 \\ */
        wchar_t c = t[i];
        int isdrive = ((c >= L'A' && c <= L'Z') || (c >= L'a' && c <= L'z'));
        if (!isdrive || t[i+1] != L':') continue;
        int j = i + 2;
        int slashes = 0;
        while (j < nchars && (t[j] == L'\\' || t[j] == L'/')) { slashes++; j++; }
        if (slashes < 1) continue;
        /* 找到路径结尾: 扩展名后第一个非路径字符 */
        int end = -1;
        for (int k = j; k < nchars && k < j + PATH_LEN; k++) {
            wchar_t ch = t[k];
            if (ch == 0 || ch < 0x20 || ch == L'<' || ch == L'>' || ch == L'"' ||
                ch == L'|' || ch == L'?' || ch == L'*') break;
            for (size_t e = 0; e < sizeof exts / sizeof exts[0]; e++) {
                size_t el = wcslen(exts[e]);
                if (k + el <= nchars) {
                    int match = 1;
                    for (size_t q = 0; q < el; q++) {
                        wchar_t a = t[k+q], b = exts[e][q];
                        if (a >= L'A' && a <= L'Z') a += 32;
                        if (b >= L'A' && b <= L'Z') b += 32;
                        if (a != b) { match = 0; break; }
                    }
                    if (match) end = (int)(k + el);
                }
            }
        }
        if (end <= j) continue;
        int len = end - i;
        if (len < 8 || len >= PATH_LEN) continue;
        wchar_t *p = (wchar_t *)calloc(len + 1, sizeof(wchar_t));
        memcpy(p, t + i, len * sizeof(wchar_t));
        /* 去重(廉价: 只和最后 200 个比) */
        int dup = 0;
        for (int k = g_npaths - 1; k >= 0 && k >= g_npaths - 200; k--) {
            if (wcscmp(g_paths[k], p) == 0) { dup = 1; break; }
        }
        if (dup) { free(p); continue; }
        g_paths[g_npaths++] = p;
        i = end - 1;
    }
    free(raw);
}

/* 从路径列表按歌手+歌名找文件 */
static const wchar_t *find_file(const wchar_t *artist, const wchar_t *title) {
    /* 精确: 文件名含歌名 且 路径含歌手 */
    for (int i = 0; i < g_npaths; i++) {
        const wchar_t *p = g_paths[i];
        const wchar_t *slash = wcsrchr(p, L'\\');
        const wchar_t *fname = slash ? slash + 1 : p;
        if (wcsstr(fname, title) && (!artist[0] || wcsstr(p, artist))) return p;
    }
    /* 模糊: 只匹配歌名 */
    for (int i = 0; i < g_npaths; i++) {
        const wchar_t *p = g_paths[i];
        const wchar_t *slash = wcsrchr(p, L'\\');
        const wchar_t *fname = slash ? slash + 1 : p;
        if (wcsstr(fname, title)) return p;
    }
    return NULL;
}

/* ---------------- 音频标签读取 ---------------- */
/* 返回流派名; BPM 通过 outBpm 传出(0=未知) */
static void read_tag(const wchar_t *path, wchar_t *genre, size_t gsz, int *outBpm) {
    genre[0] = 0;
    *outBpm = 0;
    HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return;
    DWORD sz = GetFileSize(f, NULL);
    if (sz < 128 || sz > 100 * 1024 * 1024) { CloseHandle(f); return; }

    /* ID3v1: 末尾 128 字节 */
    SetFilePointer(f, (LONG)(sz - 128), NULL, FILE_BEGIN);
    unsigned char t1[128];
    DWORD rd = 0;
    ReadFile(f, t1, 128, &rd, NULL);
    if (rd == 128 && t1[0] == 'T' && t1[1] == 'A' && t1[2] == 'G' && t1[125] == 0) {
        int gi = t1[126];
        if (gi >= 0 && gi < NGENRE) {
            wcsncpy(genre, ID3GENRES[gi], gsz - 1);
            genre[gsz - 1] = 0;
        }
    }

    /* ID3v2: TCON(流派) / TBPM */
    SetFilePointer(f, 0, NULL, FILE_BEGIN);
    unsigned char h[10];
    rd = 0;
    ReadFile(f, h, 10, &rd, NULL);
    if (rd == 10 && h[0] == 'I' && h[1] == 'D' && h[2] == '3') {
        unsigned tagsz = ((unsigned)(h[6] & 0x7f) << 21) | ((unsigned)h[7] << 14) |
                         ((unsigned)h[8] << 7) | h[9];
        if (tagsz > 0 && tagsz < 2 * 1024 * 1024) {
            unsigned char *buf = (unsigned char *)malloc(tagsz);
            if (buf) {
                ReadFile(f, buf, tagsz, &rd, NULL);
                unsigned pos = 0;
                while (pos + 10 <= rd) {
                    unsigned fsz = ((unsigned)buf[pos+4] << 24) | ((unsigned)buf[pos+5] << 16) |
                                   ((unsigned)buf[pos+6] << 8) | buf[pos+7];
                    if (fsz == 0 || fsz > rd - pos - 10) break;
                    unsigned char *fc = buf + pos + 10;
                    unsigned char enc = fc[0];
                    if (memcmp(buf + pos, "TCON", 4) == 0 && fsz > 1) {
                        char tmp[256] = { 0 };
                        if (enc == 0) {
                            size_t n = fsz - 1 < 255 ? fsz - 1 : 255;
                            memcpy(tmp, fc + 1, n);
                        } else if (enc == 1 || enc == 2) {
                            size_t n = (fsz - 3) / 2 < 255 ? (fsz - 3) / 2 : 255;
                            for (size_t k = 0; k < n; k++)
                                tmp[k] = (char)fc[3 + k * 2];
                        }
                        /* ID3v2 常见 "(17)" 数字流派引用 */
                        if (tmp[0] == '(') {
                            int gi = atoi(tmp + 1);
                            if (gi >= 0 && gi < NGENRE) {
                                wcsncpy(genre, ID3GENRES[gi], gsz - 1);
                                genre[gsz - 1] = 0;
                            }
                        } else if (tmp[0]) {
                            MultiByteToWideChar(CP_UTF8, 0, tmp, -1, genre, (int)gsz);
                        }
                    } else if (memcmp(buf + pos, "TBPM", 4) == 0 && fsz > 1) {
                        char tmp[32] = { 0 };
                        size_t n = fsz - 1 < 31 ? fsz - 1 : 31;
                        memcpy(tmp, fc + 1, n);
                        *outBpm = atoi(tmp);
                    }
                    pos += 10 + fsz;
                }
                free(buf);
            }
        }
    }

    /* FLAC Vorbis Comment: fLaC → METADATA_BLOCK(STREAMINFO/VORBIS_COMMENT) */
    if (!genre[0]) {
        SetFilePointer(f, 0, NULL, FILE_BEGIN);
        unsigned char fh[4];
        rd = 0;
        ReadFile(f, fh, 4, &rd, NULL);
        if (rd == 4 && memcmp(fh, "fLaC", 4) == 0) {
            unsigned char bh[4];
            while (1) {
                rd = 0;
                ReadFile(f, bh, 4, &rd, NULL);
                if (rd < 4) break;
                int last = bh[0] & 0x80;
                unsigned bsz = ((unsigned)bh[1] << 16) | ((unsigned)bh[2] << 8) | bh[3];
                if (bsz == 0 || bsz > 16 * 1024 * 1024) break;
                if ((bh[0] & 0x7f) == 4 && bsz > 4) {  /* VORBIS_COMMENT */
                    unsigned char *vc = (unsigned char *)malloc(bsz);
                    if (vc) {
                        ReadFile(f, vc, bsz, &rd, NULL);
                        unsigned off = 4;  /* vendor length */
                        if (off + 4 <= bsz) {
                            unsigned vl = vc[off] | (vc[off+1] << 8) | (vc[off+2] << 16) | ((unsigned)vc[off+3] << 24);
                            off += 4 + vl;
                            if (off + 4 <= bsz) {
                                unsigned cnt = vc[off] | (vc[off+1] << 8) | (vc[off+2] << 16) | ((unsigned)vc[off+3] << 24);
                                off += 4;
                                for (unsigned c = 0; c < cnt && off + 4 <= bsz; c++) {
                                    unsigned sl = vc[off] | (vc[off+1] << 8) | (vc[off+2] << 16) | ((unsigned)vc[off+3] << 24);
                                    off += 4;
                                    if (sl > bsz - off || sl < 1) break;
                                    char item[512] = { 0 };
                                    size_t cp = sl < 511 ? sl : 511;
                                    memcpy(item, vc + off, cp);
                                    off += sl;
                                    char *eq = strchr(item, '=');
                                    if (!eq) continue;
                                    *eq = 0;
                                    char *val = eq + 1;
                                    for (char *q = item; *q; q++) if (*q >= 'A' && *q <= 'Z') *q += 32;
                                    if (!genre[0] && (strcmp(item, "genre") == 0 || strcmp(item, "content type") == 0))
                                        MultiByteToWideChar(CP_UTF8, 0, val, -1, genre, (int)gsz);
                                    if (!*outBpm && strcmp(item, "bpm") == 0) *outBpm = atoi(val);
                                }
                            }
                        }
                        free(vc);
                    }
                }
                if (last) break;
                SetFilePointer(f, (LONG)bsz, NULL, FILE_CURRENT);
            }
        }
    }
    CloseHandle(f);
}

/* ---------------- 记忆表 ---------------- */
static SongMem *mem_find(const wchar_t *key) {
    for (int i = 0; i < g_nmem; i++)
        if (wcscmp(g_mem[i].key, key) == 0) return &g_mem[i];
    return NULL;
}

static SongMem *mem_get(const wchar_t *key) {
    SongMem *m = mem_find(key);
    if (m) return m;
    if (g_nmem >= MAX_MEM) {
        /* 淘汰最旧(lastDay 最小) */
        int oldest = 0;
        for (int i = 1; i < g_nmem; i++)
            if (g_mem[i].lastDay < g_mem[oldest].lastDay) oldest = i;
        m = &g_mem[oldest];
    } else {
        m = &g_mem[g_nmem++];
    }
    memset(m, 0, sizeof *m);
    wcsncpy(m->key, key, 179); m->key[179] = 0;
    m->lastDay = day_no();
    return m;
}

/* ---------------- 配置读写 ---------------- */
static char *ini_get(const char *key, const char *def, char *buf, size_t n) {
    GetPrivateProfileStringA("music", key, def, buf, (DWORD)n, g_iniPath);
    return buf;
}

static void brain_load_config(void) {
    char buf[4096];
    ini_get("likes",       "", buf, sizeof buf); parse_list(buf, (wchar_t*)g_likeArtists,  80, &g_nLikeArtists);
    ini_get("dislikes",    "", buf, sizeof buf); parse_list(buf, (wchar_t*)g_dislikeArtists, 80, &g_nDislikeArtists);
    ini_get("like_genres", "", buf, sizeof buf); parse_list(buf, (wchar_t*)g_likeGenres,   40, &g_nLikeGenres);
    ini_get("dislike_genres","",buf,sizeof buf); parse_list(buf, (wchar_t*)g_dislikeGenres, 40, &g_nDislikeGenres);
    ini_get("affinity", "50", buf, sizeof buf); g_aff = atoi(buf);

    /* 歌曲记忆: song1=歌名|次数|摸头数|日期|倾向 */
    for (int i = 1; i <= MAX_MEM; i++) {
        char key[32];
        _snprintf(key, sizeof key, "song%d", i);
        ini_get(key, "", buf, sizeof buf);
        if (!buf[0]) break;
        wchar_t w[1024];
        MultiByteToWideChar(CP_UTF8, 0, buf, -1, w, 1024);
        wchar_t *p1 = wcschr(w, L'|'), *p2 = p1 ? wcschr(p1+1, L'|') : NULL;
        wchar_t *p3 = p2 ? wcschr(p2+1, L'|') : NULL;
        wchar_t *p4 = p3 ? wcschr(p3+1, L'|') : NULL;
        if (!p4) continue;
        SongMem *m = &g_mem[g_nmem++];
        memset(m, 0, sizeof *m);
        size_t kl = (size_t)(p1 - w);
        if (kl > 179) kl = 179;
        wcsncpy(m->key, w, kl); m->key[kl] = 0;
        m->plays = _wtoi(p1 + 1);
        m->pets  = _wtoi(p2 + 1);
        m->lastDay = _wtoi(p3 + 1);
        m->liked = _wtoi(p4 + 1);
    }
}

static void brain_save(void) {
    char buf[4096];
    /* 喜好清单写回(只写一次, 用户可手改) */
    if (!g_nLikeArtists && !g_nDislikeArtists) {
        WritePrivateProfileStringA("music", "likes", "", g_iniPath);
    }
    _snprintf(buf, sizeof buf, "%d", g_aff);
    WritePrivateProfileStringA("music", "affinity", buf, g_iniPath);

    for (int i = 0; i < g_nmem; i++) {
        SongMem *m = &g_mem[i];
        char line[512], u8[512];
        WideCharToMultiByte(CP_UTF8, 0, m->key, -1, u8, sizeof u8, NULL, NULL);
        _snprintf(line, sizeof line, "%s|%d|%d|%d|%d", u8, m->plays, m->pets, m->lastDay, m->liked);
        char key[32];
        _snprintf(key, sizeof key, "song%d", i + 1);
        WritePrivateProfileStringA("music", key, line, g_iniPath);
    }
}

/* ---------------- 对外接口 ---------------- */
void brain_init(const char *iniPathUtf8, const char *libPathUtf8, int aff) {
    strncpy(g_iniPath, iniPathUtf8, MAX_PATH - 1); g_iniPath[MAX_PATH - 1] = 0;
    MultiByteToWideChar(CP_UTF8, 0, libPathUtf8, -1, g_libPath, MAX_PATH);
    g_aff = aff;
    brain_load_config();
    library_load();
}

static void set_mood(void) {
    SYSTEMTIME st; GetLocalTime(&st);
    int hour = st.wHour;
    if (g_aff < 30 || ((hour >= 23 || hour < 6) && g_aff < 70)) g_curMood = 0;  /* 低落 */
    else if (g_aff >= 70) g_curMood = 2;                             /* 高好感: 兴奋 */
    else g_curMood = 1;                                              /* 平静 */
}

/* 新歌到来: 评分决策 */
BrainReaction brain_on_song(const wchar_t *artist, const wchar_t *title) {
    BrainReaction r;
    memset(&r, 0, sizeof r);
    r.state = 8;                       /* 默认: 听音乐 */
    if (!title[0]) return r;

    set_mood();

    /* 构造 key */
    _snwprintf(g_curKey, 179, L"%s|%s", artist, title); g_curKey[179] = 0;
    wcsncpy(g_curArtist, artist, 79); g_curArtist[79] = 0;
    wcsncpy(g_curTitle, title, 119); g_curTitle[119] = 0;

    SongMem *m = mem_get(g_curKey);
    m->plays++;
    int plays = m->plays;
    m->lastDay = day_no();

    /* 读音频标签 */
    const wchar_t *path = find_file(artist, title);
    wchar_t genre[80] = { 0 };
    int bpm = 0;
    if (path) read_tag(path, genre, 80, &bpm);

    /* ---- 评分 ---- */
    int score = 0;
    int likeArtist = artist[0] && list_contains((wchar_t*)g_likeArtists, 80, g_nLikeArtists, artist);
    int dislikeArtist = artist[0] && list_contains((wchar_t*)g_dislikeArtists, 80, g_nDislikeArtists, artist);
    if (likeArtist) score += 45;                 /* 歌手是最强信号, 足以单独触发 */
    if (dislikeArtist) score -= 50;
    if (genre[0] && list_contains((wchar_t*)g_likeGenres, 40, g_nLikeGenres, genre)) score += 20;
    if (genre[0] && list_contains((wchar_t*)g_dislikeGenres, 40, g_nDislikeGenres, genre)) score -= 30;

    /* 心情加权 */
    if (g_curMood == 2) score += 10;        /* 兴奋: 更容易被带动 */
    else if (g_curMood == 0) score -= 5;    /* 低落: 反应迟钝 */

    /* 新鲜度 */
    if (plays == 1) score += 15;
    else if (plays >= 4) score -= 12;
    else if (plays >= 2) score -= 3;

    /* 关联记忆: 你在这首歌时摸过她 */
    if (m->pets >= 2) score += 20;
    else if (m->pets == 1) score += 8;

    if (m->liked) score += m->liked;

    /* BPM 修正(仅影响兴奋度, 不决定反应) */
    if (bpm >= 140) score += 5;
    else if (bpm > 0 && bpm < 70) score -= 5;

    /* ---- 决策阈值: 心情决定 ---- */
    int thresh = (g_curMood == 2) ? 25 : (g_curMood == 0) ? 35 : 30;
    int high = thresh + 30;

    if (score < thresh) {
        /* 沉默: 大多数歌走这里 */
        r.level = 0;
        return r;
    }

    if (score >= high) {
        r.level = 2;
        if (score < -20) {
            r.state = 10;
            wcscpy(r.text, L"怎么又是这个…我不喜欢");
        } else if (plays >= 4) {
            r.state = 6;
            wcscpy(r.text, L"又来了，换首嘛~");
        } else if (m->pets >= 2) {
            r.state = 14;
            wcscpy(r.text, L"这是…我们那首歌吧？");
        } else if (g_curMood == 0) {
            r.state = 15;
            wcscpy(r.text, L"…这首懂我");
        } else if (likeArtist) {
            r.state = 17;
            _snwprintf(r.text, 199, L"%s的歌！这首我超爱~", artist);
            r.text[199] = 0;
        } else {
            r.state = 17;
            wcscpy(r.text, L"这首对味！跟着哼~");
        }
    } else {
        r.level = 1;
        if (score < 0) {
            wcscpy(r.text, L"(皱了皱眉)");
        } else if (genre[0]) {
            _snwprintf(r.text, 199, L"嗯，%s…", genre);
            r.text[199] = 0;
        } else {
            wcscpy(r.text, L"(跟着晃了晃)");
        }
    }
    return r;
}

/* 同步好感度(影响心情判定) */
void brain_set_aff(int aff) { g_aff = aff; }

/* 用户在这首歌期间摸了她: 强化关联 */
void brain_on_pet(void) {
    SongMem *m = mem_find(g_curKey);
    if (m) {
        m->pets++;
        m->liked += 3;
        if (m->liked > 30) m->liked = 30;
    }
}

/* 从窗口标题解析 "歌手 - 歌名"
 * 标题实际有两种排列(实测):
 *   "   蔡健雅 - 当你离开的时候 - 千千静听"   (后缀式, 当前)
 *   "- 千千静听   Pink Floyd - Money -"       (前缀式)
 * 统一策略: 先抹掉 "千千静听" 与紧邻的 "-", 再取第一个 " - " 作分隔。
 */
void brain_parse_title(const wchar_t *title, wchar_t *artist, size_t asz, wchar_t *song, size_t sz) {
    artist[0] = 0; song[0] = 0;
    if (!title) return;
    wchar_t buf[512];
    wcsncpy(buf, title, 511); buf[511] = 0;
    /* 复制时跳过 "千千静听" 四个字 */
    wchar_t clean[512];
    int ci = 0;
    for (int i = 0; buf[i]; ) {
        if (wcsncmp(buf + i, L"千千静听", 4) == 0) { i += 4; continue; }
        clean[ci++] = buf[i++];
    }
    clean[ci] = 0;
    /* 清理首尾的 " - " 残留 */
    while (ci > 0 && (clean[ci-1] == L' ' || clean[ci-1] == L'-')) clean[--ci] = 0;
    int st = 0;
    while (clean[st] == L' ' || clean[st] == L'-') st++;
    const wchar_t *s = clean + st;

    const wchar_t *dash = wcsstr(s, L" - ");
    if (!dash) dash = wcsstr(s, L" – ");
    if (!dash) dash = wcsstr(s, L" — ");
    if (!dash) {
        wcsncpy(song, s, sz - 1);
        song[sz - 1] = 0;
        return;
    }
    size_t al = (size_t)(dash - s);
    if (al > asz - 1) al = asz - 1;
    wcsncpy(artist, s, al); artist[al] = 0;
    const wchar_t *t = dash + 3;
    size_t sl = wcslen(t);
    while (sl > 0 && (t[sl-1] == L' ' || t[sl-1] == L'-')) sl--;
    if (sl > sz - 1) sl = sz - 1;
    wcsncpy(song, t, sl); song[sl] = 0;
    while (*artist == L' ') memmove(artist, artist + 1, wcslen(artist) * sizeof(wchar_t));
    while (*song == L' ') memmove(song, song + 1, wcslen(song) * sizeof(wchar_t));
}

void brain_save_all(void) {
    brain_save();
    for (int i = 0; i < g_npaths; i++) free(g_paths[i]);
    g_npaths = 0;
}
