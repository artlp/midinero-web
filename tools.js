/* MiDinero Web: Tools tab.
   One-time fix for exchange rates distorted by main-currency switches. Bluecoins re-prices the whole history at a single
   rate whenever the main currency changes (here RUB -> ILS around 2022, then ILS -> EUR on 2026-10-02 at 3.4755), so older
   rows carry that one day's rate instead of their own. For income and expenses typed in their account's own currency we
   write the real EUR rate of the row's date from fx-rates.json (ECB; Bank of Russia for RUB from March 2022) and
   recompute the EUR amount from the typed amount. Typed amounts and account balances don't change.
   Rows typed in another currency than their account get the existing "Х" label instead (changing them would move balances).
   Pre-switch EUR rows, transfers and currencies without published rates (CUP) are left alone.
   Uses the app's globals: D, $, esc, money, rows, derive, renderAll, notice, dirty, drive. */
(() => {
  const SWITCH = new Date(2026, 9, 2).getTime(), SWITCH_DAY = '2026-10-02', R = 3.475480485177076;
  let fx = null, plan = null;

  // created and dated before the switch (ids are creation timestamps in ms; very old rows have tiny ids)
  const preSwitch = t => t.id < SWITCH && t.date < SWITCH_DAY;
  const labelX = () => rows("select distinct labelName n from LABELSTABLE").map(r => r.n).find(n => /^[XxХх]$/.test(n.trim()));

  async function loadFx() {
    const j = await (await fetch('fx-rates.json?v=1')).json();
    const days = Object.keys(j.rates).sort();
    // units of `cur` per 1 EUR on day d: the last published rate on or before d (weekends and holidays use the previous day)
    return (cur, d) => {
      let lo = 0, hi = days.length - 1;
      if (d < days[0]) return null;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; days[mid] <= d ? lo = mid : hi = mid - 1; }
      for (let i = lo, n = 0; i >= 0 && n < 10; i--, n++) if (j.rates[days[i]][cur]) return j.rates[days[i]][cur];
      return null;
    };
  }

  function makePlan() {
    const old = D.all.filter(t => (t.type === 3 || t.type === 4) && preSwitch(t) && D.acc[t.acc]);
    // the switch left every ILS row at exactly R; once fixed, none on an ILS account keeps it (ILS rows on other accounts are only tagged)
    const done = !old.some(t => t.tc === 'ILS' && D.acc[t.acc].cur === 'ILS' && t.rate === R && t.date < '2026-10-01');
    const fix = [], tag = [], left = [];
    for (const t of old) {
      if (t.tc === 'EUR') left.push(t);
      else if (t.tc !== D.acc[t.acc].cur) tag.push(t);
      else { const r = fx(t.tc, t.date.slice(0, 10)); r ? fix.push(Object.assign(t, { newRate: r })) : left.push(t); }
    }
    return { fix, tag, left, done };
  }

  function render() {
    const root = $('#tools'); if (!root) return;
    const head = `<section class="r-card"><header class="r-head"><h2>Fix historical exchange rates</h2></header>
      <p>Each time the main currency changed (roubles → shekels around 2022, shekels → euros on 2 October 2026), Bluecoins re-priced all earlier transactions at that one day's rate. Older years are therefore off in euros: the shekel years by about 10–18%.</p>
      <p>This tool writes the real exchange rate of each transaction's date (European Central Bank; Bank of Russia for the rouble from March 2022) for income and expenses entered in their account's own currency. <b>Amounts you typed and account balances do not change</b>; only the euro values in reports do. Transactions in a currency different from their account get the “Х” tag. Euro transactions from before the switch, transfers, and currencies without published rates are left as they are.</p>
      <p class="muted">Nothing is saved until you upload to Drive, which first keeps a backup of the current version in My Drive.</p>`;
    if (!D) { root.innerHTML = head + '<p class="muted">Open your data first.</p></section>'; return; }
    if (!plan) { root.innerHTML = head + '<div class="actions"><button type="button" class="primary" id="t-check">Check</button></div></section>'; return; }
    if (plan.error) { root.innerHTML = head + `<p class="err">${esc(plan.error)}</p><button type="button" id="t-check">Try again</button></section>`; return; }
    if (plan.done) { root.innerHTML = head + '<p><b>Already fixed.</b> No shekel transactions are left at the 3.4755 switch rate, so there is nothing to do.</p></section>'; return; }
    const X = labelX();
    const years = new Map();
    for (const t of plan.fix) {
      const y = years.get(t.date.slice(0, 4)) || { e0: 0, e1: 0, i0: 0, i1: 0 };
      const fixed = t.native / t.newRate;
      if (t.type === 3) { y.e0 -= t.amount; y.e1 -= fixed; } else { y.i0 += t.amount; y.i1 += fixed; }
      years.set(t.date.slice(0, 4), y);
    }
    const m = n => money(n, D.base), chg = (a, b) => a ? `${b >= a ? '+' : ''}${((b / a - 1) * 100).toFixed(1)}%` : '';
    const byDate = [...plan.fix].sort((a, b) => a.date.localeCompare(b.date));
    const sample = [0.03, 0.25, 0.45, 0.6, 0.8, 0.97].map(f => byDate[Math.floor(f * (byDate.length - 1))]).filter(Boolean); // spread over the years
    const curs = [...new Set(plan.fix.map(t => t.tc))].join(', ');
    root.innerHTML = head + `
      <div class="r-tiles t-counts">
        <div class="r-tile"><div class="label">Will be fixed</div><div class="r-big">${plan.fix.length.toLocaleString()}</div><span class="r-delta">${esc(curs)}</span></div>
        <div class="r-tile"><div class="label">Will get “${esc(X || 'Х')}”</div><div class="r-big">${plan.tag.length}</div><span class="r-delta">${plan.tag.filter(t => X && t.labels.includes(X)).length} already have it</span></div>
        <div class="r-tile"><div class="label">Left as is</div><div class="r-big">${plan.left.length}</div><span class="r-delta">euro before the switch, or no published rate</span></div>
      </div>
      ${X ? '' : '<p class="err">No “Х” tag exists yet, so tagging will be skipped.</p>'}
      <div class="r-scroll"><table class="r-table"><thead><tr><th>Year</th><th>Expenses now</th><th>Fixed</th><th></th><th>Income now</th><th>Fixed</th><th></th></tr></thead><tbody>
        ${[...years].sort().map(([y, v]) => `<tr><td><b>${y}</b></td><td class="num">${m(v.e0)}</td><td class="num">${m(v.e1)}</td><td class="num muted">${chg(v.e0, v.e1)}</td>
          <td class="num">${m(v.i0)}</td><td class="num">${m(v.i1)}</td><td class="num muted">${chg(v.i0, v.i1)}</td></tr>`).join('')}
      </tbody></table></div>
      <h2>Examples</h2>
      <div class="r-scroll"><table class="r-table"><thead><tr><th>Date</th><th>Transaction</th><th>Typed</th><th>1 ${esc(D.base)} = now → fixed</th><th>In ${esc(D.base)} now → fixed</th></tr></thead><tbody>
        ${sample.map(t => `<tr><td>${esc(t.date.slice(0, 10))}</td><td>${esc(t.item || t.catName)}</td><td class="num">${money(t.native, t.tc)}</td>
            <td class="num">${t.rate.toFixed(4)} → ${t.newRate.toFixed(4)} ${esc(t.tc)}</td><td class="num">${m(t.amount)} → ${m(t.native / t.newRate)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="actions"><button type="button" class="primary" id="t-apply">Apply to ${plan.fix.length.toLocaleString()} transactions</button>
        <button type="button" id="t-check">Check again</button></div>
    </section>`;
  }

  async function check() {
    if (!D) return;
    $('#tools').querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      fx ||= await loadFx();
      plan = makePlan();
    } catch (e) { plan = { error: `Could not load the exchange rates (${e.message}). Reload the page and try again.` }; }
    render();
  }

  function apply() {
    if (!plan || plan.done || plan.error) return;
    const X = labelX();
    D.db.run('BEGIN');
    try {
      for (const t of plan.fix)
        D.db.run('update TRANSACTIONSTABLE set conversionRateNew = ?, amount = ? where transactionsTableID = ?',
          [t.newRate, Math.round(t.native / t.newRate * 1e6), t.id]);
      if (X) for (const t of plan.tag) if (!t.labels.includes(X))
        D.db.run('insert into LABELSTABLE (labelName, transactionIDLabels) values (?, ?)', [X, t.id]);
      D.db.run('COMMIT');
    } catch (e) { D.db.run('ROLLBACK'); notice(`Nothing was changed: ${e.message}`, true); return; }
    const n = plan.fix.length;
    dirty++;
    derive(); renderAll(); // also resets this tab
    notice(`Fixed ${n.toLocaleString()} transactions. Check Reports, then ${drive ? 'Upload to Drive' : 'Save for Drive'} to keep it.`);
  }

  // Called by the app after any data change: drop the old check so it's never applied to data that changed since.
  window.renderTools = () => { plan = null; render(); };
  document.addEventListener('DOMContentLoaded', () => {
    $('#tools').addEventListener('click', e => {
      if (e.target.id === 't-check') check();
      if (e.target.id === 't-apply') apply();
    });
    document.querySelector('.tabs').addEventListener('click', e => { if (e.target.closest('[data-tab="tools"]')) { plan = null; render(); } });
  });
})();
