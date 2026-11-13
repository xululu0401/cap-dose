/* 瓶盖不是量杯 · 核心测试
 * 跑法：node --test tests/core.test.cjs
 * 纪律：
 *  - 锚点 A1–A11 来自 ../需求与调研.md §2.6 的手算，不是从实现输出里抄回来的；
 *  - ok=false 时断言「算不出来」（不断言 0）；断言前先确认字段存在且是有限数字；
 *  - 最后一组是「人工注入错误必须让锚点变红」，证明这套测试真的会红。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_PATH = path.join(__dirname, '..', 'core.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const C = require(SRC_PATH);

function loadFromSource(src) {
  const ctx = { console: console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.AppCore;
}
function near(a, b, eps, msg) {
  assert.ok(typeof a === 'number' && isFinite(a), (msg || '') + ' —— 期望有限数字，实际 ' + a);
  assert.ok(Math.abs(a - b) <= (eps == null ? 1e-9 : eps), (msg || '') + ' —— 期望 ' + b + '，实际 ' + a);
}
function S(mut) { const s = C.defaultState(); if (mut) mut(s); return s; }
function D(mut) { return C.compute(S(mut)); }
function codes(o) { return o.errors.map((e) => e.code); }

test('浏览器全局形式与 require 形式行为一致', () => {
  const W = loadFromSource(SRC);
  assert.ok(W && typeof W.compute === 'function');
  assert.strictEqual(JSON.stringify(W.compute(W.defaultState())), JSON.stringify(C.compute(C.defaultState())));
});

test('A1 默认：这一壶 1.5 L 加 1.5 mL、水 1498.5 mL、每升 1 mL', () => {
  const o = D();
  assert.strictEqual(o.ok, true);
  assert.strictEqual(o.N, 1000); assert.strictEqual(o.basis, 'total');
  near(o.dose, 1.5); near(o.water, 1498.5); near(o.perL, 1); near(o.fillMl, 1500);
});

test('A2–A5 量具：瓶盖 0.1875 盖→量出 2 mL 偏 +33.33% 750 倍；注射器 1.5 mL 0 偏差；量杯量不出来', () => {
  const o = D();
  const [cap, syr, cup] = o.tools;
  near(cap.fills, 0.1875); near(cap.measured, 2); near(cap.err, 1 / 3); near(cap.ratio, 750);
  assert.strictEqual(cap.status, 'off'); assert.strictEqual(cap.ok, false);
  near(syr.measured, 1.5); assert.strictEqual(syr.err, 0); near(syr.ratio, 1000); assert.strictEqual(syr.status, 'ok');
  assert.strictEqual(cup.measured, 0); assert.strictEqual(cup.status, 'cannot');
  assert.strictEqual(cup.err, null); assert.strictEqual(cup.ratio, null);
  assert.ok(o.best && o.best.idx === 1, '首推应是注射器');
});

test('A6 倒了 1 盖：浓 5.333 倍、187.5 倍、救回要 8 L、补 6.5 L、2 L 壶装不下、约 4 壶', () => {
  const p = D().poured;
  assert.ok(p, 'poured 存在');
  assert.strictEqual(p.status, 'over');
  near(p.q, 8); near(p.times, 16 / 3); near(p.ratio, 187.5); near(p.needL, 8); near(p.addWaterL, 6.5);
  assert.strictEqual(p.fitsCan, false); assert.strictEqual(p.cansWorth, 4); assert.strictEqual(p.beyondNeed, true);
  near(p.surplusL, 6.2, 1e-12);
  assert.ok(!/浓了.*浓了/.test(p.text));
  assert.ok(!D().actions.some((a) => a.key === 'rescue'), '装不下就不给「补水」按钮');
});

test('A7 用量：12×150 mL = 1.8 L → 2 壶，最后 0.3 L 加 0.3 mL，总药量 1.8 mL', () => {
  const c = D().cans;
  near(c.totalL, 1.8); assert.strictEqual(c.n, 2); near(c.lastL, 0.3); near(c.lastDose, 0.3); near(c.totalDose, 1.8);
});

test('A8 剩 100 mL 够 66.67 壶；剩得不够时报 stock-short', () => {
  const o = D();
  near(o.stock.cansPerBottle, 200 / 3); assert.strictEqual(o.stock.enough, true);
  const o2 = D((s) => { s.stock = '1'; });
  assert.strictEqual(o2.stock.enough, false);
  assert.ok(o2.warnings.some((w) => w.code === 'stock-short'));
  assert.strictEqual(D((s) => { s.stock = '0'; }).stock, null, '0 = 不算');
});

test('A9 按整份配：瓶盖 2 mL 一格 → 1 格配 2 L；建议作用于输入后这一壶就是 2 L、瓶盖正好 1000 倍', () => {
  const o = D();
  assert.strictEqual(o.whole.status, 'ok'); assert.strictEqual(o.whole.m, 1);
  near(o.whole.dose, 2); near(o.whole.fillL, 2);
  const a = o.actions.find((x) => x.key === 'whole');
  assert.ok(a, '有「按整格配」建议');
  assert.ok(a.text.indexOf('按整格配') === 0, '建议文案与页面标题同一个词');
  const o2 = C.compute(C.applyAction(S(), a));
  near(o2.fillMl, 2000); near(o2.tools[0].measured, 2); assert.strictEqual(o2.tools[0].err, 0); near(o2.tools[0].ratio, 1000);
});

test('A10 口径：1000 倍按水量 1.498501…，差 −0.0999%；20 倍差 5%（且给出提醒）', () => {
  const o = D((s) => { s.basis = 'water'; });
  near(o.dose, 1500 / 1001); near(D().basisDiff, 1000 / 1001 - 1, 1e-12);
  const lo = D((s) => { s.N = '20'; });
  near(lo.dose, 75); near(lo.pOther, 1500 / 21); near(lo.basisDiff, 20 / 21 - 1, 1e-12);
  assert.ok(lo.warnings.some((w) => w.code === 'basis-matters'));
  assert.ok(!D().warnings.some((w) => w.code === 'basis-matters'), '1000 倍时差 0.1%，不该提醒');
});

test('A11 标签另两种写法：20%→0.02% = 1000 倍（总量）；15 L 加 10 mL → 1500（水量）', () => {
  const a = D((s) => { s.mode = 'pct'; });
  assert.strictEqual(a.basis, 'total'); near(a.N, 1000); near(a.dose, 1.5);
  const b = D((s) => { s.mode = 'perVol'; });
  assert.strictEqual(b.basis, 'water'); near(b.N, 1500); near(b.dose, 1500 / 1501);
});

test('取整的阈值两侧：正好半格向上、差一点点向下（不被 0.49999 浮点吞掉）', () => {
  near(C.roundTo(0.75, 0.1), 0.8, 1e-12);       /* 0.75/0.1 = 7.4999999… */
  near(C.roundTo(0.7499, 0.1), 0.7, 1e-12);
  near(C.roundTo(1, 2), 2); assert.strictEqual(C.roundTo(0.99, 2), 0);
  /* 容差边界：偏差正好 10% 算在容差内，10.01% 不算 */
  const o = D((s) => { s.fillL = '2'; s.tools[0] = { name: '刻度', size: '10', res: '2.2' }; s.tol = '10'; });
  near(o.tools[0].measured, 2.2); near(o.tools[0].err, 0.1, 1e-12); assert.strictEqual(o.tools[0].ok, true);
  near(C.roundTo(0.35, 0.1), 0.4, 1e-12, '0.35/0.1 在浮点里是 3.4999999999999996');
  const o2 = D((s) => { s.fillL = '2'; s.tools[0] = { name: '刻度', size: '10', res: '2.2002' }; s.tol = '10'; });
  assert.strictEqual(o2.tools[0].ok, false);
});

