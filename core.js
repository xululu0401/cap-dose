/* 瓶盖不是量杯 · 核心（core.js）
 * 纯函数，不碰 DOM、不读时间、不用随机：同样的输入永远给同样的输出。
 *
 * 一条链：
 *   标签写法（倍数 / 每多少水加多少 / 有效成分百分比）→ 统一成「倍数 N + 口径」
 *   → 这一壶要加多少药 p → 手边每件量具能不能量准（按最小刻度取整后的偏差）
 *   → 一共要几壶 → 刚才倒多了要补多少水 → 按整份反过来配多少水
 *
 * 所有「做不到」的情形都返回 ok=false 或对应 status，绝不返回 0 冒充结果。
 * 页面上的每个数字都必须能从同一次 compute 的输出里找到。
 * 本页不判断任何药剂/肥料的推荐浓度与安全性：浓度一律由用户按标签填写。
 */
(function (root) {
  'use strict';

  var K = {
    ROUND_EPS: 1e-9,     /* 取整前加一点，防 7.4999999 这种浮点残渣 */
    CEIL_EPS: 1e-9
  };

  var FIELDS = {
    N:         { label: '稀释倍数', unit: '倍', min: 1, max: 100000, def: 1000 },
    perX:      { label: '每多少升水', unit: 'L', min: 0.1, max: 1000, def: 15 },
    perY:      { label: '加多少药', unit: '', min: 0.001, max: 10000, def: 10 },
    pctProd:   { label: '产品有效成分', unit: '%', min: 0.001, max: 100, def: 20 },
    pctTarget: { label: '要兑到', unit: '%', min: 0.0001, max: 100, def: 0.02 },
    canL:      { label: '喷壶容量', unit: 'L', min: 0.05, max: 1000, def: 2 },
    fillL:     { label: '这一壶兑到', unit: 'L', min: 0.01, max: 1000, def: 1.5 },
    pots:      { label: '要喷/浇几盆', unit: '盆', min: 0, max: 10000, def: 12, int: true },
    perPot:    { label: '每盆大约用', unit: 'mL', min: 0, max: 100000, def: 150 },
    stock:     { label: '这瓶还剩', unit: '', min: 0, max: 100000, def: 100 },
    tol:       { label: '能接受的偏差', unit: '%', min: 0.5, max: 100, def: 10 },
    pouredK:   { label: '刚才已经倒了', unit: '个', min: 0, max: 1000, def: 1 }
  };
  var SCALARS = ['N', 'perX', 'perY', 'pctProd', 'pctTarget', 'canL', 'fillL', 'pots', 'perPot', 'stock', 'tol', 'pouredK'];
  var MODES = ['ratio', 'perVol', 'pct'];
  var BASES = ['total', 'water'];
  var UNITS = ['mL', 'g'];
  var MAX_TOOLS = 5, MIN_TOOLS = 1, NAME_MAX = 60;

  var DEF_TOOLS = [
    { name: '瓶盖', size: '8', res: '2' },
    { name: '5 mL 注射器', size: '5', res: '0.1' },
    { name: '小量杯', size: '50', res: '5' }
  ];

  var PRESETS = [
    { key: 'default', name: '默认：1000 倍 + 1.5 L 小喷壶',
      note: '标签写「稀释 1000 倍」，只兑 1.5 L，手边有瓶盖、注射器、量杯；刚才顺手倒了一盖。虚构示例。', state: {} },
    { key: 'pervol', name: '标签写「每 15 升水加 10 毫升」',
      note: '标签按 15 L 大喷雾器写的，换到 1 L 小壶上。虚构示例。',
      state: { mode: 'perVol', perX: '15', perY: '10', canL: '1', fillL: '1', pouredK: '0' } },
    { key: 'pct', name: '标签只写了有效成分百分比',
      note: '20% 的原液兑到 0.02%：先换成倍数再算。虚构示例。',
      state: { mode: 'pct', pctProd: '20', pctTarget: '0.02', pouredK: '0' } },
    { key: 'powder', name: '粉剂 + 小勺',
      note: '水溶肥粉剂按 500 倍兑 5 L，用 1 g 小勺与厨房秤。虚构示例。',
      state: { N: '500', unit: 'g', canL: '5', fillL: '5', pots: '30', perPot: '200', stock: '250', pouredK: '0',
        tools: [{ name: '1 g 小勺', size: '1', res: '0.5' }, { name: '厨房秤', size: '500', res: '1' }, { name: '汤匙', size: '12', res: '6' }] } },
    { key: 'lowN', name: '低倍数：口径差就显出来了',
      note: '20 倍的液体肥：「按总量」与「按水量」两种算法差 5%。虚构示例。',
      state: { N: '20', basis: 'water', canL: '1', fillL: '1', pots: '6', perPot: '150', pouredK: '0',
        tools: [{ name: '瓶盖', size: '10', res: '5' }, { name: '量杯', size: '100', res: '10' }, { name: '20 mL 注射器', size: '20', res: '1' }] } }
  ];

  function cloneTools(t) { return t.map(function (x) { return { name: String(x.name), size: String(x.size), res: String(x.res) }; }); }
  function defaultState() {
    var s = { mode: 'ratio', basis: 'total', unit: 'mL', pouredJ: '0', tools: cloneTools(DEF_TOOLS) };
    SCALARS.forEach(function (k) { s[k] = String(FIELDS[k].def); });
    return s;
  }
  function stateFromPreset(key) {
    var p = PRESETS.filter(function (x) { return x.key === key; })[0];
    var s = defaultState();
    if (!p) return s;
    Object.keys(p.state).forEach(function (k) {
      if (k === 'tools') s.tools = cloneTools(p.state.tools);
      else s[k] = String(p.state[k]);
    });
    return s;
  }
  function presetKey(state) {
    for (var i = 0; i < PRESETS.length; i++) {
      var ref = stateFromPreset(PRESETS[i].key);
      if (sameState(ref, state)) return PRESETS[i].key;
    }
    return null;
  }
  function sameState(a, b) {
    if (!a || !b) return false;
    var keys = SCALARS.concat(['mode', 'basis', 'unit', 'pouredJ']);
    for (var i = 0; i < keys.length; i++) if (String(a[keys[i]]) !== String(b[keys[i]])) return false;
    return JSON.stringify(cloneTools(a.tools || [])) === JSON.stringify(cloneTools(b.tools || []));
  }

  /* ── 数字解析：非数字一律报错并保留原文 ── */
  var NUM_RE = /^[+]?(\d+(\.\d*)?|\.\d+)$/;
  function parseRaw(raw) {
    var t = String(raw == null ? '' : raw).trim();
    if (t === '') return { code: 'empty' };
    if (/^-/.test(t)) return { code: 'negative', t: t };
    if (!NUM_RE.test(t)) return { code: 'not-number', t: t };
    var v = Number(t);
    if (!isFinite(v)) return { code: 'not-finite', t: t };
    return { v: v, t: t };
  }
  function msgOf(code, label, t) {
    if (code === 'empty') return label + '：这一格是空的。';
    if (code === 'negative') return label + '：不能是负数（你填的是 ' + t + '）。';
    if (code === 'not-number') return label + '：「' + t + '」不是一个数字（只接受十进制数字，可带小数点）。原文已保留，没有替你改。';
    return label + '：这个数算不出来。';
  }
  function parseField(state, key, errors) {
    var f = FIELDS[key];
    var r = parseRaw(state[key]);
    if (r.code) { errors.push({ field: key, code: r.code, message: msgOf(r.code, f.label, r.t) }); return null; }
    if (f.int && Math.floor(r.v) !== r.v) {
      errors.push({ field: key, code: 'not-int', message: f.label + '要填整数，你填的是 ' + r.t + '。' }); return null;
    }
    if (r.v < f.min || r.v > f.max) {
      errors.push({ field: key, code: 'range', message: f.label + '要在 ' + f.min + '–' + f.max + ' ' + f.unit + ' 之间，你填的是 ' + r.t + '。' });
      return null;
    }
    return r.v;
  }

  /* ── 格式 ── */
  function fmtV(v, d) {
    if (v == null || !isFinite(v)) return '—';
    var s = Number(v).toFixed(d == null ? 2 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function fmtPct(frac, d) {
    if (frac == null || !isFinite(frac)) return '—';
    var s = fmtV(frac * 100, d == null ? 1 : d);
    return (frac > 0 && s !== '0' ? '+' : '') + s + '%';
  }
  /* 药量：小于 1 时多留位数，免得 0.3 mL 被写成 0 */
  function fmtDose(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    return fmtV(v, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4);
  }

  function roundTo(x, res) { return Math.floor(x / res + 0.5 + K.ROUND_EPS) * res; }
  function clean(x) { return Math.round(x * 1e9) / 1e9; }   /* 去掉 0.30000000000000004 */

  /* 药量 p：总量口径 F/N，水量口径 F/(N+1) */
  function doseFor(F, N, basis) { return basis === 'water' ? F / (N + 1) : F / N; }
  function actualRatio(F, d, basis) { return basis === 'water' ? (F - d) / d : F / d; }
  function parts(N, basis) { return basis === 'water' ? N + 1 : N; }

  /* ── 主计算 ── */
  function compute(state) {
    state = state || defaultState();
    var errors = [], warnings = [];
    var mode = MODES.indexOf(state.mode) >= 0 ? state.mode : null;
    if (!mode) errors.push({ field: 'mode', code: 'enum', message: '标签写法只能是三种之一。' });
    var unit = UNITS.indexOf(state.unit) >= 0 ? state.unit : null;
    if (!unit) errors.push({ field: 'unit', code: 'enum', message: '药的单位只能是 mL 或 g。' });
    var basisIn = BASES.indexOf(state.basis) >= 0 ? state.basis : null;
    if (mode === 'ratio' && !basisIn) errors.push({ field: 'basis', code: 'enum', message: '口径只能是「按总量」或「按水量」。' });

    var v = {};
    var need = ['canL', 'fillL', 'pots', 'perPot', 'stock', 'tol', 'pouredK'];
    if (mode === 'ratio') need.unshift('N');
    if (mode === 'perVol') need.unshift('perX', 'perY');
    if (mode === 'pct') need.unshift('pctProd', 'pctTarget');
    need.forEach(function (k) { v[k] = parseField(state, k, errors); });

    /* 量具 */
    var toolsIn = Array.isArray(state.tools) ? state.tools : [];
    if (toolsIn.length < MIN_TOOLS || toolsIn.length > MAX_TOOLS) {
      errors.push({ field: 'tools', code: 'tool-count', message: '量具要有 ' + MIN_TOOLS + '–' + MAX_TOOLS + ' 件，现在是 ' + toolsIn.length + ' 件。' });
    }
    var tools = toolsIn.slice(0, MAX_TOOLS).map(function (t, i) {
      var name = String(t && t.name != null ? t.name : '').trim();
      var row = { idx: i, name: name, size: null, res: null };
      if (!name) errors.push({ field: 'tools', row: i, sub: 'name', code: 'row-name', message: '第 ' + (i + 1) + ' 件量具没有名字。' });
      else if (name.length > NAME_MAX) errors.push({ field: 'tools', row: i, sub: 'name', code: 'row-name-long', message: '第 ' + (i + 1) + ' 件量具的名字超过 ' + NAME_MAX + ' 字。' });
      ['size', 'res'].forEach(function (sub) {
        var lab = '第 ' + (i + 1) + ' 件量具的' + (sub === 'size' ? '「一满多少」' : '「最小能分辨」');
        var r = parseRaw(t ? t[sub] : '');
        if (r.code) { errors.push({ field: 'tools', row: i, sub: sub, code: 'row-' + sub, message: msgOf(r.code, lab, r.t) }); return; }
        if (r.v < 0.001 || r.v > 10000) { errors.push({ field: 'tools', row: i, sub: sub, code: 'row-' + sub, message: lab + '要在 0.001–10000 之间，你填的是 ' + r.t + '。' }); return; }
        row[sub] = r.v;
      });
      if (row.size != null && row.res != null && row.res > row.size) {
        errors.push({ field: 'tools', row: i, sub: 'res', code: 'row-res-gt-size', message: '第 ' + (i + 1) + ' 件量具的最小刻度（' + row.res + '）比一满（' + row.size + '）还大。' });
      }
      return row;
    });

    var pj = parseRaw(state.pouredJ);
    var pouredJ = (!pj.code && Math.floor(pj.v) === pj.v && pj.v < tools.length) ? pj.v : null;
    if (pouredJ == null) errors.push({ field: 'pouredJ', code: 'enum', message: '「倒的是哪一件量具」没选对。' });

    /* 倍数与口径 */
    var N = null, basis = null, source = '';
    if (mode === 'ratio' && v.N != null && basisIn) {
      N = v.N; basis = basisIn;
      if (basis === 'total' && N <= 1) errors.push({ field: 'N', code: 'n-total-le1', message: '「按总量」口径下倍数必须大于 1（1 倍就是原液，不用兑水）。' });
      source = '标签写稀释 ' + fmtV(N, 4) + ' 倍（' + (basis === 'total' ? '按总量：药+水一共 ' + fmtV(N, 4) + ' 份' : '按水量：水是药的 ' + fmtV(N, 4) + ' 倍') + '）';
    }
    if (mode === 'perVol' && v.perX != null && v.perY != null) {
      N = v.perX * 1000 / v.perY; basis = 'water';
      if (N < 1) errors.push({ field: 'perY', code: 'pervol-thick', message: '每 ' + fmtV(v.perX, 3) + ' L 水加 ' + fmtV(v.perY, 3) + '，药比水还多，这不是稀释。' });
      source = '标签写每 ' + fmtV(v.perX, 3) + ' L 水加 ' + fmtV(v.perY, 3) + ' ' + (unit || '') + ' → 水是药的 ' + fmtV(N, 2) + ' 倍（按水量）';
    }
    if (mode === 'pct' && v.pctProd != null && v.pctTarget != null) {
      if (v.pctTarget >= v.pctProd) {
        errors.push({ field: 'pctTarget', code: 'pct-not-dilute', message: '要兑到的 ' + fmtV(v.pctTarget, 4) + '% 不比产品本身的 ' + fmtV(v.pctProd, 4) + '% 低，没法靠加水兑出来。' });
      } else {
        N = v.pctProd / v.pctTarget; basis = 'total';
        source = '产品含 ' + fmtV(v.pctProd, 4) + '%，要兑到 ' + fmtV(v.pctTarget, 4) + '% → 相当于稀释 ' + fmtV(N, 2) + ' 倍（按总量）';
      }
    }
    if (v.fillL != null && v.canL != null && v.fillL > v.canL) {
      errors.push({ field: 'fillL', code: 'fill-gt-can', message: '这一壶兑到 ' + fmtV(v.fillL, 3) + ' L，比壶的容量 ' + fmtV(v.canL, 3) + ' L 还多。' });
    }

    if (errors.length) return { ok: false, errors: errors, warnings: warnings, raw: v, tools: tools };

    var F = v.fillL * 1000;            /* mL */
    var p = doseFor(F, N, basis);
    var water = F - p;
    var perL = doseFor(1000, N, basis);
    var otherBasis = basis === 'total' ? 'water' : 'total';
    var pOther = (otherBasis === 'total' && N <= 1) ? null : doseFor(F, N, otherBasis);
    var basisDiff = pOther == null ? null : (pOther - p) / p;
    var tol = v.tol / 100;

    /* 量具 */
    var rows = tools.map(function (t) {
      var d = clean(roundTo(p, t.res));
      var r = { idx: t.idx, name: t.name, size: t.size, res: t.res, fills: p / t.size, measured: d };
      if (d === 0) {
        r.status = 'cannot'; r.err = null; r.ratio = null; r.ok = false;
        r.text = '最小能分辨 ' + fmtDose(t.res) + ' ' + unit + '，要的只有 ' + fmtDose(p) + ' ' + unit + '，量不出来';
      } else {
        r.err = (d - p) / p;
        if (Math.abs(r.err) < 1e-12) r.err = 0;
        r.ratio = actualRatio(F, d, basis);
        r.ok = Math.abs(r.err) <= tol + 1e-12;
        r.status = r.ok ? 'ok' : 'off';
        r.overFill = d > t.size + 1e-12;
        r.times = r.overFill ? Math.ceil(d / t.size - K.CEIL_EPS) : 1;
        r.text = '量出 ' + fmtDose(d) + ' ' + unit + '，偏 ' + fmtPct(r.err, 1) + '，实际约 ' + fmtV(r.ratio, 0) + ' 倍' + (r.overFill ? '（要分 ' + r.times + ' 次量）' : '');
      }
      return r;
    });
    /* 首推：在容差内的里面偏差最小；并列取分辨最粗（最好量）的那件；都不在容差内 → best=null */
    var okRows = rows.filter(function (r) { return r.ok; });
    okRows.sort(function (a, b) { return Math.abs(a.err) - Math.abs(b.err) || b.res - a.res || a.idx - b.idx; });
    var best = okRows.length ? okRows[0] : null;
    var closest = rows.filter(function (r) { return r.status !== 'cannot'; })
      .sort(function (a, b) { return Math.abs(a.err) - Math.abs(b.err) || a.idx - b.idx; })[0] || null;

    /* 用量与壶数 */
    var totalL = v.pots * v.perPot / 1000;
    var cans = null;
    if (totalL > 0) {
      var n = Math.ceil(totalL / v.fillL - K.CEIL_EPS);
      var last = clean(totalL - (n - 1) * v.fillL);
      cans = { totalL: totalL, n: n, lastL: last, lastDose: doseFor(last * 1000, N, basis), totalDose: doseFor(totalL * 1000, N, basis), fullCans: n - 1 };
      if (totalL < v.fillL - 1e-12) warnings.push({ code: 'fill-more-than-need', message: '这次只要 ' + fmtV(totalL, 3) + ' L，你却兑 ' + fmtV(v.fillL, 3) + ' L：多出的 ' + fmtV(v.fillL - totalL, 3) + ' L 会剩下。' });
    }
    var stock = v.stock > 0 ? { left: v.stock, cansPerBottle: v.stock / p, enough: cans ? v.stock >= cans.totalDose - 1e-12 : null } : null;

    /* 倒多了 / 倒少了 */
    var poured = null;
    if (v.pouredK > 0) {
      var tool = tools[pouredJ];
      var q = v.pouredK * tool.size;
      var times = q / p;
      var Fneed = q * parts(N, basis);           /* mL，救回需要的总量 */
      poured = { tool: tool.name, k: v.pouredK, q: q, times: times, ratio: q < F ? actualRatio(F, q, basis) : null };
      if (q >= F) {
        poured.status = 'over-liquid';
        poured.text = '倒进去的药（' + fmtDose(q) + ' ' + unit + '）已经不比这一壶的总量少，没法当作稀释液。';
      } else if (Math.abs(times - 1) <= tol + 1e-12) {
        poured.status = 'fine';
        poured.text = '在你能接受的偏差内，不用补。';
      } else if (times < 1) {
        poured.status = 'under';
        poured.addDose = p - q;
        poured.text = '倒少了：还差 ' + fmtDose(p - q) + ' ' + unit + '。';
      } else {
        poured.status = 'over';
        poured.needL = Fneed / 1000;
        poured.addWaterL = (Fneed - F) / 1000;
        poured.fitsCan = poured.needL <= v.canL + 1e-12;
        poured.cansWorth = Math.ceil(poured.needL / v.canL - K.CEIL_EPS);
        poured.beyondNeed = cans ? poured.needL > cans.totalL + 1e-12 : null;
        poured.surplusL = cans && poured.beyondNeed ? clean(poured.needL - cans.totalL) : null;
        poured.text = '要救回，得把总量补到 ' + fmtV(poured.needL, 3) + ' L（再加 ' + fmtV(poured.addWaterL, 3) + ' L 水）' +
          (poured.fitsCan ? '，壶装得下。' : '，可你的壶只有 ' + fmtV(v.canL, 3) + ' L，装不下，需要约 ' + poured.cansWorth + ' 壶的容器。') +
          (poured.surplusL != null ? '这次一共只要 ' + fmtV(cans.totalL, 3) + ' L，补齐后会多出 ' + fmtV(poured.surplusL, 3) + ' L 用不完。' : '');
      }
    }

    /* 按整份配：用排在第 1 位的量具（你顺手会拿的那件）的最小刻度，反过来定这一壶兑多少水 */
    var wholeTool = rows[0];
    var r0 = wholeTool.res;
    var unitL = r0 * parts(N, basis) / 1000;     /* 一份最小刻度药对应的总量 L */
    var m = Math.floor(v.canL / unitL + K.ROUND_EPS);
    var whole = { tool: wholeTool.name, res: r0, perUnitL: unitL };
    if (m < 1) {
      whole.status = 'too-big';
      whole.text = wholeTool.name + '最小一份 ' + fmtDose(r0) + ' ' + unit + ' 要配 ' + fmtV(unitL, 3) + ' L，比壶（' + fmtV(v.canL, 3) + ' L）还大。';
    } else {
      whole.status = 'ok'; whole.m = m; whole.dose = clean(m * r0); whole.fillL = clean(m * unitL);
      whole.fills = whole.dose / wholeTool.size;
      whole.text = '用' + wholeTool.name + '量 ' + fmtDose(whole.dose) + ' ' + unit + '（' + m + ' 格最小刻度，约 ' + fmtV(whole.fills, 2) + ' 个满' + wholeTool.name + '），配到 ' + fmtV(whole.fillL, 3) + ' L。';
    }

    /* 建议（每条都能作用于输入） */
    var actions = [];
    if (best && best.idx !== 0 && (!rows[0].ok || Math.abs(rows[0].err) > Math.abs(best.err) + 1e-12)) actions.push({ key: 'use-best', text: '别用' + rows[0].name + '，改用' + best.name + '量（偏差 ' + fmtPct(best.err, 1) + '）', apply: { moveToolFirst: best.idx } });
    if (whole.status === 'ok' && Math.abs(whole.fillL - v.fillL) > 1e-9) actions.push({ key: 'whole', text: '按整格配：这一壶改兑 ' + fmtV(whole.fillL, 3) + ' L、加 ' + fmtDose(whole.dose) + ' ' + unit, apply: { fillL: fmtV(whole.fillL, 6) } });
    if (poured && poured.status === 'over' && poured.fitsCan) actions.push({ key: 'rescue', text: '把刚才那壶补水到 ' + fmtV(poured.needL, 3) + ' L', apply: { fillL: fmtV(poured.needL, 6), pouredK: '0' } });
    var wholeSameAsCan = whole.status === 'ok' && Math.abs(whole.fillL - v.canL) <= 1e-9;
    if (!wholeSameAsCan && cans && cans.n > 1 && v.canL > v.fillL + 1e-9 && Math.ceil(cans.totalL / v.canL - K.CEIL_EPS) < cans.n) actions.push({ key: 'fill-can', text: '每壶兑满 ' + fmtV(v.canL, 3) + ' L，只要 ' + Math.ceil(cans.totalL / v.canL - K.CEIL_EPS) + ' 壶', apply: { fillL: fmtV(v.canL, 6) } });

    if (!best) warnings.push({ code: 'no-tool', message: '手边这几件量具都量不准（偏差都超过 ' + fmtV(v.tol, 1) + '%）。看「按整格配」那条，或者换一件刻度更细的。' });
    if (basisDiff != null && Math.abs(basisDiff) >= 0.02) warnings.push({ code: 'basis-matters', message: '倍数低时两种口径差得多：按另一种口径要 ' + fmtDose(pOther) + ' ' + unit + '，差 ' + fmtPct(basisDiff, 1) + '。以标签说法为准。' });
    if (stock && cans && !stock.enough) warnings.push({ code: 'stock-short', message: '这瓶只剩 ' + fmtDose(stock.left) + ' ' + unit + '，这次一共要 ' + fmtDose(cans.totalDose) + ' ' + unit + '，不够。' });

    return {
      ok: true, errors: [], warnings: warnings,
      raw: v, mode: mode, unit: unit, N: N, basis: basis, source: source,
      fillMl: F, dose: p, water: water, perL: perL, pOther: pOther, basisDiff: basisDiff, tol: tol,
      tools: rows, best: best, closest: closest, cans: cans, stock: stock, poured: poured, whole: whole, actions: actions
    };
  }

  /* 把一条建议作用到 state 上（返回新 state，不改原来的） */
  function applyAction(state, action) {
    var s = JSON.parse(JSON.stringify(state));
    var a = action.apply || {};
    if (a.moveToolFirst != null) {
      var t = s.tools.splice(a.moveToolFirst, 1)[0];
      s.tools.unshift(t);
      var j = Number(s.pouredJ);
      if (j === a.moveToolFirst) s.pouredJ = '0';
      else if (j < a.moveToolFirst) s.pouredJ = String(j + 1);
    }
    Object.keys(a).forEach(function (k) { if (k !== 'moveToolFirst') s[k] = a[k]; });
    return s;
  }

  /* ── 导出 ── */
  function csvCell(x) { var t = String(x == null ? '' : x); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function toCSV(out, stamp) {
    var L = [['项目', '值'].join(',')];
    L.push(['导出时间', stamp].map(csvCell).join(','));
    L.push(['说明', '默认场景是虚构示例；浓度以产品标签为准，本页不判断安全性'].map(csvCell).join(','));
    if (!out.ok) { out.errors.forEach(function (e) { L.push(['算不出来', e.message].map(csvCell).join(',')); }); return L.join('\n') + '\n'; }
    var u = out.unit;
    [['标签换算', out.source], ['这一壶总量 L', fmtV(out.fillMl / 1000, 3)], ['加药 ' + u, fmtDose(out.dose)], ['加水 mL', fmtV(out.water, 2)], ['每升药量 ' + u, fmtDose(out.perL)]]
      .forEach(function (r) { L.push(r.map(csvCell).join(',')); });
    L.push('');
    L.push(['量具', '一满', '最小刻度', '份数', '量出', '偏差', '实际倍数', '结论'].join(','));
    out.tools.forEach(function (t) {
      L.push([t.name, t.size, t.res, fmtV(t.fills, 4), fmtDose(t.measured), t.err == null ? '' : fmtPct(t.err, 2), t.ratio == null ? '' : fmtV(t.ratio, 1),
        t.status === 'ok' ? '在容差内' : t.status === 'off' ? '超容差' : '量不出来'].map(csvCell).join(','));
    });
    if (out.cans) { L.push(''); L.push(['一共要 L', fmtV(out.cans.totalL, 3)].join(',')); L.push(['几壶', out.cans.n].join(',')); L.push(['最后一壶 L', fmtV(out.cans.lastL, 3)].join(',')); L.push(['总药量 ' + u, fmtDose(out.cans.totalDose)].join(',')); }
    if (out.poured) L.push(['刚才倒的', out.poured.text].map(csvCell).join(','));
    L.push(['按整格配', out.whole.text].map(csvCell).join(','));
    return L.join('\n') + '\n';
  }
  function toMD(out, stamp) {
    var L = ['# 配药单 · 瓶盖不是量杯', '', '- 导出时间：' + stamp, '- 默认场景是虚构示例；浓度以产品标签为准，本页不判断安全性。', ''];
    if (!out.ok) { L.push('## 算不出来'); out.errors.forEach(function (e) { L.push('- ' + e.message); }); return L.join('\n') + '\n'; }
    var u = out.unit;
    L.push('## 这一壶', '', '- ' + out.source, '- 兑到 ' + fmtV(out.fillMl / 1000, 3) + ' L：加药 **' + fmtDose(out.dose) + ' ' + u + '**、加水 ' + fmtV(out.water, 1) + ' mL', '');
    L.push('## 用哪件量', '', '| 量具 | 量出 | 偏差 | 实际倍数 | 结论 |', '|---|---|---|---|---|');
    out.tools.forEach(function (t) {
      L.push('| ' + t.name.replace(/\|/g, '/') + ' | ' + fmtDose(t.measured) + ' ' + u + ' | ' + (t.err == null ? '—' : fmtPct(t.err, 1)) + ' | ' + (t.ratio == null ? '—' : fmtV(t.ratio, 0)) + ' | ' +
        (t.status === 'ok' ? '在容差内' : t.status === 'off' ? '超容差' : '量不出来') + ' |');
    });
    L.push('');
    if (out.cans) L.push('## 用量', '', '- 一共要 ' + fmtV(out.cans.totalL, 3) + ' L → ' + out.cans.n + ' 壶（最后一壶 ' + fmtV(out.cans.lastL, 3) + ' L，加药 ' + fmtDose(out.cans.lastDose) + ' ' + u + '）', '- 总药量 ' + fmtDose(out.cans.totalDose) + ' ' + u, '');
    if (out.poured) L.push('## 刚才倒的', '', '- 倒了 ' + fmtV(out.poured.k, 3) + ' 个' + out.poured.tool + ' = ' + fmtDose(out.poured.q) + ' ' + u + '：' + out.poured.text, '');
    L.push('## 按整格配', '', '- ' + out.whole.text, '');
    if (out.warnings.length) { L.push('## 提醒', ''); out.warnings.forEach(function (w) { L.push('- ' + w.message); }); L.push(''); }
    L.push('## 边界', '', '- 只做按标签的算术：不推荐浓度，不判断安全、药害、安全间隔期。', '- 量具按最小能分辨的刻度四舍五入，是对手量的简化。', '- AI 自行复核，未做人工校核。');
    return L.join('\n') + '\n';
  }

  var API = {
    K: K, FIELDS: FIELDS, SCALARS: SCALARS, PRESETS: PRESETS, MAX_TOOLS: MAX_TOOLS, NAME_MAX: NAME_MAX,
    defaultState: defaultState, stateFromPreset: stateFromPreset, presetKey: presetKey, sameState: sameState,
    compute: compute, applyAction: applyAction, toCSV: toCSV, toMD: toMD,
    fmtV: fmtV, fmtPct: fmtPct, fmtDose: fmtDose, doseFor: doseFor, roundTo: roundTo
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.AppCore = API;
})(typeof window !== 'undefined' ? window : this);
