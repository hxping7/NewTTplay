// 复刻 ttp_lrcsh.dll（TTPlayer 歌词插件）的 HTTP 客户端行为，用于端到端协议验证
// 依据：FUN_6035249b 搜索 / FUN_60352b30 下载 的 Ghidra 反编译结果
const http = require("http");

const BASE = "http://127.0.0.1:89/";
const UA = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)";
const hexUtf16le = (s) => Buffer.from(s, "utf16le").toString("hex").toUpperCase();

function get(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET",
        headers: { "User-Agent": UA, Accept: "text/html, image/gif, image/jpg, image/pjpeg, image/x-xbitmap, */*" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, ctype: res.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  console.log("=== 1. 搜索（经典协议：hex(UTF-16LE) 编码）===");
  const artist = process.argv[2] || "周杰伦";
  const title = process.argv[3] || "晴天";
  const sh = `?sh?Artist=${hexUtf16le(artist)}&Title=${hexUtf16le(title)}&Flags=0&ci=`;
  console.log("请求:", sh.slice(0, 90) + "...");
  const r1 = await get(sh);
  console.log("Content-Type:", r1.ctype);
  console.log(r1.body);
  const ids = [...r1.body.matchAll(/<lrc id="(\d+)" artist="([^"]*)" title="([^"]*)"/g)];
  if (!ids.length) { console.log("!! 无搜索结果"); process.exit(1); }

  console.log("=== 2. 下载第一条 ===");
  const dl = `?dl?Id=${ids[0][1]}&Code=0&ci=`;
  const r2 = await get(dl);
  console.log("Content-Type:", r2.ctype);
  console.log(r2.body.slice(0, 400));
  console.log("...");
  console.log(r2.body.startsWith("<result ") ? "!! 下载返回了错误 XML" : "✅ 下载返回原始 LRC（协议合规）");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