test('倒的量：倒少 / 在容差内 / 正好 / 补水装得下给按钮且作用后浓度对', () => {
  const under = D((s) => { s.pouredJ = '1'; s.pouredK = '0.2'; }).poured;   /* 1 mL < 1.5 */
  assert.strictEqual(under.status, 'under'); near(under.addDose, 0.5);
  assert.strictEqual(D((s) => { s.pouredJ = '1'; s.pouredK = '0.3'; }).poured.status, 'fine');
  const o = D((s) => { s.canL = '10'; });
  assert.strictEqual(o.poured.fitsCan, true);
  const a = o.actions.find((x) => x.key === 'rescue');
  assert.ok(a);
  const o2 = C.compute(C.applyAction(S((s) => { s.canL = '10'; }), a));
  near(o2.fillMl, 8000); near(o2.dose, 8, 1e-12); assert.strictEqual(o2.poured, null, '补水后 pouredK 归零');
  assert.strictEqual(D((s) => { s.pouredK = '0'; }).poured, null);
  const liq = D((s) => { s.pouredJ = '2'; s.pouredK = '40'; }).poured;   /* 2000 mL ≥ 1500 */
  assert.strictEqual(liq.status, 'over-liquid'); assert.strictEqual(liq.ratio, null);
});

test('换量具建议：作用后首推量具排第一，「倒的是哪件」跟着搬', () => {
  const s = S();
  const a = C.compute(s).actions.find((x) => x.key === 'use-best');
  assert.ok(a);
  const s2 = C.applyAction(s, a);
  assert.strictEqual(s2.tools[0].name, '5 mL 注射器'); assert.strictEqual(s2.tools[1].name, '瓶盖');
  assert.strictEqual(s2.pouredJ, '1', '原来倒的是瓶盖（第 0 件），搬家后它在第 1 件');
  assert.strictEqual(C.compute(s2).poured.tool, '瓶盖');
  assert.strictEqual(s.tools[0].name, '瓶盖', 'applyAction 不改原 state');
});

