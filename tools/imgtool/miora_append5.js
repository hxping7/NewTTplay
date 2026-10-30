// 向 .miora 画布追加条目（最终版）
// 完整条目结构（已实测确认）：
//   [ "wb-item:" + id + \0 ]
//   [ 0c 00 0d 01 ]
//   [ 路径长度 LE16 ]
//   [ 路径 UTF-8 + \0 ]
//   [ 00 0d ][ lenField LE16 ]
//   [ 元数据: 00 01 01 <x:2> <y:2> 00 03 01 01 61 00 04 02 05 01 07 <w:4> <h:4> 00 00 4a 0b 86 00 00 58
//       0c 01 01 02 <标题 UTF-8> 00 03 ]
// lenField 语义：与条目在文件中的位置相关（实测相邻条目固定 +2）。
//   → 追加到末尾时，给新条目分配连续递增值即可，不影响已有条目。
const fs = require('fs');

const FILE = 'D:/TTPlayer/jingyu-niang-design.miora';

const NEW_ITEMS = [
  { id: 'loop-dance', path: 'jingyu-niang-design_assets/dance_strip_L18.png', title: '循环-dance-摇尾巴跳舞', x: 0, y: 320, w: 2080, h: 220 },
  { id: 'dance-f0', path: 'jingyu-niang-design_assets/dance_f0.png', title: '帧-dance-0-垂手尾低位', x: 2300, y: 0, w: 1200, h: 940 },
  { id: 'dance-f1', path: 'jingyu-niang-design_assets/dance_f1.png', title: '帧-dance-1-垂手尾低位左倾', x: 2300, y: 1000, w: 1200, h: 940 },
  { id: 'dance-f2', path: 'jingyu-niang-design_assets/dance_f2.png', title: '帧-dance-2-肩侧尾中位起跳', x: 2300, y: 2000, w: 1200, h: 940 },
  { id: 'dance-f3', path: 'jingyu-niang-design_assets/dance_f3.png', title: '帧-dance-3-肩侧尾高位', x: 3600, y: 0, w: 1200, h: 940 },
  { id: 'dance-f4', path: 'jingyu-niang-design_assets/dance_f4.png', title: '帧-dance-4-肩侧尾上翘右倾', x: 3600, y: 1000, w: 1200, h: 940 },
  { id: 'dance-f5', path: 'jingyu-niang-design_assets/dance_f5.png', title: '帧-dance-5-高举尾高位', x: 3600, y: 2000, w: 1200, h: 940 },
  { id: 'dance-f6', path: 'jingyu-niang-design_assets/dance_f6.png', title: '帧-dance-6-高举尾中位左倾', x: 4900, y: 0, w: 1200, h: 940 },
  { id: 'dance-f7', path: 'jingyu-niang-design_assets/dance_f7.png', title: '帧-dance-7-垂手尾后', x: 4900, y: 1000, w: 1200, h: 940 },
];

const buf = fs.readFileSync(FILE);
const s = buf.toString('latin1');

// 定位条目
const positions = [];
let p = 0;
while ((p = s.indexOf('wb-item:', p)) !== -1) { positions.push(p); p += 8; }
const entries = [];
for (const start of positions) {
  const after = s.slice(start + 8);
  const nul = after.indexOf('\0');
  const id = after.slice(0, nul);
  const pathStart = s.indexOf('jingyu-niang-design_assets', start + 8 + nul + 1);
  if (pathStart === -1) continue;
  const pathEnd = s.indexOf('\0', pathStart);
  entries.push({ start, id, pathStart, pathEnd, idx: entries.length });
}
const last = entries[entries.length - 1];
const lastLenField = buf.readUInt16LE(last.pathEnd + 3);
console.log('现有条目:', entries.length, ' 末条目:', last.id, 'lenField =', lastLenField);

