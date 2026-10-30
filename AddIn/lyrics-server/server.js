#!/usr/bin/env node
/**
 * TTPlayer 本地歌词服务器 — NCAB.exe 的 Win11 安全替代实现
 *
 * 逆向来源（REA + Ghidra 12.1.4）：
 *  - ttp_lrcsh.dll（TTPlayer 端插件）：FUN_6035249b 搜索处理器 / FUN_60352b30 下载处理器
 *  - NCAB.exe（易语言）：?sh/?dl 路由、plugin\*.dll 的 enter/down 导出
 *  - plugin/*.dll：QQ/酷狗/酷我 三家 API 与 <lrc id sid artist title type/> 片段格式
 *
 * 协议（千千静听经典 lyricsvr.dll 协议）：
 *  搜索: GET /?sh?Artist=<hex(UTF-16LE)|plain>&Title=<...>&Flags=0[&ci=...]
 *        → <?xml ...?><result><lrc id=".." artist=".." title=".." type=".."/>...</result>
 *  下载: GET /?dl?Id=<int>&Code=<int>[&ci=...]
 *        → 原始 LRC 文本（不得以 "<result " 开头；出错时返回 <result errcode="" errmsg=""/>）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = parseInt(process.env.LRC_PORT || "89", 10);
const HOST = "127.0.0.1";
const BASE_DIR = __dirname;
const ID_STORE = path.join(BASE_DIR, "lyrics-ids.json");
const LOG_DIR = path.join(BASE_DIR, "log");
const UA = "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:46.0) Gecko/20100101 Firefox/46.0";
const FETCH_TIMEOUT = 6000;

// ---------- 工具 ----------
function log(line) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`${ts} ${line}`);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, new Date().toISOString().slice(0, 10) + ".txt"), `${ts} ${line}\n`);
  } catch {}
}
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function decodeText(buf) {
  // 先试 UTF-8，含替换符则按 GBK
  const s = buf.toString("utf8");
  if (!s.includes("\ufffd")) return s;
  try { return require("child_process").execSync("iconv -f GBK -t UTF-8", { input: buf, maxBuffer: 1 << 24 }).toString(); } catch { return s; }
}
async function fetchBuf(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*", "Accept-Language": "zh-CN,zh;q=0.9", ...extraHeaders },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf: b, url: r.url };
  } finally { clearTimeout(t); }
}
async function fetchJson(url, extraHeaders = {}) {
  const { status, buf } = await fetchBuf(url, extraHeaders);
  if (status !== 200) throw new Error("HTTP " + status);
  return JSON.parse(decodeText(buf));
}

// ---------- ID 注册表（搜索时分配整数 id，下载时反查） ----------
const idMap = new Map(); // id(int) -> {platform, ...fields}
let idSeq = 1;
try {
  const saved = JSON.parse(fs.readFileSync(ID_STORE, "utf8"));
  for (const [k, v] of Object.entries(saved.entries || {})) idMap.set(parseInt(k, 10), v);
  idSeq = saved.seq || idMap.size + 1;
  log(`id registry loaded: ${idMap.size} entries, seq=${idSeq}`);
} catch {}
function saveIds() {
  try {
    const entries = {};
    for (const [k, v] of idMap) entries[k] = v;
    fs.writeFileSync(ID_STORE, JSON.stringify({ seq: idSeq, entries }, null, 1));
  } catch (e) { log("id save failed: " + e.message); }
}
function allocId(rec) {
  const id = idSeq++;
  idMap.set(id, rec);
  if (idMap.size % 20 === 0) saveIds();
  return id;
}

// ---------- 平台：QQ 音乐 ----------
const qq = {
  name: "QQ",
  async search(artist, title) {
    const key = (artist + " " + title).trim() || title;
    const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?_=${Date.now()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0&g_tk_new_20200303=5381&g_tk=5381&hostUin=22126403&is_xml=0&key=${encodeURIComponent(key)}`;
    const j = await fetchJson(url, { Referer: "https://c.y.qq.com/" });
    const list = j?.data?.song?.itemlist || [];
    return list.slice(0, 10).map((it) => ({
      platform: "QQ", artist: it.singer || artist, title: it.name || title, album: it.album?.name || "",
      songKey: it.mid, dur: it.interval || 0,
    })).filter((x) => x.songKey);
  },
  async lyric(item) {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=${Date.now()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0&g_tk_new_20200303=5381&g_tk=5381&loginUin=0&songmid=${encodeURIComponent(item.songKey)}`;
    const j = await fetchJson(url, { Referer: "https://c.y.qq.com/" });
    if (!j.lyric) return null;
    return Buffer.from(j.lyric, "base64").toString("utf8");
  },
};

// ---------- 平台：酷狗 ----------
const kugou = {
  name: "KuGou",
  async search(artist, title) {
    const kw = (artist + " " + title).trim() || title;
    const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=1&pagesize=20&showtype=1`;
    const j = await fetchJson(url);
    const list = j?.data?.info || j?.data?.lists || [];
    return list.slice(0, 10).map((it) => ({
      platform: "KuGou", artist: it.singername || artist, title: it.songname || title, album: it.album_name || "",
      hash: it.hash, audioId: it.album_audio_id || "", dur: it.duration || 0,
    })).filter((x) => x.hash);
  },
  async lyric(item) {
    // 1) 按 hash 查候选（拿 id + accesskey）
    const candUrl = `http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=${encodeURIComponent(item.hash)}&album_audio_id=${encodeURIComponent(item.audioId || "")}`;
    const cj = await fetchJson(candUrl);
    const cand = (cj?.candidates || [])[0];
    if (!cand) return null;
    // 2) 下载 LRC（base64）
    const dlUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}&fmt=lrc&charset=utf8`;
    const dj = await fetchJson(dlUrl);
    if (!dj.content) return null;
    return Buffer.from(dj.content, "base64").toString("utf8");
  },
};

// ---------- 平台：酷我 ----------
const kuwo = {
  name: "KuWo",
  async search(artist, title) {
    const kw = (artist + " " + title).trim() || title;
    const url = `http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(kw)}&pn=1&rn=20&httpsStatus=1&reqId=${Date.now()}`;
    const j = await fetchJson(url, { Referer: "http://www.kuwo.cn/", Cookie: "kw_token=0" });
    const list = j?.data?.list || [];
    return list.slice(0, 10).map((it) => ({
      platform: "KuWo", artist: it.artist || artist, title: it.name || title, album: it.album || "",
      rid: String(it.rid || it.musicrid || ""), dur: it.duration || 0,
    })).filter((x) => x.rid && x.rid !== "0");
  },
  async lyric(item) {
    const url = `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(item.rid)}`;
    const j = await fetchJson(url, { Referer: "http://www.kuwo.cn/" });
    const data = j?.data || {};
    const lrcList = data.lrclist || [];
    const info = data.songinfo || data.info || {};
    const lines = [];
    const ti = info.songName || info.name || item.title;
    const ar = info.artist || item.artist;
    const al = info.album || item.album || "";
    if (ti) lines.push(`[ti:${ti}]`);
    if (ar) lines.push(`[ar:${ar}]`);
    if (al) lines.push(`[al:${al}]`);
    lines.push("[by:TTPlayer 本地歌词服务器]");
    for (const l of lrcList) {
      const text = l.lineLyric || "";
      if (!text) continue;
      const t = l.time || "";
      lines.push(`[${t}]${text}`);
    }
    return lines.length > 4 ? lines.join("\n") + "\n" : null;
  },
};
// ---------- 平台：网易云（2026-10-24 curl 实测全链路可用，兜底音源） ----------
const netease = {
  name: "Netease",
  async search(artist, title) {
    const kw = (artist + " " + title).trim() || title;
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(kw)}&type=1&limit=8&offset=0`;
    const j = await fetchJson(url, { Referer: "https://music.163.com/" });
    const list = j?.result?.songs || [];
    return list.map((it) => ({
      platform: "Netease", artist: (it.artists && it.artists[0] && it.artists[0].name) || artist,
      title: it.name || title, album: (it.album && it.album.name) || "",
      songKey: String(it.id || ""), dur: it.duration || 0,
    })).filter((x) => x.songKey);
  },
  async lyric(item) {
    const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(item.songKey)}&lv=1&kv=1&tv=-1`;
    const j = await fetchJson(url, { Referer: "https://music.163.com/" });
    const lrc = j?.lrc?.lyric || "";
    return lrc ? lrc + "\n" : null; // uncollected 时 lrc.lyric 为空串 → 返回 null
  },
};
const PLATFORMS = [qq, kugou, netease, kuwo];

// ---------- 请求参数解析（复刻 NCAB 的正则提取方式） ----------
function parseParams(qs) {
  const p = {};
  for (const m of qs.matchAll(/([A-Za-z_]+)=([^&]*)/g)) {
    p[m[1]] = decodeURIComponent(m[2].replace(/\+/g, " "));
  }
  return p;
}
function decodeSongText(v) {
  if (!v) return "";
  // 经典协议：UTF-16LE 字节的 hex（大写/小写十六进制）
  if (/^[0-9A-Fa-f]+$/.test(v) && v.length % 4 === 0) {
    try {
      const b = Buffer.from(v, "hex");
      if (b.length) {
        const s = b.toString("utf16le");
        if (!s.includes("\ufffd") && /[\u4e00-\u9fffA-Za-z0-9]/.test(s)) return s.replace(/\s+$/, "");
      }
    } catch {}
  }
  return v.trim();
}

// ---------- 协议响应 ----------
function searchXml(items) {
  let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<result>\n';
  for (const it of items) {
    out += `<lrc id="${it.id}" artist="${xmlEsc(it.artist)}" title="${xmlEsc(it.title)}" type="${it.platform}"/>\n`;
  }
  out += "</result>\n";
  return out;
}
function errorXml(code, msg) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<result errcode="${code}" errmsg="${xmlEsc(msg)}"/>\n`;
}
const HTML_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TTPlayer 本地歌词服务器</title></head>
<body style="font-family:Segoe UI,sans-serif;max-width:720px;margin:40px auto">
<h2>TTPlayer 本地歌词服务器</h2>
<p>状态：<b style="color:green">运行中</b>（端口 ${PORT}） — NCAB.exe 的 Win11 兼容替代实现</p>
<p>支持音源：QQ音乐 / 酷狗 / 酷我</p>
<p>用法：在千千静听中播放歌曲 → 歌词面板自动搜索；或右键歌词窗口手动搜索。</p>
<p><a href="/?sh?Artist=周杰伦&Title=晴天&Flags=0">测试搜索：周杰伦 - 晴天</a></p>
</body></html>`;

// ---------- 搜索/下载处理 ----------
async function handleSearch(params) {
  const artist = decodeSongText(params.Artist || "");
  const title = decodeSongText(params.Title || "");
  log(`搜索 歌手：${artist}  歌名：${title}  Flags=${params.Flags || 0}`);
  if (!artist && !title) return errorXml(32010, "Can not find the lyrics");
  const results = await Promise.allSettled(PLATFORMS.map((p) => p.search(artist, title)));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const it of r.value) {
        it.id = allocId(it);
        items.push(it);
      }
    } else log(`${PLATFORMS[i].name} 搜索失败: ${r.reason?.message || r.reason}`);
  });
  log(`返回 ${items.length} 条结果`);
  return searchXml(items);
}
async function handleDownload(params) {
  const id = parseInt(params.Id || "0", 10);
  log(`下载歌词 Id=${id} Code=${params.Code || ""}`);
  const rec = idMap.get(id);
  if (!rec) return errorXml(32011, "Unknown error when downloading");
  const plat = PLATFORMS.find((p) => p.name === rec.platform);
  if (!plat) return errorXml(32011, "Unknown error when downloading");
  try {
    const lrc = await plat.lyric(rec);
    if (!lrc) return errorXml(32012, "Can not find the lyrics");
    log(`下载成功 ${rec.platform} ${rec.artist} - ${rec.title} (${lrc.length} bytes)`);
    return lrc;
  } catch (e) {
    log(`下载失败: ${e.message}`);
    return errorXml(32013, "Connect to server failed");
  }
}

// ---------- HTTP 服务 ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${HOST}:${PORT}`);
    const raw = decodeURI(u.pathname + u.search); // /?sh?Artist=..&Title=..
    let body, ctype = "text/xml; charset=UTF-8";
    const m = raw.match(/^\/\?(sh|dl)\?(.*)$/);
    if (m) {
      const params = parseParams(m[2]);
      body = m[1] === "sh" ? await handleSearch(params) : await handleDownload(params);
      if (m[1] === "dl" && !body.startsWith("<result ")) ctype = "text/plain; charset=UTF-8";
    } else if (raw === "/" || raw === "/index.html") {
      body = HTML_PAGE; ctype = "text/html; charset=UTF-8";
    } else {
      body = errorXml(32014, "URI not found");
    }
    const buf = Buffer.from(body, "utf8");
    res.writeHead(200, { "Content-Type": ctype, "Content-Length": buf.length, Connection: "close" });
    res.end(buf);
  } catch (e) {
    log("handler error: " + e.message);
    const buf = Buffer.from(errorXml(32099, "Server error"), "utf8");
    res.writeHead(200, { "Content-Type": "text/xml; charset=UTF-8", "Content-Length": buf.length });
    res.end(buf);
  }
});
server.on("error", (e) => { log("server error: " + e.message); if (e.code === "EADDRINUSE") process.exit(2); });
server.listen(PORT, HOST, () => {
  log(`歌词服务器已启动 http://${HOST}:${PORT} （QQ/KuGou/KuWo，Win11 兼容实现）`);
  log("等待千千静听 (ttp_lrcsh.dll) 请求 ...");
});
process.on("SIGINT", () => { saveIds(); log("已停止"); process.exit(0); });

// ---------- 自检模式：node server.js --selftest ----------
if (process.argv.includes("--selftest")) {
  (async () => {
    for (const p of PLATFORMS) {
      try {
        const r = await p.search("周杰伦", "晴天");
        console.log(`[selftest] ${p.name}: ${r.length} 条`, r.slice(0, 2).map((x) => `${x.artist}-${x.title}`).join(" | "));
        if (r.length) {
          try { const l = await p.lyric(r[0]); console.log(`[selftest] ${p.name} 歌词: ${l ? l.length + " bytes, 首行: " + l.split("\n")[0] : "null"}`); }
          catch (e) { console.log(`[selftest] ${p.name} 歌词失败: ${e.message}`); }
        }
      } catch (e) { console.log(`[selftest] ${p.name} 搜索失败: ${e.message}`); }
    }
    process.exit(0);
  })();
}