test('都量不准：best=null、给 no-tool 提醒、不给换量具按钮', () => {
  const o = D((s) => { s.tools = [{ name: '大碗', size: '300', res: '50' }]; s.pouredJ = '0'; s.pouredK = '0'; });
  assert.strictEqual(o.ok, true); assert.strictEqual(o.best, null);
  assert.ok(o.warnings.some((w) => w.code === 'no-tool'));
  assert.ok(!o.actions.some((x) => x.key === 'use-best'));
  assert.strictEqual(o.whole.status, 'too-big', '50 mL × 1000 = 50 L，比 2 L 壶大');
  assert.strictEqual(o.whole.m, undefined);
});

test('非法输入：空、字母、负数、科学计数、超范围、整数、多个错一起报', () => {
  assert.deepStrictEqual(codes(D((s) => { s.fillL = ''; })), ['empty']);
  assert.deepStrictEqual(codes(D((s) => { s.N = 'abc'; })), ['not-number']);
  assert.deepStrictEqual(codes(D((s) => { s.perPot = '-5'; })), ['negative']);
  assert.deepStrictEqual(codes(D((s) => { s.N = '1e3'; })), ['not-number']);
  assert.deepStrictEqual(codes(D((s) => { s.tol = '0.1'; })), ['range']);
  assert.deepStrictEqual(codes(D((s) => { s.pots = '2.5'; })), ['not-int']);
  const o = D((s) => { s.N = ''; s.canL = 'x'; s.tools[1].res = ''; });
  assert.strictEqual(o.ok, false); assert.ok(o.errors.length >= 3);
  assert.strictEqual(o.dose, undefined, '算不出来时不给药量');
});

test('不合理组合：壶装不下、百分比不降、药比水多、1 倍按总量、刻度比一满大、量具数量、倒的量具越界', () => {
  assert.ok(codes(D((s) => { s.fillL = '3'; })).includes('fill-gt-can'));
  assert.ok(codes(D((s) => { s.mode = 'pct'; s.pctTarget = '20'; })).includes('pct-not-dilute'));
  assert.ok(codes(D((s) => { s.mode = 'perVol'; s.perX = '0.1'; s.perY = '200'; })).includes('pervol-thick'));
  assert.ok(codes(D((s) => { s.N = '1'; })).includes('n-total-le1'));
  assert.strictEqual(D((s) => { s.N = '1'; s.basis = 'water'; }).ok, true, '按水量 1 倍 = 一份药一份水，合法');
  assert.ok(codes(D((s) => { s.tools[0].res = '9'; })).includes('row-res-gt-size'));
  assert.ok(codes(D((s) => { s.tools = []; })).includes('tool-count'));
  assert.ok(codes(D((s) => { s.pouredJ = '5'; })).includes('enum'));
  assert.ok(codes(D((s) => { s.tools[2].name = ' '; })).includes('row-name'));
  assert.ok(codes(D((s) => { s.tools[2].name = '长'.repeat(61); })).includes('row-name-long'));
  assert.strictEqual(D((s) => { s.tools[2].name = '长'.repeat(60); }).ok, true);
  assert.ok(codes(D((s) => { s.mode = 'xx'; })).includes('enum'));
});

