/* 生成封面 cover.svg（1200×1200）；再用浏览器截图成 cover.png。
 * 封面上的每个数字都来自 core.js 对默认场景的同一次 compute。
 * 字体名用单引号：SVG 是 XML，属性值里的裸双引号会让整张图变成错误页（批次 64 踩过）。 */
const fs = require('node:fs');
const path = require('node:path');
const A = require('./core.js');
const o = A.compute(A.defaultState());
if (!o.ok) throw new Error('默认场景算不出来');
const cap = o.tools[0], syr = o.tools[1];
const F = "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif", M = 'ui-monospace,Menlo,Consolas,monospace';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <rect width="1200" height="1200" fill="#f3f1ea"/>
  <rect x="60" y="60" width="1080" height="1080" fill="#fffdf8" stroke="#e3ddc9"/>
  <g fill="#56702b">${Array.from({ length: 54 }, (_, i) => `<rect x="${60 + i * 20}" y="60" width="14" height="10"/>`).join('')}</g>
  <text x="120" y="210" font-family="${F}" font-size="76" font-weight="700" fill="#2b2a22">瓶盖不是量杯</text>
  <text x="120" y="276" font-family="${F}" font-size="32" fill="#827d66">按标签兑药兑肥 · 看手边的量具能不能量准</text>
  <line x1="120" y1="322" x2="1080" y2="322" stroke="#e3ddc9" stroke-dasharray="10 10"/>
  <text x="120" y="400" font-family="${F}" font-size="34" fill="#55523f">稀释 ${A.fmtV(o.N, 0)} 倍，只兑 ${A.fmtV(o.fillMl / 1000, 2)} L，要加</text>
  <text x="120" y="540" font-family="${M}" font-size="140" font-weight="700" fill="#56702b">${A.fmtDose(o.dose)} mL</text>
  <text x="120" y="650" font-family="${F}" font-size="34" fill="#55523f">一瓶盖下去是 ${A.fmtV(o.poured.q, 0)} mL，浓了</text>
  <text x="120" y="790" font-family="${M}" font-size="140" font-weight="700" fill="#a4471f">${A.fmtV(o.poured.times, 2)} 倍</text>
  <text x="120" y="880" font-family="${F}" font-size="31" fill="#55523f">${esc(cap.name)}最小分到 ${A.fmtV(cap.res, 1)} mL → 偏 ${A.fmtPct(cap.err, 1)}</text>
  <text x="120" y="930" font-family="${F}" font-size="31" fill="#55523f">${esc(syr.name)}量 ${A.fmtDose(syr.measured)} mL → 偏 ${A.fmtPct(syr.err, 1)}</text>
  <text x="120" y="980" font-family="${F}" font-size="31" fill="#55523f">倒多了要救回：补到 ${A.fmtV(o.poured.needL, 1)} L（这只壶 ${A.fmtV(o.raw.canL, 1)} L 装不下）</text>
  <text x="120" y="1080" font-family="${F}" font-size="24" fill="#827d66">默认场景为虚构示例 · 只做按标签的算术，不推荐浓度、不判断安全</text>
</svg>`;
fs.writeFileSync(path.join(__dirname, 'cover.svg'), svg);
console.log('cover.svg', fs.statSync(path.join(__dirname, 'cover.svg')).size, 'bytes');
console.log('封面数字：' + A.fmtDose(o.dose) + ' mL / ' + o.poured.q + ' mL / ' + A.fmtV(o.poured.times, 2) + ' 倍 / ' + A.fmtPct(cap.err, 1) + ' / ' + A.fmtV(o.poured.needL, 1) + ' L');
