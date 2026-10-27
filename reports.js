/* MiDinero Web: Reports tab.
   Loaded before the app script; everything below runs only when renderReports() is called,
   and then uses the app's globals: D, $, esc, money, monthName, hue, showTab, renderTransactions, openEditor.
   All amounts are in the main currency at the rate saved with each transaction (t.amount).
   Net worth converts balances at the accounts' current rates, like the Accounts tab. */
(() => {
  const S = { period: '12m', from: '', to: '', acc: '', label: '', kind: 3, drill: null };
  try { Object.assign(S, JSON.parse(localStorage.getItem('bcw-reports') || '{}'), { drill: null }); } catch {}
  const persist = () => { try { localStorage.setItem('bcw-reports', JSON.stringify({ period: S.period, from: S.from, to: S.to, kind: S.kind })); } catch {} };

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); const n = y * 12 + mo - 1 + k; return `${Math.floor(n / 12)}-${pad(n % 12 + 1)}`; };
  const monthsOf = (a, b) => { const out = []; for (let m = a; m <= b; m = addM(m, 1)) out.push(m); return out; };
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const today = `${thisMonth}-${pad(now.getDate())}`;
  const lastDay = m => `${m}-${pad(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate())}`;
  const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
  const dayStr = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const longDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const monYear = m => monthName(m, 'shortYear');
  const rangeLabel = ([a, b]) => a === b ? monthName(a) : a.slice(5) === '01' && b.slice(5) === '12' && a.slice(0, 4) === b.slice(0, 4) ? a.slice(0, 4) : `${monYear(a)} – ${monYear(b)}`;

  const PERIODS = [['month', 'This month'], ['prev', 'Last month'], ['3m', 'Last 3 months'], ['ytd', 'This year'], ['lastyear', 'Last year'],
    ['12m', 'Last 12 months'], ['all', 'All time'], ['custom', 'Custom range']];

  function ranges() {
    const first = D.list.length ? D.list[D.list.length - 1].date.slice(0, 7) : thisMonth;
    const y = +thisMonth.slice(0, 4);
    let r, prev = null;
    switch (S.period) {
      case 'month': r = [thisMonth, thisMonth]; break;
      case 'prev': r = [addM(thisMonth, -1), addM(thisMonth, -1)]; break;
      case '3m': r = [addM(thisMonth, -2), thisMonth]; break;
      case 'ytd': r = [`${y}-01`, thisMonth]; prev = [`${y - 1}-01`, addM(thisMonth, -12)]; break; // same months last year
      case 'lastyear': r = [`${y - 1}-01`, `${y - 1}-12`]; break;
      case 'all': r = [first, thisMonth]; break;
      case 'custom': r = [S.from || first, S.to || thisMonth]; if (r[0] > r[1]) r.reverse(); break;
      default: r = [addM(thisMonth, -11), thisMonth];
    }
    if (!prev && S.period !== 'all') { const len = monthsOf(r[0], r[1]).length; prev = [addM(r[0], -len), addM(r[0], -1)]; }
    return { r, prev, first };
  }
  // days covered by a month range, not counting days that haven't happened yet
  const daysIn = ([a, b]) => Math.max(1, dayNum(lastDay(b) < today ? lastDay(b) : today) - dayNum(a + '-01') + 1);

  // ---------- money ----------
  let f0, fc;
  const m0 = n => (f0 ||= new Intl.NumberFormat(undefined, { style: 'currency', currency: D.base, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 })).format(Math.round(n) || 0);
  const mc = n => (fc ||= new Intl.NumberFormat(undefined, { style: 'currency', currency: D.base, currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 })).format(n);
  const pct = n => `${Math.round(n * 100)}%`;
  const tipAttr = html => ` data-tip="${esc(html)}" tabindex="0"`;

  // ---------- data ----------
  const child = t => t.child;
  function base() {
    return D.list.filter(t => !t.void && (t.type === 3 || t.type === 4)
      && (!S.acc || String(t.acc) === S.acc) && (!S.label || t.labels.includes(S.label)));
  }
  const inRange = (t, [a, b]) => { const m = t.date.slice(0, 7); return m >= a && m <= b; };
  function totals(list, r) {
    let inc = 0, exp = 0, n = 0;
    for (const t of list) if (inRange(t, r)) { n++; if (t.type === 4) inc += t.amount; else exp -= t.amount; }
    return { inc, exp, net: inc - exp, n };
  }
  function groupSum(list, key, type) {
    const g = new Map();
    for (const t of list) if (t.type === type) { const k = key(t); g.set(k, (g.get(k) || 0) + (type === 3 ? -t.amount : t.amount)); }
    return g;
  }

  // ---------- shared pieces ----------
  function niceTicks(lo, hi, count = 4) {
    const span = hi - lo || 1, raw = span / count, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, ticks = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
    if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }
  function deltaHtml(cur, prev, upIsGood, mode = 'pct') {
    if (prev == null || !isFinite(prev) || (mode === 'pct' && Math.abs(prev) < 0.5)) return '<span class="r-delta">no comparison</span>';
    const d = mode === 'pp' ? (cur - prev) * 100 : (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(d) < 0.5) return '<span class="r-delta">≈ same</span>';
    const good = (d > 0) === upIsGood;
    return `<span class="r-delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}${mode === 'pp' ? ' pts' : '%'}</span>`;
  }
  const card = (title, body, extra = '', cls = '') => `<section class="r-card ${cls}"><header class="r-head"><h2>${title}</h2>${extra}</header>${body}</section>`;
  const empty = '<p class="muted r-empty">No transactions in this period.</p>';

  // ---------- sections ----------
  function kpis(list, r, prev) {
    const c = totals(list, r), p = prev && totals(list, prev);
    const days = daysIn(r), pdays = prev && daysIn(prev);
    const rate = c.inc > 0 ? c.net / c.inc : null, prate = p && p.inc > 0 ? p.net / p.inc : null;
    const tile = (label, value, delta, tone = '') => `<div class="r-tile"><div class="label">${label}</div><div class="r-big ${tone}">${value}</div>${delta}</div>`;
    return `<div class="r-tiles">
      ${tile('Income', m0(c.inc), deltaHtml(c.inc, p?.inc, true))}
      ${tile('Expenses', m0(c.exp), deltaHtml(c.exp, p?.exp, false))}
      ${tile('Net', m0(c.net), deltaHtml(c.net, p?.net, true), c.net < 0 ? 'neg' : '')}
      ${tile('Savings rate', rate == null ? '—' : pct(rate), rate == null || prate == null ? deltaHtml(null, null) : deltaHtml(rate, prate, true, 'pp'), rate < 0 ? 'neg' : '')}
      ${tile('Spent per day', m0(c.exp / days), deltaHtml(c.exp / days, p && p.exp / pdays, false))}
      ${tile('Transactions', c.n.toLocaleString(), deltaHtml(c.n, p?.n, true).replace(/ (good|bad)/, ''))}
    </div>`;
  }

  // Income up, expenses down from one zero line, net as a line: one axis, same unit.
  function cashflow(list, r) {
    let ms = monthsOf(r[0], r[1]);
    if (ms.length < 12) ms = monthsOf(addM(r[1], -11), r[1]);
    const yearly = ms.length > 36;
    const keys = yearly ? [...new Set(ms.map(m => m.slice(0, 4)))] : ms;
    const b = new Map(keys.map(k => [k, { inc: 0, exp: 0 }]));
    for (const t of list) { const k = yearly ? t.date.slice(0, 4) : t.date.slice(0, 7); const x = b.get(k); if (x) t.type === 4 ? x.inc += t.amount : x.exp -= t.amount; }
    const rows = keys.map(k => ({ k, ...b.get(k), inRange: yearly || (k >= r[0] && k <= r[1]) }));
    const W = Math.max(320, $('#reports').clientWidth - 34), H = 240, L = 52, R = 8, T = 10, B = 26;
    const hi = Math.max(1, ...rows.map(x => x.inc)), lo = -Math.max(1, ...rows.map(x => x.exp));
    const ticks = niceTicks(lo, hi), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
    const step = (W - L - R) / rows.length, bw = Math.max(2, Math.min(28, step * 0.62));
    const labelEvery = Math.ceil(rows.length / Math.max(1, Math.floor((W - L) / 46)));
    let svg = `<svg class="r-svg" width="${W}" height="${H}" role="img" aria-label="Income and expenses by ${yearly ? 'year' : 'month'}">`;
    for (const v of ticks) svg += `<line class="grid${v === 0 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${mc(v)}</text>`;
    const net = [];
    rows.forEach((x, i) => {
      const cx = L + step * i + step / 2, lab = yearly ? x.k : monthName(x.k, 'short');
      const tip = `<b>${yearly ? x.k : monthName(x.k)}</b><br>Income ${m0(x.inc)}<br>Expenses ${m0(x.exp)}<br>Net ${m0(x.inc - x.exp)}`;
      svg += `<g class="col${x.inRange ? '' : ' out'}"${tipAttr(tip)}><rect class="hit" x="${cx - step / 2}" y="${T}" width="${step}" height="${H - T - B}"/>`;
      if (x.inc > 0) svg += `<path class="inc" d="${barPath(cx - bw / 2, y(x.inc), bw, y(0) - y(x.inc), 'up')}"/>`;
      if (x.exp > 0) svg += `<path class="exp" d="${barPath(cx - bw / 2, y(0), bw, y(-x.exp) - y(0), 'down')}"/>`;
      svg += '</g>';
      if (i % labelEvery === 0) svg += xLabel(cx, H - 8, lab, W);
      net.push([cx, y(x.inc - x.exp)]);
    });
    svg += `<polyline class="net" points="${net.map(p => p.join(',')).join(' ')}"/>${net.map(([a, c]) => `<circle class="net-dot" cx="${a}" cy="${c}" r="3"/>`).join('')}</svg>`;
    const legend = '<div class="r-legend"><span><i class="sw inc"></i>Income</span><span><i class="sw exp"></i>Expenses</span><span><i class="sw net"></i>Net</span></div>';
    const table = `<details class="r-table-toggle"><summary>Show as table</summary><div class="r-scroll"><table class="r-table"><thead><tr><th>${yearly ? 'Year' : 'Month'}</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${yearly ? x.k : monthName(x.k)}</td><td class="num">${m0(x.inc)}</td><td class="num">${m0(x.exp)}</td><td class="num">${m0(x.inc - x.exp)}</td></tr>`).join('')}</tbody></table></div></details>`;
    return card(`Cash flow${yearly ? ' by year' : ''}`, legend + `<div class="r-scroll">${svg}</div>` + table);
  }
  // x-axis label that never runs past either edge of the chart
  const xLabel = (x, y, text, W) => `<text class="tick" x="${x}" y="${y}" text-anchor="${x > W - 30 ? 'end' : x < 30 ? 'start' : 'middle'}">${esc(text)}</text>`;
  // 4px rounded data-end, square on the baseline
  function barPath(x, yTop, w, h, dir) {
    const r = Math.min(4, w / 2, h);
    if (h <= 0) return '';
    return dir === 'up'
      ? `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`
      : `M${x},${yTop}V${yTop + h - r}Q${x},${yTop + h} ${x + r},${yTop + h}H${x + w - r}Q${x + w},${yTop + h} ${x + w},${yTop + h - r}V${yTop}Z`;
  }

  const lines = new Map(); // svg id -> points for the crosshair
  function netWorth(r, first) {
    const delta = new Map();
    for (const t of D.all) {
      const a = D.acc[t.acc];
      if (!a || t.void || (S.acc && String(t.acc) !== S.acc)) continue;
      const native = t.tc === a.cur ? t.native : t.amount * a.rate;
      const m = t.date.slice(0, 7);
      delta.set(m, (delta.get(m) || 0) + native / a.rate);
    }
    const all = monthsOf(first, thisMonth);
    let run = 0;
    const series = all.map(m => (run += delta.get(m) || 0, { m, v: run }));
    let from = r[0] < addM(r[1], -11) ? r[0] : addM(r[1], -11);
    const pts = series.filter(p => p.m >= from && p.m <= r[1]);
    if (pts.length < 2) return card('Net worth', empty);
    const W = Math.max(320, $('#reports').clientWidth - 34), H = 220, L = 52, R = 12, T = 12, B = 26;
    const vals = pts.map(p => p.v), ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x = i => L + i * (W - L - R) / (pts.length - 1), y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
    const id = 'nw';
    lines.set(id, pts.map((p, i) => ({ x: x(i), y: y(p.v), tip: `<b>${monthName(p.m)}</b><br>Net worth ${m0(p.v)}` })));
    const labelEvery = Math.ceil(pts.length / Math.max(1, Math.floor((W - L) / 56)));
    let svg = `<svg class="r-svg" id="${id}" width="${W}" height="${H}" role="img" aria-label="Net worth by month">`;
    for (const v of ticks) svg += `<line class="grid${v === 0 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${mc(v)}</text>`;
    pts.forEach((p, i) => { if (i % labelEvery === 0) svg += xLabel(x(i), H - 8, monthName(p.m, 'short'), W); });
    const line = pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ');
    const last = pts[pts.length - 1];
    svg += `<polygon class="area" points="${x(0)},${y(Math.max(y0, 0))} ${line} ${x(pts.length - 1)},${y(Math.max(y0, 0))}"/>
      <polyline class="nw-line" points="${line}"/>
      <circle class="nw-end" cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="4"/>
      <g class="cross" hidden><line class="cross-line" y1="${T}" y2="${H - B}"/><circle class="cross-dot" r="4"/></g>
      <rect class="hit" data-line="${id}" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
    const change = last.v - pts[0].v;
    const extra = `<span class="r-sub">${m0(last.v)} now · <span class="${change >= 0 ? 'good' : 'bad'}">${change >= 0 ? '▲' : '▼'} ${m0(Math.abs(change))}</span> since ${monthName(pts[0].m, 'short')}</span>`;
    return card('Net worth', `<div class="r-scroll">${svg}</div><p class="r-note muted">Balances converted at today's account rates, as on the Accounts tab.</p>`, extra);
  }

  // The Expenses / Income switch in the filter row decides what every breakdown below shows.
  const K = () => S.kind === 4
    ? { type: 4, val: t => t.amount, noun: 'Income', what: 'income', who: 'Source', whoPl: 'sources', big: 'Largest income' }
    : { type: 3, val: t => -t.amount, noun: 'Spending', what: 'spending', who: 'Payee', whoPl: 'payees', big: 'Largest expenses' };

  function categories(list, r, prev) {
    const kind = S.kind, drill = S.drill;
    const scope = drill ? list.filter(t => t.parent === drill) : list;
    const key = drill ? child : t => t.parent;
    const cur = groupSum(scope.filter(t => inRange(t, r)), key, kind);
    const old = prev ? groupSum(scope.filter(t => inRange(t, prev)), key, kind) : new Map();
    let rows = [...cur].filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, [, v]) => s + v, 0);
    const max = Math.max(1, ...rows.map(([, v]) => v), ...rows.map(([k]) => old.get(k) || 0));
    const crumb = drill ? `<div class="r-crumb"><button type="button" class="r-link" data-undrill>All categories</button> › <b>${esc(drill)}</b></div>` : '';
    const body = rows.length ? `<div class="r-bars">${rows.map(([k, v]) => {
      const o = old.get(k) || 0;
      const tip = `<b>${esc(k)}</b><br>${rangeLabel(r)}: ${m0(v)} (${pct(v / total)})${prev ? `<br>${rangeLabel(prev)}: ${m0(o)}` : ''}`;
      return `<button type="button" class="r-bar-row" ${drill ? `data-parent="${esc(drill)}" data-child="${esc(k)}"` : `data-drill="${esc(k)}"`}${tipAttr(tip).replace(' tabindex="0"', '')}>
        <span class="r-bar-name">${esc(k)}</span>
        <span class="r-bar-val num">${m0(v)} <span class="muted">${pct(v / total)}</span></span>
        <span class="r-bar-delta">${prev ? deltaHtml(v, o, kind === 4) : ''}</span>
        <span class="r-track"><i class="${kind === 4 ? 'inc' : ''}" style="width:${v / max * 100}%"></i>${prev && o > 0 ? `<b class="r-prev" style="left:${o / max * 100}%"></b>` : ''}</span>
      </button>`;
    }).join('')}</div>` : empty;
    const legend = prev ? `<p class="r-note muted">Bar: ${rangeLabel(r)}. Tick: ${rangeLabel(prev)}. ${drill ? 'Click a category to see its transactions.' : 'Click a group to see its categories.'}</p>` : '';
    return card(`${kind === 4 ? 'Income' : 'Expenses'} by category`, crumb + body + legend, '', 'r-wide');
  }

  // Category groups x the selected period, one hue light-to-dark (sequential).
  // Columns follow the period: days for one month, months up to two years, years beyond that.
  function heatmap(list, r) {
    const k = K(), ms = monthsOf(r[0], r[1]);
    const unit = ms.length === 1 ? 'day' : ms.length <= 24 ? 'month' : 'year';
    const len = { day: 10, month: 7, year: 4 }[unit]; // a column key is the first `len` characters of the date
    const cols = unit === 'month' ? ms : unit === 'year' ? [...new Set(ms.map(m => m.slice(0, 4)))]
      : Array.from({ length: +lastDay(ms[0]).slice(8) }, (_, i) => `${ms[0]}-${pad(i + 1)}`);
    const colName = c => unit === 'day' ? longDate(c) : unit === 'month' ? monthName(c) : c;
    const colHead = c => unit === 'day' ? String(+c.slice(8)) : unit === 'month' ? monthName(c, 'short') : c;
    const sel = list.filter(t => t.type === k.type && inRange(t, r));
    const byCat = new Map();
    for (const t of sel) { const row = byCat.get(t.parent) || new Map(); const m = t.date.slice(0, len); row.set(m, (row.get(m) || 0) + k.val(t)); byCat.set(t.parent, row); }
    let cats = [...byCat].map(([k, row]) => [k, row, [...row.values()].reduce((s, v) => s + v, 0)]).filter(c => c[2] > 0.004).sort((a, b) => b[2] - a[2]);
    if (!cats.length) return card(`${k.noun} heatmap`, empty, '', 'r-wide');
    if (cats.length > 12) {
      const other = new Map();
      for (const [, row] of cats.slice(11)) for (const [m, v] of row) other.set(m, (other.get(m) || 0) + v);
      cats = [...cats.slice(0, 11), ['Other', other, [...other.values()].reduce((s, v) => s + v, 0)]];
    }
    // Each row is shaded against its own busiest column: one huge group (a flat purchase) would otherwise wash out every other row.
    const cell = (v, k, c, rowMax) => {
      const s = v > 0.004 ? Math.max(0.15, v / rowMax) : 0;
      const open = v > 0.004 && k !== 'Other' ? ` data-parent="${esc(k)}" data-cell="${c}"` : ''; // "Other" folds several groups, so it has no single filter
      return `<td class="hm${open ? ' link' : ''}"${open}${tipAttr(`<b>${esc(k)}</b><br>${colName(c)}: ${m0(v || 0)}${open ? '<br>Click to see transactions' : ''}`)} style="--s:${Math.round(s * 100)}%">${v > 0.004 ? '' : '·'}</td>`;
    };
    const table = `<div class="r-scroll"><table class="r-heat${unit === 'day' ? ' dense' : ''}"><thead><tr><th></th>${cols.map(c => `<th>${esc(colHead(c))}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${cats.map(([k, row, tot]) => { const rowMax = Math.max(...row.values()); return `<tr><th scope="row">${esc(k)}</th>${cols.map(c => cell(row.get(c), k, c, rowMax)).join('')}<td class="num">${m0(tot)}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="r-scale"><span>Quieter ${unit}</span><i style="--s:15%"></i><i style="--s:40%"></i><i style="--s:70%"></i><i style="--s:100%"></i><span>Busiest ${unit} for that group</span></div>`;
    return card(`${k.noun} heatmap`, table, `<span class="r-sub">${k.type === 4 ? 'Income' : 'Expenses'} by group and ${unit}, ${rangeLabel(r)}</span>`, 'r-wide');
  }

  // GitHub-style calendar of daily spending.
  function calendar(list, r) {
    const startM = monthsOf(r[0], r[1]).length > 12 ? addM(r[1], -11) : r[0];
    const start = dayNum(startM + '-01'), end = dayNum(lastDay(r[1]) < today ? lastDay(r[1]) : today);
    const k = K(), day = new Map();
    for (const t of list) if (t.type === k.type) { const d = t.date.slice(0, 10); const x = day.get(d) || { v: 0, n: 0 }; x.v += k.val(t); x.n++; day.set(d, x); }
    const vals = [...day].filter(([d]) => { const n = dayNum(d); return n >= start && n <= end; }).map(([, x]) => x.v).sort((a, b) => a - b);
    const cap = Math.max(1, vals[Math.floor(vals.length * 0.95)] || 1); // 95th percentile so one big purchase doesn't wash out the rest
    const dow = n => (new Date(n * 864e5).getUTCDay() + 6) % 7; // Monday = 0
    const first = start - dow(start), weeks = Math.ceil((end - first + 1) / 7);
    const C = 13, G = 3, L = 26, T = 18, W = L + weeks * (C + G), H = T + 7 * (C + G);
    let svg = `<svg class="r-svg r-cal" width="${W}" height="${H}" role="img" aria-label="Daily ${k.what} calendar">`;
    ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((d, i) => { if (d) svg += `<text class="tick" x="0" y="${T + i * (C + G) + 10}">${d}</text>`; });
    let lastMonth = '';
    for (let n = first; n <= end; n++) {
      const w = Math.floor((n - first) / 7), i = dow(n), ds = dayStr(n), x = L + w * (C + G), y = T + i * (C + G);
      if (n < start) continue;
      if (ds.slice(0, 7) !== lastMonth) { lastMonth = ds.slice(0, 7); svg += `<text class="tick" x="${x}" y="11">${esc(monthName(lastMonth, 'short').split(' ')[0])}</text>`; }
      const x0 = day.get(ds), v = x0?.v || 0;
      const s = v > 0.004 ? Math.max(0.12, Math.min(1, Math.sqrt(v / cap))) : 0;
      svg += `<rect class="day" x="${x}" y="${y}" width="${C}" height="${C}" rx="3" style="--s:${Math.round(s * 100)}%"${tipAttr(`<b>${longDate(ds)}</b><br>${v > 0.004 ? `${m0(v)} · ${x0.n} transaction${x0.n === 1 ? '' : 's'}` : `No ${k.what}`}`)}/>`;
    }
    svg += '</svg>';
    const activeDays = vals.length, totalDays = end - start + 1;
    const extra = `<span class="r-sub">${activeDays} of ${totalDays} days with ${k.what}</span>`;
    return card(`${k.noun} calendar`, `<div class="r-scroll">${svg}</div>`, extra, 'r-wide');
  }

  // Median day per weekday (days without spending count as 0): one big purchase can't make a weekday look expensive.
  function weekdays(list, r) {
    const start = dayNum(r[0] + '-01'), end = dayNum(lastDay(r[1]) < today ? lastDay(r[1]) : today);
    const spend = new Map(), sums = Array(7).fill(0), days = [...Array(7)].map(() => []);
    for (const t of list) if (t.type === 3 && inRange(t, r)) { const d = t.date.slice(0, 10); spend.set(d, (spend.get(d) || 0) - t.amount); }
    for (let n = start; n <= end; n++) { const w = (new Date(n * 864e5).getUTCDay() + 6) % 7, v = spend.get(dayStr(n)) || 0; days[w].push(v); sums[w] += v; }
    const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
    const med = days.map(median), max = Math.max(1, ...med);
    const names = [...Array(7)].map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }));
    const top = med.indexOf(Math.max(...med));
    return card('Typical spending by weekday', `<div class="r-week">${med.map((v, i) => `
      <div class="r-wd"${tipAttr(`<b>${names[i]}</b><br>Typical day ${m0(v)}<br>Total ${m0(sums[i])} over ${days[i].length} days`)}>
        <span class="num r-wd-val${i === top ? ' top' : ''}">${m0(v)}</span>
        <span class="r-wd-bar"><i style="height:${v / max * 100}%"></i></span>
        <span class="r-wd-name">${names[i]}</span></div>`).join('')}</div>
      <p class="r-note muted">Median day, so a single big purchase doesn't skew it. Hover for totals.</p>`);
  }

  function hbars(title, rows, total, opts = {}) {
    if (!rows.length) return card(title, empty);
    const max = Math.max(1, ...rows.map(r => r.v));
    return card(title, `<div class="r-bars compact">${rows.map(x => `
      <button type="button" class="r-bar-row" ${x.attr || ''}${tipAttr(`<b>${esc(x.k)}</b><br>${m0(x.v)}${x.n ? ` · ${x.n} transactions` : ''}${total ? ` · ${pct(x.v / total)}` : ''}`).replace(' tabindex="0"', '')}>
        <span class="r-bar-name">${x.label || esc(x.k)}</span>
        <span class="r-bar-val num">${m0(x.v)}${total ? ` <span class="muted">${pct(x.v / total)}</span>` : ''}</span>
        <span class="r-track"><i style="width:${x.v / max * 100}%"></i></span>
      </button>`).join('')}</div>${opts.note ? `<p class="r-note muted">${opts.note}</p>` : ''}`);
  }

  function payees(list, r) {
    const kk = K(), g = new Map();
    for (const t of list) if (t.type === kk.type && inRange(t, r)) { const k = t.item || '—'; const x = g.get(k) || { v: 0, n: 0 }; x.v += kk.val(t); x.n++; g.set(k, x); }
    const all = [...g].filter(([, x]) => x.v > 0.004).sort((a, b) => b[1].v - a[1].v);
    const total = all.reduce((s, [, x]) => s + x.v, 0);
    const title = `Top ${kk.whoPl}`;
    if (!all.length) return card(title, empty);
    const max = all[0][1].v;
    return card(title, `<div class="r-scroll"><table class="r-table r-payees"><thead><tr><th>${kk.who}</th><th>Total</th><th>Count</th><th>Average</th></tr></thead><tbody>
      ${all.slice(0, 15).map(([k, x]) => `<tr data-search="${esc(k)}" tabindex="0"><td><span class="r-pname">${esc(k)}</span><span class="r-track thin"><i style="width:${x.v / max * 100}%"></i></span></td>
        <td class="num">${m0(x.v)} <span class="muted">${pct(x.v / total)}</span></td><td class="num">${x.n}</td><td class="num">${m0(x.v / x.n)}</td></tr>`).join('')}
      </tbody></table></div><p class="r-note muted">${all.length.toLocaleString()} ${kk.whoPl} in this period. Click one to see its transactions.</p>`);
  }

  function labelsAndAccounts(list, r) {
    const k = K(), sel = list.filter(t => t.type === k.type && inRange(t, r));
    const total = sel.reduce((s, t) => s + k.val(t), 0);
    const lg = new Map();
    for (const t of sel) for (const l of t.labels) { const x = lg.get(l) || { v: 0, n: 0 }; x.v += k.val(t); x.n++; lg.set(l, x); }
    const labelRows = [...lg].filter(([, x]) => x.v > 0.004).sort((a, b) => b[1].v - a[1].v).slice(0, 10)
      .map(([k, x]) => ({ k, v: x.v, n: x.n, label: `<span class="tag" style="--h:${hue(k)}">${esc(k)}</span>`, attr: `data-label="${esc(k)}"` }));
    const ag = new Map();
    for (const t of sel) { const x = ag.get(t.acc) || { v: 0, n: 0 }; x.v += k.val(t); x.n++; ag.set(t.acc, x); }
    const accRows = [...ag].filter(([, x]) => x.v > 0.004).sort((a, b) => b[1].v - a[1].v).slice(0, 10)
      .map(([id, x]) => ({ k: D.acc[id].name, v: x.v, n: x.n, label: `${esc(D.acc[id].name)} <span class="code">${esc(D.acc[id].cur)}</span>`, attr: `data-acc="${id}"` }));
    return hbars(`${k.noun} by tag`, labelRows, total, { note: 'A transaction with several tags counts under each. Click a tag to filter all reports by it.' })
      + hbars(`${k.noun} by account`, accRows, total, { note: 'Click an account to filter all reports by it.' });
  }

  function biggest(list, r) {
    const k = K(), top = list.filter(t => t.type === k.type && inRange(t, r)).sort((a, b) => k.val(b) - k.val(a)).slice(0, 10);
    if (!top.length) return card(k.big, empty);
    return card(k.big, `<div class="r-list">${top.map(t => `
      <button type="button" class="r-li" data-id="${t.id}">
        <span><b>${esc(t.item || t.catName)}</b><span class="muted"> · ${esc(t.catName)} · ${esc(t.date.slice(0, 10))}</span></span>
        <span class="num">${m0(k.val(t))}${t.tc !== D.base ? ` <span class="code">${esc(t.tc)}</span>` : ''}</span>
      </button>`).join('')}</div>`);
  }

  function years(list) {
    const g = new Map();
    for (const t of list) { const y = t.date.slice(0, 4); const x = g.get(y) || { inc: 0, exp: 0, n: 0 }; t.type === 4 ? x.inc += t.amount : x.exp -= t.amount; x.n++; g.set(y, x); }
    const rows = [...g].sort((a, b) => b[0].localeCompare(a[0]));
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map(([, x]) => Math.max(x.inc, x.exp)));
    return card('Year by year', `<div class="r-scroll"><table class="r-table r-years"><thead><tr><th>Year</th><th>Income</th><th>Expenses</th><th>Net</th><th>Savings rate</th><th class="r-yb"></th></tr></thead><tbody>
      ${rows.map(([y, x]) => `<tr data-year="${y}" tabindex="0"><td><b>${y}</b>${y === thisMonth.slice(0, 4) ? ' <span class="muted">so far</span>' : ''}</td>
        <td class="num">${m0(x.inc)}</td><td class="num">${m0(x.exp)}</td><td class="num ${x.inc - x.exp < 0 ? 'neg' : ''}">${m0(x.inc - x.exp)}</td>
        <td class="num">${x.inc > 0 ? pct((x.inc - x.exp) / x.inc) : '—'}</td>
        <td class="r-yb"><span class="r-ybar inc" style="width:${x.inc / max * 100}%"></span><span class="r-ybar exp" style="width:${x.exp / max * 100}%"></span></td></tr>`).join('')}
      </tbody></table></div><p class="r-note muted">Click a year to report on it.</p>`, '', 'r-wide');
  }

  // ---------- page ----------
  function filters(rr) {
    const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    const labels = [...new Set(D.list.flatMap(t => t.labels))].sort();
    return `<div class="r-filters">
      <div class="r-seg" role="group" aria-label="Show breakdowns for">
        <button type="button" data-kind="3" aria-pressed="${S.kind === 3}">Expenses</button><button type="button" data-kind="4" aria-pressed="${S.kind === 4}">Income</button></div>
      <select id="r-period" aria-label="Period">${PERIODS.map(([v, l]) => opt(v, l, S.period === v)).join('')}</select>
      <span class="r-custom"${S.period === 'custom' ? '' : ' hidden'}><input id="r-from" type="month" value="${rr.r[0]}" aria-label="From"> – <input id="r-to" type="month" value="${rr.r[1]}" aria-label="To"></span>
      <select id="r-acc" aria-label="Account">${opt('', 'All accounts', !S.acc)}${D.accounts.map(a => opt(a.id, a.name + (a.hidden ? ' (hidden)' : ''), String(a.id) === S.acc)).join('')}</select>
      <select id="r-label" aria-label="Tag">${opt('', 'All tags', !S.label)}${labels.map(l => opt(l, l, l === S.label)).join('')}</select>
      ${S.acc || S.label ? '<button type="button" id="r-reset" class="r-link">Clear filters</button>' : ''}
    </div>
    <p class="r-period muted"><b>${rangeLabel(rr.r)}</b>${rr.prev ? ` compared with ${rangeLabel(rr.prev)}` : ''}</p>`;
  }

  window.renderReports = function renderReports() {
    const root = $('#reports');
    if (!D || !root || $('#tab-reports').hidden) return; // charts are sized to the visible tab; opening the tab draws them
    const rr = ranges(), list = base();
    lines.clear();
    root.innerHTML = filters(rr) + kpis(list, rr.r, rr.prev)
      + `<div class="r-grid">${cashflow(list, rr.r)}${netWorth(rr.r, rr.first)}${categories(list, rr.r, rr.prev)}${heatmap(list, rr.r)}${calendar(list, rr.r)}
         ${S.kind === 3 ? weekdays(list, rr.r) : ''}${biggest(list, rr.r)}${payees(list, rr.r)}${labelsAndAccounts(list, rr.r)}${years(list)}</div>
      <p class="r-note muted">Amounts in ${esc(D.base)} at the rate saved with each transaction. Transfers between your accounts and transactions marked “not counted” are left out.</p>`;
  };

  // ---------- interaction ----------
  let tip;
  function showTip(html, x, y) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'r-tip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, x + 14)) + 'px';
    tip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
  }
  const hideTip = () => { if (tip) tip.hidden = true; };

  // Open the Transactions tab filtered to what was clicked, within the report's period (the account filter carries over).
  function goToTransactions(opts, r) {
    hideTip();
    const period = !r ? {} : r[0] === r[1] ? { month: r[0] } : { from: r[0], to: r[1] };
    showTransactions({ acc: S.acc, type: String(S.kind), ...period, ...opts });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = $('#reports');
    root.addEventListener('change', e => {
      const id = e.target.id;
      if (id === 'r-period') { S.period = e.target.value; if (S.period === 'custom') { const rr = ranges(); S.from = rr.r[0]; S.to = rr.r[1]; } }
      if (id === 'r-from') S.from = e.target.value;
      if (id === 'r-to') S.to = e.target.value;
      if (id === 'r-acc') S.acc = e.target.value;
      if (id === 'r-label') S.label = e.target.value;
      S.drill = null; persist(); renderReports();
    });
    root.addEventListener('click', e => {
      const t = e.target.closest('button, tr[data-search], tr[data-year], td[data-cell]'); if (!t) return;
      const rr = ranges();
      if (t.dataset.kind) { S.kind = +t.dataset.kind; S.drill = null; persist(); renderReports(); }
      else if (t.dataset.drill) { S.drill = t.dataset.drill; renderReports(); }
      else if ('undrill' in t.dataset) { S.drill = null; renderReports(); }
      else if (t.dataset.cell) goToTransactions({ parent: t.dataset.parent, from: t.dataset.cell, to: t.dataset.cell });
      else if (t.dataset.child) goToTransactions({ parent: t.dataset.parent, child: t.dataset.child }, rr.r);
      else if (t.dataset.search) goToTransactions({ search: t.dataset.search }, rr.r);
      else if (t.dataset.label) { S.label = t.dataset.label; renderReports(); }
      else if (t.dataset.acc) { S.acc = t.dataset.acc; renderReports(); }
      else if (t.dataset.year) { S.period = 'custom'; S.from = `${t.dataset.year}-01`; S.to = `${t.dataset.year}-12`; persist(); renderReports(); scrollTo({ top: 0 }); }
      else if (t.dataset.id) { hideTip(); openEditor(D.byId[t.dataset.id]); }
      else if (t.id === 'r-reset') { S.acc = ''; S.label = ''; renderReports(); }
    });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-search], tr[data-year], td[data-cell]')) e.target.click(); });
    root.addEventListener('pointermove', e => {
      const hit = e.target.closest('[data-line]');
      if (hit) {
        const svg = hit.ownerSVGElement, pts = lines.get(svg.id), box = svg.getBoundingClientRect();
        const px = e.clientX - box.left;
        let best = pts[0]; for (const p of pts) if (Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
        const g = svg.querySelector('.cross'); g.hidden = false;
        g.querySelector('line').setAttribute('x1', best.x); g.querySelector('line').setAttribute('x2', best.x);
        g.querySelector('circle').setAttribute('cx', best.x); g.querySelector('circle').setAttribute('cy', best.y);
        return showTip(best.tip, box.left + best.x, box.top + best.y);
      }
      root.querySelectorAll('.cross').forEach(g => g.hidden = true);
      const el = e.target.closest('[data-tip]');
      el ? showTip(el.dataset.tip, e.clientX, e.clientY) : hideTip();
    });
    root.addEventListener('pointerleave', () => { hideTip(); root.querySelectorAll('.cross').forEach(g => g.hidden = true); });
    root.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const b = el.getBoundingClientRect(); showTip(el.dataset.tip, b.left + b.width / 2, b.top); } });
    root.addEventListener('focusout', hideTip);
    let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (!$('#tab-reports').hidden) renderReports(); }, 150); });
    document.querySelector('.tabs').addEventListener('click', e => { if (e.target.closest('[data-tab="reports"]')) requestAnimationFrame(renderReports); });
  });
})();