test('极值：100000 倍 + 0.01 L、最大壶、0 盆不算用量', () => {
  const o = D((s) => { s.N = '100000'; s.fillL = '0.01'; s.canL = '0.05'; s.pouredK = '0'; });
  assert.strictEqual(o.ok, true); near(o.dose, 1e-4, 1e-15);
  assert.ok(o.tools.every((t) => t.status === 'cannot'));
  assert.strictEqual(o.fillMl, 10);
  const big = D((s) => { s.canL = '1000'; s.fillL = '1000'; s.N = '2'; s.pouredK = '0'; });
  near(big.dose, 500000); assert.ok(big.tools.every((t) => t.status !== 'cannot'));
  assert.ok(big.tools[0].overFill && big.tools[0].times === 62500);
  assert.strictEqual(D((s) => { s.pots = '0'; }).cans, null);
});

test('预设：每个都算得出来、都能被 presetKey 认回、默认态认作 default', () => {
  C.PRESETS.forEach((p) => {
    const st = C.stateFromPreset(p.key);
    const o = C.compute(st);
    assert.strictEqual(o.ok, true, p.key + ' ' + JSON.stringify(o.errors));
    assert.strictEqual(C.presetKey(st), p.key);
  });
  assert.strictEqual(C.presetKey(C.defaultState()), 'default');
  assert.strictEqual(C.presetKey(S((s) => { s.N = '999'; })), null);
});

test('导出：CSV/MD 含关键读数；算不出来时导出写原因不写数', () => {
  const o = D();
  const csv = C.toCSV(o, 'T'), md = C.toMD(o, 'T');
  assert.ok(csv.includes('加药 mL,1.5') && csv.includes('瓶盖,8,2,0.1875,2,+33.33%,750,超容差'));
  assert.ok(md.includes('**1.5 mL**') && md.includes('| 小量杯 | 0 mL | — | — | 量不出来 |'));
  const bad = D((s) => { s.N = ''; });
  assert.ok(C.toCSV(bad, 'T').includes('算不出来') && !C.toCSV(bad, 'T').includes('加药'));
  const tricky = D((s) => { s.tools[0].name = 'a,"b"|c'; });
  assert.ok(C.toCSV(tricky, 'T').includes('"a,""b""|c"'));
  assert.ok(C.toMD(tricky, 'T').includes('| a,"b"/c |'));
});

test('格式：fmtDose 小数位随大小变、fmtPct 带符号、0 不写成 +0%', () => {
  assert.strictEqual(C.fmtDose(0.3), '0.3'); assert.strictEqual(C.fmtDose(0.0001), '0.0001');
  assert.strictEqual(C.fmtDose(1.4985), '1.5'); assert.strictEqual(C.fmtDose(47.619), '47.6'); assert.strictEqual(C.fmtDose(500000), '500000');
  assert.strictEqual(C.fmtPct(1 / 3, 1), '+33.3%'); assert.strictEqual(C.fmtPct(0, 1), '0%'); assert.strictEqual(C.fmtPct(-0.05, 1), '-5%');
  assert.strictEqual(C.fmtPct(null), '—');
});

test('纯函数：同输入同输出、不改入参', () => {
  const s = S(); const snap = JSON.stringify(s);
  const a = JSON.stringify(C.compute(s)), b = JSON.stringify(C.compute(s));
  assert.strictEqual(a, b); assert.strictEqual(JSON.stringify(s), snap);
});

test('人工注入错误必须让锚点变红（证明测试会红）', () => {
  const mutants = [
    ['总量口径写成 F/(N+1)', 'function doseFor(F, N, basis) { return basis === \'water\' ? F / (N + 1) : F / N; }', 'function doseFor(F, N, basis) { return F / (N + 1); }'],
    ['取整去掉 +0.5', 'Math.floor(x / res + 0.5 + K.ROUND_EPS)', 'Math.floor(x / res + K.ROUND_EPS)'],
    ['取整去掉防浮点 eps', 'Math.floor(x / res + 0.5 + K.ROUND_EPS)', 'Math.floor(x / res + 0.5)'],
    ['救回总量少乘 (N+1)', 'var Fneed = q * parts(N, basis);', 'var Fneed = q * N;'],
    ['壶数用 round', 'var n = Math.ceil(totalL / v.fillL - K.CEIL_EPS);', 'var n = Math.round(totalL / v.fillL);'],
    ['perVol 换算漏 ×1000', 'N = v.perX * 1000 / v.perY;', 'N = v.perX / v.perY;'],
    ['pct 换算倒过来', 'N = v.pctProd / v.pctTarget;', 'N = v.pctTarget / v.pctProd;'],
    ['容差边界用 <', 'r.ok = Math.abs(r.err) <= tol + 1e-12;', 'r.ok = Math.abs(r.err) < tol;'],
    ['首推取偏差最大', 'return Math.abs(a.err) - Math.abs(b.err) || b.res - a.res', 'return Math.abs(b.err) - Math.abs(a.err) || b.res - a.res'],
    ['整份用 ceil', 'var m = Math.floor(v.canL / unitL + K.ROUND_EPS);', 'var m = Math.ceil(v.canL / unitL);'],
    ['装不下判断写反', 'poured.fitsCan = poured.needL <= v.canL + 1e-12;', 'poured.fitsCan = poured.needL >= v.canL;'],
    ['实际倍数水量口径少减', "return basis === 'water' ? (F - d) / d : F / d;", 'return F / d;'],
    ['不拦壶装不下', "if (v.fillL != null && v.canL != null && v.fillL > v.canL) {", 'if (false) {'],
    ['换量具不搬 pouredJ', "if (j === a.moveToolFirst) s.pouredJ = '0';", 'if (false) s.pouredJ = \'0\';']
  ];
  const survivors = [];
  mutants.forEach(([name, from, to]) => {
    assert.ok(SRC.includes(from), '注入点不存在：' + name);
    const M = loadFromSource(SRC.replace(from, to));
    let red = false;
    try { checkAnchors(M); } catch (e) { red = true; }
    if (!red) survivors.push(name);
  });
  assert.deepStrictEqual(survivors, [], '这些注入错误没被锚点抓住：' + survivors.join('、'));
  checkAnchors(C);   /* 原版必须全绿 */
});