// 模板元数据：从文件里直接提取真实标题字节（避免硬编码编码差异）
const tpl = entries.find(e => e.id === 'loop-think');
const tplMeta = buf.slice(tpl.pathEnd + 5, entries[tpl.idx + 1].start);
// 元数据尾部结构: ... 0c 01 01 02 <标题> 00 03
const titleTailSig = Buffer.from([0x0c, 0x01, 0x01, 0x02]);
const tsPos = tplMeta.lastIndexOf(titleTailSig);
if (tsPos === -1) throw new Error('title sig not found');
const tTitleStart = tsPos + titleTailSig.length;
const tTitleEnd = tplMeta.indexOf(Buffer.from([0x00, 0x03]), tTitleStart);
const tplTitleBytes = tplMeta.subarray(tTitleStart, tTitleEnd);
console.log('模板元数据长度:', tplMeta.length);
console.log('模板标题字节:', tplTitleBytes.toString('hex'), '|', tplTitleBytes.toString('utf8'));

// 画布级收尾：末条目的元数据块结束之后
const lastMetaEnd = entries[last.idx + 1] ? entries[last.idx + 1].start : buf.length;
// 找到「画布级」部分起点：末条目元数据块之后的 00 0d 00 03 之类
let tailStart = buf.length;
for (let i = last.pathEnd + 5; i < buf.length - 4; i++) {
  if (buf[i] === 0x00 && buf[i + 1] === 0x0d && buf[i + 2] === 0x00 && buf[i + 3] === 0x03) { tailStart = i; }
}
console.log('画布级收尾起点 0x' + tailStart.toString(16), '长度', buf.length - tailStart);

// 构造新条目
const chunks = [];
let nextLenField = lastLenField + 2;
for (const item of NEW_ITEMS) {
  const pathBytes = Buffer.from(item.path, 'utf8');
  const pathLen = Buffer.alloc(2);
  pathLen.writeUInt16LE(pathBytes.length, 0);

  let meta = Buffer.from(tplMeta);
  // 替换标题（用真实字节定位）
  const tPos = meta.indexOf(tplTitleBytes);
  if (tPos === -1) throw new Error('template title not found');
  meta = Buffer.concat([meta.subarray(0, tPos), Buffer.from(item.title, 'utf8'), meta.subarray(tPos + tplTitleBytes.length)]);
  // 坐标：签名 01 01 后紧跟 x(2) y(2)
  const sigPos = meta.indexOf(Buffer.from([0x01, 0x01]));
  meta.writeUInt16LE(item.x & 0xffff, sigPos + 2);
  meta.writeUInt16LE(item.y & 0xffff, sigPos + 4);
  // 尺寸：0x07 后是 w(4) h(4)
  const dimPos = meta.indexOf(Buffer.from([0x07]));
  meta.writeUInt32LE(item.w, dimPos + 1);
  meta.writeUInt32LE(item.h, dimPos + 5);

  const idBytes = Buffer.from('wb-item:' + item.id + '\0', 'utf8');
  const head = Buffer.from([0x0c, 0x00, 0x0d, 0x01]);
  const lenBuf = Buffer.alloc(4);
  lenBuf[0] = 0x00; lenBuf[1] = 0x0d;
  lenBuf.writeUInt16LE(nextLenField, 2);
  chunks.push(Buffer.concat([idBytes, head, pathLen, pathBytes, Buffer.from([0]), lenBuf, meta]));
  nextLenField += 2;
}

const out = Buffer.concat([buf.subarray(0, tailStart), ...chunks, buf.subarray(tailStart)]);
fs.writeFileSync(FILE, out);
console.log('\n写入完成:', FILE);
console.log('大小', buf.length, '→', out.length, '(+' + (out.length - buf.length) + ')');

// 回读验证
const s2 = fs.readFileSync(FILE).toString('latin1');
let cnt = 0;
for (const it of NEW_ITEMS) {
  const ok = s2.includes('wb-item:' + it.id + '\0') && s2.includes(it.path);
  if (!ok) console.log('MISSING:', it.id);
  else cnt++;
}
console.log('回读校验通过:', cnt, '/', NEW_ITEMS.length);
const total = (s2.match(/wb-item:/g) || []).length;
console.log('文件内条目总数:', total);
