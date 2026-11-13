/* 瓶盖不是量杯 · 界面（ui.js）
 * 只做三件事：把输入读成 state → 交给 AppCore.compute → 把同一次输出画出来。
 * 页面上不自己算任何数；所有数字都来自 compute 的同一次输出。 */
(function () {
  'use strict';
  var A = window.AppCore;
  var KEY = 'cap-dose:v1';
  var $ = function (id) { return document.getElementById(id); };
  var state = load() || A.defaultState();
  var out = null;
  var openStep = 1;

  function load() {
    try {
      var t = localStorage.getItem(KEY);
      if (!t) return null;
      var s = JSON.parse(t);
      return sanitize(s);
    } catch (e) { return null; }
  }
  /* 只接受我们认识的字段，值一律转成字符串（原文保留，非法的交给 compute 报错） */
  function sanitize(s) {
    if (!s || typeof s !== 'object') return null;
    var d = A.defaultState();
    Object.keys(d).forEach(function (k) {
      if (k === 'tools') return;
      if (s[k] != null) d[k] = String(s[k]);
    });
    if (Array.isArray(s.tools) && s.tools.length) {
      d.tools = s.tools.slice(0, A.MAX_TOOLS).map(function (t) {
        t = t || {};
        return { name: String(t.name == null ? '' : t.name), size: String(t.size == null ? '' : t.size), res: String(t.res == null ? '' : t.res) };
      });
    }
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); $('saveTag').textContent = '· 已存到本机'; }
    catch (e) { $('saveTag').textContent = '· 没能存到本机'; }
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ── 预设 ── */
  function renderPresets() {
    var k = A.presetKey(state);
    $('presets').innerHTML = A.PRESETS.map(function (p) {
      return '<button type="button" class="chip" id="preset_' + p.key + '" data-p="' + p.key + '" aria-pressed="' + (k === p.key) + '">' + esc(p.name) + '</button>';
    }).join('');
    var cur = A.PRESETS.filter(function (p) { return p.key === k; })[0];
    $('presetNote').textContent = cur ? cur.note : '已按你的输入计算（不是预设）。';
  }
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (!b) return;
    state = A.stateFromPreset(b.getAttribute('data-p'));
    fillInputs(); update();
  });

  /* ── 量具行 ── */
  function renderToolRows() {
    var u = state.unit === 'g' ? 'g' : 'mL';
    $('toolRows').innerHTML = state.tools.map(function (t, i) {
      return '<div class="toolrow" data-row="' + i + '">' +
        '<div class="f" id="f_t' + i + '_name"><label for="t' + i + '_name">第 ' + (i + 1) + ' 件</label><input id="t' + i + '_name" data-i="' + i + '" data-sub="name" value="' + esc(t.name) + '"><div class="msg"></div></div>' +
        '<div class="f" id="f_t' + i + '_size"><label for="t' + i + '_size">一满<i>' + u + '</i></label><input id="t' + i + '_size" data-i="' + i + '" data-sub="size" inputmode="decimal" value="' + esc(t.size) + '"><div class="msg"></div></div>' +
        '<div class="f" id="f_t' + i + '_res"><label for="t' + i + '_res">最小能分辨<i>' + u + '</i></label><input id="t' + i + '_res" data-i="' + i + '" data-sub="res" inputmode="decimal" value="' + esc(t.res) + '"><div class="msg"></div></div>' +
        '<button type="button" class="btn ghost mini" data-del="' + i + '"' + (state.tools.length <= 1 ? ' disabled' : '') + ' aria-label="删掉第 ' + (i + 1) + ' 件">删</button>' +
        '<div class="rowmsg" id="rowmsg' + i + '"></div></div>';
    }).join('');
    $('addTool').disabled = state.tools.length >= A.MAX_TOOLS;
    var sel = $('pouredJ'), j = state.pouredJ;
    sel.innerHTML = state.tools.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name || ('第 ' + (i + 1) + ' 件')) + '</option>'; }).join('');
    sel.value = j;
  }
  $('toolRows').addEventListener('input', function (e) {
    var el = e.target; if (!el.hasAttribute('data-i')) return;
    state.tools[+el.getAttribute('data-i')][el.getAttribute('data-sub')] = el.value;
    if (el.getAttribute('data-sub') === 'name') {
      var o = $('pouredJ').options[+el.getAttribute('data-i')];
      if (o) o.textContent = el.value || ('第 ' + (+el.getAttribute('data-i') + 1) + ' 件');
    }
    update();
  });
  $('toolRows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b || b.disabled) return;
    var i = +b.getAttribute('data-del');
    state.tools.splice(i, 1);
    var j = Number(state.pouredJ);
    if (j === i) state.pouredJ = '0'; else if (j > i) state.pouredJ = String(j - 1);
    renderToolRows(); update();
  });
  $('addTool').addEventListener('click', function () {
    if (state.tools.length >= A.MAX_TOOLS) return;
    state.tools.push({ name: '新量具', size: '10', res: '1' });
    renderToolRows(); update();
  });

  /* ── 标量输入 ── */
  var SIMPLE = A.SCALARS.concat(['basis', 'unit', 'pouredJ']);
  function fillInputs() {
    A.SCALARS.forEach(function (k) { $(k).value = state[k]; });
    $('basis').value = state.basis; $('unit').value = state.unit;
    renderToolRows();
  }
  SIMPLE.forEach(function (k) {
    var el = $(k);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
      state[k] = el.value;
      if (k === 'unit') renderToolRows();
      update();
    });
  });
  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]'); if (!b) return;
    state.mode = b.getAttribute('data-mode'); update();
  });

  /* ── 向导开合 ── */
  function setStep(n) { openStep = n; [1, 2, 3, 4].forEach(function (i) { $('step' + i).classList.toggle('open', i === n); }); }
  document.querySelectorAll('.step>header').forEach(function (h) {
    h.addEventListener('click', function () { var n = +h.getAttribute('data-step'); setStep(openStep === n ? 0 : n); });
  });
  document.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { setStep(+b.getAttribute('data-go')); }); });

  /* ── 渲染 ── */
  function markErrors() {
    document.querySelectorAll('.f.bad').forEach(function (f) { f.classList.remove('bad'); f.querySelector('.msg').textContent = ''; });
    document.querySelectorAll('.rowmsg').forEach(function (m) { m.textContent = ''; });
    [1, 2, 3, 4].forEach(function (i) { $('step' + i).classList.remove('bad'); });
    var stepOf = { mode: 1, N: 1, basis: 1, perX: 1, perY: 1, pctProd: 1, pctTarget: 1, unit: 1, canL: 2, fillL: 2, pots: 2, perPot: 2, stock: 2, tools: 3, tol: 3, pouredK: 4, pouredJ: 4 };
    (out.errors || []).forEach(function (e) {
      var id = e.field === 'tools' && e.row != null ? 'f_t' + e.row + '_' + (e.sub || 'name') : 'f_' + e.field;
      var f = $(id);
      if (f) { f.classList.add('bad'); var m = f.querySelector('.msg'); m.textContent = (m.textContent ? m.textContent + ' ' : '') + e.message; }
      if (e.field === 'tools' && e.row != null && $('rowmsg' + e.row)) { var rm = $('rowmsg' + e.row); rm.textContent = (rm.textContent ? rm.textContent + ' ' : '') + e.message; }
      if (stepOf[e.field]) $('step' + stepOf[e.field]).classList.add('bad');
    });
  }
  function U() { return out.unit || (state.unit === 'g' ? 'g' : 'mL'); }
  function summaries() {
    var u = state.unit === 'g' ? 'g' : 'mL';
    $('sum1').textContent = out.ok ? out.source : '还有没填对的格子';
    $('sum2').textContent = '壶 ' + state.canL + ' L，这一壶兑 ' + state.fillL + ' L' + (Number(state.pots) > 0 ? '，' + state.pots + ' 盆 × ' + state.perPot + ' mL' : '');
    $('sum3').textContent = state.tools.map(function (t) { return t.name + ' ' + t.size + u; }).join(' / ') + '，容差 ' + state.tol + '%';
    $('sum4').textContent = Number(state.pouredK) > 0 ? '倒了 ' + state.pouredK + ' 个' + ((state.tools[+state.pouredJ] || {}).name || '') : '还没倒';
  }
  function gauge(err) {
    /* 刻度条：中线 = 标签浓度；左右各到 ±100%；绿带 = 容差 */
    var tolPct = Math.min(out.tol, 1) * 50;
    var x = err == null ? null : 50 + Math.max(-1, Math.min(1, err)) * 50;
    return '<div class="gauge" aria-hidden="true"><i style="left:' + (50 - tolPct) + '%;width:' + (2 * tolPct) + '%"></i><u></u>' +
      (x == null ? '' : '<b style="left:calc(' + x + '% - 1.5px)"></b>') + '</div>';
  }
  function render() {
    var bad = !out.ok;
    $('errBox').classList.toggle('hide', !bad);
    $('okPart').classList.toggle('hide', bad);
    ['dlCsv', 'dlMd', 'dlPng'].forEach(function (id) { $(id).disabled = false; });
    if (bad) {
      $('errBox').innerHTML = '<b>还算不出来</b>，先把这些改对（原文都保留着）：<ul>' + out.errors.map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') + '</ul>';
      return;
    }
    var u = U();
    $('srcLine').textContent = out.source;
    $('bigDose').innerHTML = esc(A.fmtDose(out.dose)) + ' <small>' + u + ' 药 + ' + esc(A.fmtV(out.water, 1)) + ' mL 水</small>';
    $('verdict').innerHTML = out.best
      ? '用<b>' + esc(out.best.name) + '</b>量：' + esc(out.best.text) + '。'
      : '手边这几件都量不准（偏差都超过 ' + esc(A.fmtV(out.raw.tol, 1)) + '%），看下面「按整格配」。';
    $('toolCards').innerHTML = out.tools.map(function (t) {
      var tag = t.status === 'ok' ? '<span class="tag ok">在容差内</span>' : t.status === 'off' ? '<span class="tag off">超容差</span>' : '<span class="tag cannot">量不出来</span>';
      if (out.best && out.best.idx === t.idx) tag = '<span class="tag best">首推</span>';
      return '<div class="tool" data-tool="' + t.idx + '"><div class="nm">' + esc(t.name) + ' <span class="muted">' + esc(A.fmtV(t.fills, 3)) + ' 个满</span></div>' + tag +
        '<div class="tx">' + esc(t.text) + '</div>' + gauge(t.err) + '</div>';
    }).join('');

    var P = out.poured;
    $('pouredBlock').classList.toggle('hide', !P);
    if (P) {
      var cls = P.status === 'fine' ? 'ok' : P.status === 'over' && P.fitsCan ? 'warn' : P.status === 'under' ? 'warn' : 'bad';
      $('pouredBox').className = 'box ' + cls;
      $('pouredBox').innerHTML = '倒了 ' + esc(A.fmtV(P.k, 3)) + ' 个' + esc(P.tool) + ' = <b>' + esc(A.fmtDose(P.q)) + ' ' + u + '</b>' +
        (P.status === 'over-liquid' ? '。' : '，是要的 ' + esc(A.fmtV(P.times, 2)) + ' 倍' + (P.ratio != null ? '（实际约 ' + esc(A.fmtV(P.ratio, 0)) + ' 倍稀释）' : '') + '。') + esc(P.text);
    }
    var Cn = out.cans;
    $('cansBlock').classList.toggle('hide', !Cn);
    if (Cn) {
      $('cansKv').innerHTML = [
        ['一共要', A.fmtV(Cn.totalL, 3) + ' L'],
        ['按这一壶兑', Cn.n + ' 壶' + (Cn.n > 1 ? '（最后一壶 ' + A.fmtV(Cn.lastL, 3) + ' L、加 ' + A.fmtDose(Cn.lastDose) + ' ' + u + '）' : '')],
        ['一共用药', A.fmtDose(Cn.totalDose) + ' ' + u]
      ].concat(out.stock ? [['这瓶剩下的够', A.fmtV(out.stock.cansPerBottle, 1) + ' 壶']] : []).map(function (r) { return '<span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>'; }).join('');
    }
    $('wholeLine').textContent = out.whole.text;
    $('warnBox').classList.toggle('hide', !out.warnings.length);
    $('warnBox').innerHTML = '<ul>' + out.warnings.map(function (w) { return '<li>' + esc(w.message) + '</li>'; }).join('') + '</ul>';
    $('actsBlock').classList.toggle('hide', !out.actions.length);
    $('acts').innerHTML = out.actions.map(function (a, i) { return '<button type="button" class="act" id="act_' + a.key + '" data-a="' + i + '">→ ' + esc(a.text) + '</button>'; }).join('');
  }
  $('acts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    state = A.applyAction(state, out.actions[+b.getAttribute('data-a')]);
    fillInputs(); update();
  });

  function update() {
    out = A.compute(state);
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === state.mode)); });
    $('modeRatio').classList.toggle('hide', state.mode !== 'ratio');
    $('modePerVol').classList.toggle('hide', state.mode !== 'perVol');
    $('modePct').classList.toggle('hide', state.mode !== 'pct');
    document.querySelectorAll('.uLab').forEach(function (el) { el.textContent = state.unit === 'g' ? 'g' : 'mL'; });
    markErrors(); summaries(); render(); renderPresets(); save();
  }

  /* ── 导出 ── */
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  $('dlCsv').addEventListener('click', function () { download('瓶盖不是量杯-配药单.csv', new Blob(['\ufeff' + A.toCSV(out, stamp())], { type: 'text/csv;charset=utf-8' })); });
  $('dlMd').addEventListener('click', function () { download('瓶盖不是量杯-配药单.md', new Blob([A.toMD(out, stamp())], { type: 'text/markdown;charset=utf-8' })); });
  $('dlJson').addEventListener('click', function () {
    download('瓶盖不是量杯-备份.json', new Blob([JSON.stringify({ app: '瓶盖不是量杯', slug: 'cap-dose', version: 1, exported_at: stamp(), state: state, out: out }, null, 2)], { type: 'application/json' }));
  });
  $('impJson').addEventListener('click', function () { $('impFile').click(); });
  $('impFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { importText(String(r.result)); };
    r.readAsText(f); this.value = '';
  });
  function importText(t) {
    var s = null;
    try { var j = JSON.parse(t); s = sanitize(j && j.state ? j.state : j); } catch (e) { s = null; }
    if (!s) { $('saveTag').textContent = '· 这个文件读不出来，没改动'; return false; }
    state = s; fillInputs(); update(); return true;
  }
  $('reset').addEventListener('click', function () { state = A.defaultState(); fillInputs(); update(); setStep(1); });

  /* PNG 配药单 1080×1350：所有文字都取自 out */
  function wrapText(ctx, text, maxW) {
    var lines = [], cur = '';
    Array.from(String(text)).forEach(function (ch) {
      /* 折行后新行不以空格开头（目检结果卡发现「多出 / 空格 6.2 L」） */
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch === ' ' ? '' : ch; } else cur += ch;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawCard() {
    var W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var F = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif', M = 'ui-monospace,Menlo,Consolas,monospace';
    g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fffdf8'; g.fillRect(48, 48, W - 96, H - 96);
    g.fillStyle = '#56702b'; for (var x = 48; x < W - 48; x += 20) g.fillRect(x, 48, 14, 8);
    var y = 130, L = 92, R = W - 92, maxW = R - L;
    function txt(t, size, color, font, bold) { g.font = (bold ? '700 ' : '') + size + 'px ' + (font || F); g.fillStyle = color; g.fillText(t, L, y); }
    function para(t, size, color, lh) {
      g.font = size + 'px ' + F; g.fillStyle = color;
      wrapText(g, t, maxW).slice(0, 4).forEach(function (l) { g.fillText(l, L, y); y += lh; });
    }
    txt('配药单 · 瓶盖不是量杯', 40, '#2b2a22', F, true); y += 44;
    g.font = '22px ' + F; g.fillStyle = '#827d66'; g.fillText('导出时间 ' + stamp() + ' · 浓度以产品标签为准', L, y); y += 56;
    if (!out.ok) {
      txt('还算不出来', 44, '#a4471f', F, true); y += 60;
      out.errors.slice(0, 10).forEach(function (e) { para('· ' + e.message, 26, '#55523f', 38); });
      return c;
    }
    var u = U();
    para(out.source, 26, '#55523f', 38); y += 30;
    txt('这一壶 ' + A.fmtV(out.fillMl / 1000, 3) + ' L 加', 30, '#55523f'); y += 96;
    txt(A.fmtDose(out.dose) + ' ' + u, 96, '#56702b', M, true); y += 54;
    txt('水 ' + A.fmtV(out.water, 1) + ' mL', 30, '#55523f'); y += 56;
    g.strokeStyle = '#e3ddc9'; g.setLineDash([8, 8]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]); y += 50;
    out.tools.forEach(function (t) {
      var isBest = out.best && out.best.idx === t.idx;
      g.font = '700 28px ' + F; g.fillStyle = '#2b2a22';
      var nm = wrapText(g, t.name, maxW - 200)[0];
      g.fillText(nm + (nm !== t.name ? '…' : ''), L, y);
      var tag = isBest ? '首推' : t.status === 'ok' ? '在容差内' : t.status === 'off' ? '超容差' : '量不出来';
      g.font = '700 24px ' + F; g.fillStyle = isBest ? '#56702b' : t.status === 'off' ? '#8a6512' : t.status === 'ok' ? '#2f6b3a' : '#777';
      g.textAlign = 'right'; g.fillText(tag, R, y); g.textAlign = 'left'; y += 38;
      para(t.text, 24, '#55523f', 34); y += 14;
    });
    g.strokeStyle = '#e3ddc9'; g.setLineDash([8, 8]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]); y += 46;
    if (out.poured) { para('刚才倒了 ' + A.fmtV(out.poured.k, 3) + ' 个' + out.poured.tool + ' = ' + A.fmtDose(out.poured.q) + ' ' + u + '：' + out.poured.text, 25, '#a4471f', 36); y += 14; }
    if (out.cans) { para('一共要 ' + A.fmtV(out.cans.totalL, 3) + ' L → ' + out.cans.n + ' 壶，一共用药 ' + A.fmtDose(out.cans.totalDose) + ' ' + u, 25, '#55523f', 36); y += 14; }
    para('按整格配：' + out.whole.text, 25, '#55523f', 36);
    g.font = '21px ' + F; g.fillStyle = '#827d66';
    g.fillText('默认场景为虚构示例 · 只做按标签的算术，不推荐浓度、不判断安全', L, H - 92);
    return c;
  }
  $('dlPng').addEventListener('click', function () {
    drawCard().toBlob(function (b) { if (b) download('瓶盖不是量杯-配药单-1080x1350.png', b); }, 'image/png');
  });

  /* 给验收脚本用的只读口子 */
  window.__capUi = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    out: function () { return out; },
    setStep: setStep, importText: importText, drawCard: drawCard, storageKey: KEY
  };

  fillInputs(); update();
})();