function checkAnchors(M) {
  const st = (mut) => { const s = M.defaultState(); if (mut) mut(s); return s; };
  const o = M.compute(st());
  near(o.dose, 1.5); near(o.tools[0].measured, 2); near(o.tools[1].measured, 1.5);
  assert.strictEqual(o.tools[2].status, 'cannot'); assert.strictEqual(o.best.idx, 1);
  near(o.poured.needL, 8); assert.strictEqual(o.poured.fitsCan, false);
  assert.strictEqual(o.cans.n, 2); near(o.cans.lastL, 0.3);
  near(o.whole.fillL, 2);
  near(M.compute(st((s) => { s.N = '20'; s.basis = 'water'; s.canL = '2'; s.fillL = '1.5'; })).tools[0].ratio, (1500 - 72) / 72);
  near(M.compute(st((s) => { s.mode = 'perVol'; })).N, 1500);
  near(M.compute(st((s) => { s.mode = 'pct'; })).N, 1000);
  near(M.roundTo(0.75, 0.1), 0.8, 1e-12);
  assert.strictEqual(M.compute(st((s) => { s.tools[0] = { name: 'x', size: '10', res: '1.65' }; })).tools[0].ok, true);
  assert.strictEqual(M.compute(st((s) => { s.canL = '10'; })).poured.fitsCan, true);
  assert.strictEqual(M.compute(st((s) => { s.fillL = '3'; })).ok, false);
  const s0 = st(); const a = M.compute(s0).actions.find((x) => x.key === 'use-best');
  assert.strictEqual(M.applyAction(s0, a).pouredJ, '1');
  /* 下面这些是第一次跑注入测试时发现锚点太弱、补上的（6 个注入错误曾经存活） */
  near(M.roundTo(0.35, 0.1), 0.4, 1e-12);                        /* 0.35/0.1 = 3.4999999999999996 */
  near(M.roundTo(0.15, 0.1), 0.2, 1e-12);
  near(M.compute(st((s) => { s.basis = 'water'; })).poured.needL, 8.008, 1e-12);   /* 8 mL × 1001 份 */
  const edge = M.compute(st((s) => { s.fillL = '2'; s.tools[0] = { name: 'x', size: '10', res: '2.2' }; s.tol = '10'; }));
  near(edge.tools[0].err, 0.1, 1e-12); assert.strictEqual(edge.tools[0].ok, true, '偏差正好 10%（浮点 0.10000000000000009）算在容差内');
  assert.strictEqual(M.compute(M.stateFromPreset('lowN')).best.name, '20 mL 注射器', '三件都在容差内，挑偏差最小的');
  near(M.compute(st((s) => { s.canL = '3'; })).whole.fillL, 2, 1e-12, '3 L 壶装 1 份（2 L），不是 2 份（4 L）');
  const s1 = st((s) => { s.pouredJ = '1'; }); const a1 = M.compute(s1).actions.find((x) => x.key === 'use-best');
  assert.strictEqual(M.applyAction(s1, a1).pouredJ, '0', '倒的就是被搬到第一位的那件');
}
