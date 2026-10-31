'use strict';
const APP_VERSION = '1.0.0', SCHEMA = 1, $ = (s) => document.querySelector(s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + Math.random().toString(16).slice(2));
const S = { brokers: [], audit: [], watchlist: [], pricehist: [], cash: [], transactions: [], dividends: [], prices: [], settings: [], view: 'dashboard', q: '' };
const THEMES = ['light', 'dark', 'midnight', 'emerald', 'contrast'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}` : '–');
const fmt = (p) => (p == null ? '–' : (p / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (x) => (x == null ? '–' : x.toFixed(2) + '%');
const cls = (p) => (p > 0 ? 'pos' : p < 0 ? 'neg' : '');
function h(tag, a, ...kids) { const e = document.createElement(tag); Object.entries(a || {}).forEach(([k, v]) => {
  if (k === 'on') Object.entries(v).forEach(([ev, f]) => e.addEventListener(ev, f)); else if (k === 'class') e.className = v; else e.setAttribute(k, v); });
  kids.flat(Infinity).forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; }
const setting = (k, d) => { const r = S.settings.find((x) => x.id === k); return r ? r.value : d; };
const setSetting = async (k, v) => { const r = { id: k, value: v }; await DB.put('settings', r); S.settings = S.settings.filter((x) => x.id !== k).concat(r); };
const priceMap = () => { const m = Object.fromEntries(S.prices.map((p) => [p.id, p])), latest = {};   // newest of manual price vs imported history wins; source is labelled
  S.pricehist.forEach((x) => { if (!latest[x.symbol] || x.date > latest[x.symbol].date) latest[x.symbol] = x; });
  Object.values(latest).forEach((x) => { const c = m[x.symbol]; if (!c || x.date > c.date) m[x.symbol] = { id: x.symbol, price: x.price, date: x.date, source: 'Imported' }; }); return m; };
const costMethod = () => setting('costMethod', 'wavg'), summary = () => Calc.summarize(S.transactions, S.dividends, priceMap(), costMethod());

function toast(msg, bad) { const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), 4500); }
function download(name, text, type) { const u = URL.createObjectURL(new Blob([text], { type })), a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000); }
const csvCell = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''; let s = v == null ? '' : String(v);   // numbers stay numeric (negatives!); only text is neutralised against spreadsheet formulas
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

/* ---------- Audit trail & undo ---------- */
const describe = (r) => [r.symbol || r.kind || '', r.type || '', r.date || r.payDate || ''].join(' ').trim() || r.id;
async function addAudit(rec) { try { await DB.put('audit', rec); S.audit.push(rec); while (S.audit.length > 1000) { const old = S.audit.shift(); await DB.del('audit', old.id); } } catch (e) { toast('Change saved, but the audit entry could not be written.', true); } }
const log = (action, store, before, after) => addAudit({ id: uid(), at: new Date().toISOString(), action, store, recId: (after || before).id, label: describe(after || before), before: before ? JSON.parse(JSON.stringify(before)) : null, after: after ? JSON.parse(JSON.stringify(after)) : null, reversible: true });
const logBulk = (action, label) => addAudit({ id: uid(), at: new Date().toISOString(), action, store: '', recId: '', label, before: null, after: null, reversible: false });   // bulk changes block undo of anything before them
function lastUndoable() { for (let i = S.audit.length - 1; i >= 0; i--) { const e = S.audit[i]; if (e.undone) continue; return e.reversible ? e : null; } return null; }
function refreshUndo() { const e = lastUndoable(), b = $('#undo'); b.disabled = !e; b.title = e ? `Undo ${e.action}: ${e.label}` : 'Nothing to undo'; }
async function undoLast() {
  const e = lastUndoable(); if (!e) return; const plan = Calc.planUndo(e, S[e.store]);
  if (e.store === 'transactions') { const errs = Calc.computePortfolio(plan.next).errors; if (errs.length) return toast('Cannot undo: ' + errs[0], true); }
  try { if (plan.del) await DB.del(e.store, plan.del); if (plan.put) await DB.put(e.store, plan.put); S[e.store] = plan.next; e.undone = true; await DB.put('audit', e); render(); toast(`Undone: ${e.action} ${e.label}`); }
  catch (ex) { toast('Undo failed; nothing was changed.', true); await loadAll(); render(); }
}
function vAudit() {
  const e = lastUndoable(), rows = [...S.audit].reverse().slice(0, 300);
  return h('div', {}, h('p', { class: 'note' }, 'Every add, edit and delete of transactions, dividends, cash entries and watchlist items is logged here (last 1,000 kept). Undo reverses the most recent change only. Imports and restores cannot be undone and stop earlier changes from being undone.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', ...(e ? {} : { disabled: '' }), on: { click: undoLast } }, e ? `Undo ${e.action}: ${e.label}` : 'Nothing to undo'),
      h('button', { class: 'btn', on: { click: () => download('audit_log.csv', toCSV([['time', 'action', 'record type', 'record', 'undone']].concat(S.audit.map((x) => [x.at, x.action, x.store, x.label, x.undone ? 'yes' : '']))), 'text/csv') } }, 'Export audit CSV')),
    table([{ h: 'When', v: (r) => new Date(r.at).toLocaleString() }, { h: 'Action', v: (r) => r.action }, { h: 'Type', v: (r) => r.store }, { h: 'Record', v: (r) => r.label }, { h: 'Status', v: (r) => (r.undone ? 'undone' : '') }], rows));
}
/* ---------- Forms ---------- */
function openForm(title, fields, init, onSave) {
  const dlg = $('#dlg'), form = h('form', { method: 'dialog' }), err = h('p', { class: 'err', role: 'alert' });
  fields.forEach((f) => { const id = 'f_' + f.k; let inp = f.opts ? h('select', { id }, f.opts.map((o) => h('option', { value: o }, o)))
      : h('input', { id, type: f.type || 'text', step: f.step || 'any', ...(f.req ? { required: '' } : {}), ...(f.list ? { list: 'dl_broker' } : {}) });
    inp.value = init[f.k] != null ? init[f.k] : f.def != null ? f.def : ''; if (f.opts && !f.opts.includes(inp.value)) inp.value = f.opts[0]; form.append(h('label', {}, f.label, inp)); });
  if (fields.some((f) => f.list)) form.append(h('datalist', { id: 'dl_broker' }, S.brokers.map((b) => h('option', { value: b.name }))));
  let busy = false;
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
  form.append(err, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'), save));
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (busy) return; busy = true; save.disabled = true;   // blocks double-submit
    const v = {}; fields.forEach((f) => { let x = form.querySelector('#f_' + f.k).value.trim(); v[f.k] = f.type === 'number' && x !== '' ? Number(x) : f.k === 'symbol' ? x.toUpperCase() : x; });
    try { await onSave(v); dlg.close(); } catch (ex) { err.textContent = ex.message || 'Could not save.'; busy = false; save.disabled = false; } });
  dlg.replaceChildren(h('h2', {}, title), form); dlg.showModal();
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // LOCAL date (UTC would be a day behind in Pakistan after midnight)
const num = (k, l, o) => ({ k, label: l, type: 'number', ...o });
function txForm(t) {
  const f = [{ k: 'date', label: 'Date', type: 'date', req: 1, def: today() }, { k: 'symbol', label: 'Symbol', req: 1 }, { k: 'name', label: 'Company name' }, { k: 'sector', label: 'Sector' },
    { k: 'type', label: 'Type', opts: ['buy', 'sell', 'rights', 'bonus', 'split', 'reverse'] }, num('qty', 'Quantity (buy / sell / bonus shares)', { def: 0, step: '1' }), num('price', 'Price per share (Rs.)', { def: 0 }), num('ratioNew', 'Split / reverse split: new shares', { step: '1' }), num('ratioOld', 'Split / reverse split: per old shares', { step: '1' }),
    num('brokerage', 'Brokerage (actual)', { def: 0 }), num('taxes', 'Taxes / levies (actual)', { def: 0 }), num('other', 'Other charges', { def: 0 }), { k: 'broker', label: 'Broker / account', list: 1 }, { k: 'ref', label: 'Reference no.' }, { k: 'tags', label: 'Tags (comma separated)' }, { k: 'notes', label: 'Notes' }];
  openForm(t ? 'Edit transaction' : 'Add transaction', f, t || {}, async (v) => {
    if (!['buy', 'sell', 'rights', 'bonus', 'split', 'reverse'].includes(v.type)) throw new Error('Choose a transaction type.');
    if (v.type === 'split' || v.type === 'reverse') { if (!(v.ratioNew > 0) || !(v.ratioOld > 0)) throw new Error('Enter the ratio, e.g. 2 new per 1 old (split) or 1 new per 10 old (reverse).'); v.qty = 0; v.price = 0; }
    else { if (!(v.qty > 0) || !Number.isInteger(v.qty)) throw new Error('Quantity must be a whole number above zero.'); if (v.type === 'bonus') v.price = 0; else if (!(v.price >= 0)) throw new Error('Price cannot be negative.'); }
    if (!v.symbol || !Calc.isoD(v.date)) throw new Error('Symbol and a valid date (1950-2100) are required.'); if (!Calc.okSym(v.symbol)) throw new Error('Symbol must be 1-20 characters with no spaces.');
    if (v.qty > Calc.LIM.qty || v.price > Calc.LIM.price || ['brokerage', 'taxes', 'other'].some((k) => v[k] > Calc.LIM.money)) throw new Error('A number is too large (quantity up to 100,000,000; price up to Rs. 100,000).');
    ['brokerage', 'taxes', 'other'].forEach((k) => { if (!(v[k] >= 0)) v[k] = 0; });
    const rec = { ...(t || {}), ...v, id: t ? t.id : uid(), createdAt: t ? t.createdAt : Date.now(), updatedAt: Date.now() };
    const errs = Calc.computePortfolio(S.transactions.filter((x) => x.id !== rec.id).concat(rec)).errors;
    if (errs.length) throw new Error('Would create a negative holding: ' + errs[0]);   // short selling is not supported
    await DB.put('transactions', rec); await log(t ? 'edit' : 'add', 'transactions', t, rec); S.transactions = S.transactions.filter((x) => x.id !== rec.id).concat(rec); render(); toast('Transaction saved'); });
}
function divForm(d) {
  const f = [{ k: 'symbol', label: 'Symbol', req: 1 }, { k: 'name', label: 'Company name' }, { k: 'type', label: 'Dividend type', def: 'Cash' }, { k: 'exDate', label: 'Ex-dividend date', type: 'date' },
    { k: 'payDate', label: 'Payment date', type: 'date' }, num('shares', 'Eligible shares (enter manually)', { req: 1, step: '1' }), num('dps', 'Dividend per share (Rs.)', { req: 1 }),
    num('taxRate', 'Withholding tax rate % (your actual rate)', { def: 0 }), num('other', 'Other deductions', { def: 0 }),
    { k: 'status', label: 'Status', opts: ['announced', 'expected', 'received', 'cancelled'] }, num('actual', 'Actual amount received (optional)'), { k: 'broker', label: 'Broker / account', list: 1 }, { k: 'tags', label: 'Tags (comma separated)' }, { k: 'notes', label: 'Notes' }];
  openForm(d ? 'Edit dividend' : 'Add dividend', f, d || { status: 'announced' }, async (v) => {
    if (!(v.shares > 0) || !(v.dps >= 0) || !(v.taxRate >= 0 && v.taxRate <= 100)) throw new Error('Check shares, dividend per share and tax rate (0–100).');
    if (!Calc.okSym(v.symbol)) throw new Error('Symbol must be 1-20 characters with no spaces.'); if (v.shares > Calc.LIM.shares || v.dps > Calc.LIM.price || v.actual > Calc.LIM.money) throw new Error('A number is too large.');
    if ((v.payDate && !Calc.isoD(v.payDate)) || (v.exDate && !Calc.isoD(v.exDate))) throw new Error('Check the dates (1950-2100).');
    if (v.other === '') v.other = 0; if (!(v.other >= 0)) throw new Error('Other deductions cannot be negative.');
    if (v.actual !== '' && !(v.actual >= 0)) throw new Error('Actual amount received cannot be negative.');
    if (v.exDate && v.payDate && v.payDate < v.exDate) throw new Error('Payment date cannot be before the ex-dividend date.');
    if (v.status === 'received' && !v.payDate) throw new Error('Enter the payment date for a received dividend.');
    const rec = { ...(d || {}), ...v, id: d ? d.id : uid(), createdAt: d ? d.createdAt : Date.now() };
    await DB.put('dividends', rec); await log(d ? 'edit' : 'add', 'dividends', d, rec); S.dividends = S.dividends.filter((x) => x.id !== rec.id).concat(rec); render(); toast('Dividend saved'); });
}
const confirmDel = async (store, key, id, what) => { if (!confirm(`Delete this ${what}? All totals will be recalculated.`)) return;
  const prev = S[key]; if (key === 'transactions') { const errs = Calc.computePortfolio(prev.filter((x) => x.id !== id)).errors; if (errs.length) return toast('Cannot delete: ' + errs[0], true); }
  try { await DB.del(store, id); } catch (e) { return toast('Delete failed; nothing was changed.', true); }
  await log('delete', store, prev.find((x) => x.id === id), null); S[key] = prev.filter((x) => x.id !== id); render(); toast('Deleted'); };

/* ---------- Views ---------- */
const table = (cols, rows) => rows.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.n ? 'n' : '' }, c.h)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: (c.n ? 'n ' : '') + (c.c ? c.c(r) : '') }, c.v(r)))))))) : h('p', { class: 'empty' }, 'Nothing here yet.');
const card = (l, v, c, note) => h('div', { class: 'card' }, h('span', { class: 'lbl' }, l), h('strong', { class: c || '' }, v), note ? h('small', {}, note) : null);
function bars(title, items, fmtv) {   // native SVG bar chart; labels via <title> tooltips
  if (!items.length) return h('div', { class: 'chart' }, h('h3', {}, title), h('p', { class: 'empty' }, 'No data yet.'));
  const max = Math.max(...items.map((i) => Math.abs(i.v)), 1), W = 520, row = 26, H = items.length * row + 6, ns = 'http://www.w3.org/2000/svg';
  const mk = (t, a, txt) => { const e = document.createElementNS(ns, t); Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v)); if (txt != null) e.textContent = txt; return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  items.forEach((it, i) => { const y = i * row + 3, w = Math.max(2, (Math.abs(it.v) / max) * 300), g = mk('g', {});
    g.append(mk('title', {}, `${it.l}: ${fmtv(it.v)}`), mk('text', { x: 0, y: y + 16, class: 'ct' }, it.l), mk('rect', { x: 90, y, width: w, height: 18, rx: 2, class: it.v < 0 ? 'bneg' : 'bar' }), mk('text', { x: 96 + w, y: y + 14, class: 'ct' }, fmtv(it.v))); svg.append(g); });
  return h('div', { class: 'chart' }, h('h3', {}, title), svg);
}
function dual(title, items, nA, nB, fmtv) {   // grouped horizontal bars: A (muted) and B (accent) per label
  if (!items.length) return h('div', { class: 'chart' }, h('h3', {}, title), h('p', { class: 'empty' }, 'No data yet.'));
  const max = Math.max(...items.flatMap((i) => [Math.abs(i.a), Math.abs(i.b)]), 1), W = 520, row = 38, H = items.length * row + 6, ns = 'http://www.w3.org/2000/svg';
  const mk = (t, at, txt) => { const e = document.createElementNS(ns, t); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); if (txt != null) e.textContent = txt; return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  items.forEach((it, i) => { const y = i * row + 3, wa = Math.max(2, (Math.abs(it.a) / max) * 280), wb = Math.max(2, (Math.abs(it.b) / max) * 280), g = mk('g', {});
    g.append(mk('title', {}, `${it.l} · ${nA}: ${fmtv(it.a)} · ${nB}: ${fmtv(it.b)}`), mk('text', { x: 0, y: y + 22, class: 'ct' }, it.l), mk('rect', { x: 90, y, width: wa, height: 15, rx: 2, class: 'bar2' }), mk('text', { x: 96 + wa, y: y + 12, class: 'ct' }, fmtv(it.a)),
      mk('rect', { x: 90, y: y + 17, width: wb, height: 15, rx: 2, class: 'bar' }), mk('text', { x: 96 + wb, y: y + 29, class: 'ct' }, fmtv(it.b))); svg.append(g); });
  return h('div', { class: 'chart' }, h('h3', {}, title), h('p', { class: 'note' }, h('span', { class: 'sw a' }), nA, h('span', { class: 'sw b' }), nB), svg);
}
function twrCard() {
  const t = Calc.twr(S.transactions, S.dividends, S.pricehist, today());
  return card('Time-weighted return (approx.)', t.cum == null ? '–' : pct(t.cum * 100), t.cum == null ? '' : cls(t.cum),
    t.cum == null ? t.reason : `${t.used} of ${t.total} month(s) usable, chain-linked${t.used < t.total ? ' (months with no price yet for a held stock are skipped)' : ''}${t.ann != null ? ` · annualised ${pct(t.ann * 100)}` : ''}`);
}
function xirrCard() {
  const x = Calc.portfolioXirr(S.transactions, S.dividends, priceMap());
  return card('Annualised return (XIRR)', x.rate == null ? '–' : pct(x.rate * 100), x.rate == null ? '' : cls(x.rate), x.rate == null ? x.reason : x.days < 365 ? `Only ${Math.round(x.days)} days of history: indicative, not reliable` : 'Money-weighted; trades, received dividends, current value');
}
function vDashboard() { const el = vDashboardBase(), vs = Calc.valueSeries(S.transactions, S.pricehist, today());
  const items = vs.points.slice(-24).map((p) => ({ l: p.month, a: p.cost / 100, b: p.value / 100 }));
  el.append(insightsBlock(), h('div', { class: 'grid2' }, dual('Invested cost vs market value at month-end (Rs.)', items, 'Cost', 'Value', (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 })),
    h('p', { class: 'note' }, S.pricehist.length ? `Built from imported price history only (last price on or before each month-end). ${vs.skipped} month(s) skipped because a held stock had no price yet.` : 'No price history imported. Import prices in Watchlist to see value over time; nothing is estimated.'))); return el; }
function vDashboardBase() {
  const s = summary(), d = s.div, top = [...s.holdings].sort((a, b) => b.cost - a.cost);
  const dm = Object.entries(d.byMonth).sort().slice(-12).map(([l, v]) => ({ l, v: v / 100 }));
  return h('div', {}, s.errors.length ? h('p', { class: 'err' }, 'Data problem: ' + s.errors[0]) : null,
    h('div', { class: 'cards' }, card('Cost of held positions', 'Rs. ' + fmt(s.cost)), card('Market value (manual prices)', s.holdings.length ? 'Rs. ' + fmt(s.value) : '–', '', s.unpriced ? `${s.unpriced} holding(s) have no price and are excluded` : 'From prices you entered'),
      card('Unrealized P&L', 'Rs. ' + fmt(s.unrealized), cls(s.unrealized)), card('Realized P&L', 'Rs. ' + fmt(s.realized), cls(s.realized), 'Cost basis: ' + (costMethod() === 'fifo' ? 'FIFO' : 'weighted average')),
      card('Net dividends received', 'Rs. ' + fmt(d.net), '', `Gross ${fmt(d.gross)} · tax ${fmt(d.tax)}`), card('Expected dividends', 'Rs. ' + fmt(d.expected), '', 'Not yet received'),
      xirrCard(), twrCard(), card('Total fees & charges', 'Rs. ' + fmt(s.fees)), card('Total return', 'Rs. ' + fmt(s.totalReturn), cls(s.totalReturn), 'Realized + unrealized + net dividends')),
    h('div', { class: 'grid2' }, bars('Cost by holding (Rs.)', top.slice(0, 10).map((x) => ({ l: x.symbol, v: x.cost / 100 })), (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 })),
      bars('Net dividends received by month (Rs.)', dm, (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 }))));
}
function holdingDetail(sym) {
  const s = summary(), r = s.holdings.find((x) => x.symbol === sym) || s.closed.find((x) => x.symbol === sym), dlg = $('#dlg'), tx = S.transactions.filter((t) => t.symbol === sym).sort((a, b) => (a.date < b.date ? -1 : 1)),
    dv = S.dividends.filter((d) => d.symbol === sym).sort((a, b) => ((a.payDate || '') < (b.payDate || '') ? -1 : 1)), rr = s.realizedRows.filter((x) => x.symbol === sym);
  if (!r) return; dlg.className = 'wide'; dlg.addEventListener('close', () => (dlg.className = ''), { once: true });
  dlg.replaceChildren(h('h2', {}, sym + (r.name ? ' · ' + r.name : '')), h('div', { class: 'cards' }, card('Quantity', String(r.qty)), card('Average cost', r.avg == null ? '–' : r.avg.toFixed(2)), card('Cost basis', 'Rs. ' + fmt(r.cost)), card('Market value', r.value == null ? '–' : 'Rs. ' + fmt(r.value), '', r.price == null ? '' : `${r.price} on ${fmtD(r.priceDate)}`),
      card('Unrealized P&L', r.unrealized == null ? '–' : 'Rs. ' + fmt(r.unrealized), cls(r.unrealized)), card('Realized P&L', 'Rs. ' + fmt(r.realized), cls(r.realized)), card('Net dividends received', 'Rs. ' + fmt(r.divNet))),
    h('h3', {}, 'Transactions'), table([{ h: 'Date', v: (t) => fmtD(t.date) }, { h: 'Type', v: (t) => t.type }, { h: 'Qty / ratio', n: 1, v: (t) => (t.type === 'split' || t.type === 'reverse' ? `${t.ratioNew}:${t.ratioOld}` : t.qty) }, { h: 'Price', n: 1, v: (t) => t.price }, { h: 'Total', n: 1, v: (t) => fmt(Calc.txAmounts(t).total) }], tx),
    h('h3', {}, 'Dividends'), table([{ h: 'Pay date', v: (d) => fmtD(d.payDate) }, { h: 'Status', v: (d) => d.status }, { h: 'Net / actual', n: 1, v: (d) => fmt(Calc.dividendAmounts(d).received) }], dv),
    h('h3', {}, 'Realized sales'), table([{ h: 'Date', v: (x) => fmtD(x.date) }, { h: 'Net proceeds', n: 1, v: (x) => fmt(x.proceeds) }, { h: 'Cost sold', n: 1, v: (x) => fmt(x.costSold) }, { h: 'P&L', n: 1, c: (x) => cls(x.pl), v: (x) => fmt(x.pl) }], rr),
    h('div', { class: 'row' }, h('button', { class: 'btn', on: { click: () => dlg.close() } }, 'Close'))); dlg.showModal();
}
function vHoldings() {
  const s = summary(), q = S.q.toLowerCase(), arch = setting('archived', []), rows = s.holdings.concat(S.showClosed ? s.closed : []).filter((x) => (x.symbol + (x.name || '')).toLowerCase().includes(q) && (S.showArchived || !arch.includes(x.symbol)));
  return h('div', {}, h('p', { class: 'note' }, 'Quantity and cost are derived from your transactions (weighted average). Prices are entered by you; none are fetched.'),
    h('div', { class: 'row wrap' }, [['showClosed', ' Show closed positions'], ['showArchived', ' Show archived']].map(([k, l]) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', ...(S[k] ? { checked: '' } : {}), on: { change: (e) => { S[k] = e.target.checked; render(); } } }), l))),
    h('p', { class: 'note' }, 'Archiving only hides a row here. Totals, reports and history are unchanged.'),
    table([{ h: 'Symbol', v: (r) => h('strong', {}, r.symbol) }, { h: 'Name', v: (r) => r.name || '' }, { h: 'Qty', n: 1, v: (r) => r.qty }, { h: 'Avg cost', n: 1, v: (r) => (r.avg == null ? '–' : r.avg.toFixed(2)) }, { h: 'Cost basis', n: 1, v: (r) => fmt(r.cost) },
      { h: 'Price', n: 1, v: (r) => (r.price == null ? 'not set' : r.price + ' (' + fmtD(r.priceDate) + ')') }, { h: 'Value', n: 1, v: (r) => fmt(r.value) }, { h: 'Unrealized', n: 1, c: (r) => cls(r.unrealized), v: (r) => fmt(r.unrealized) },
      { h: 'Return', n: 1, c: (r) => cls(r.retPct), v: (r) => pct(r.retPct) }, { h: 'Realized', n: 1, c: (r) => cls(r.realized), v: (r) => fmt(r.realized) }, { h: 'Net div', n: 1, v: (r) => fmt(r.divNet) },
      { h: '', v: (r) => h('span', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => holdingDetail(r.symbol) } }, 'Details'), r.closed ? null : h('button', { class: 'btn sm', on: { click: () => priceForm(r.symbol) } }, 'Set price'),
      h('button', { class: 'btn sm', on: { click: async () => { await setSetting('archived', arch.includes(r.symbol) ? arch.filter((x) => x !== r.symbol) : arch.concat(r.symbol)); render(); } } }, arch.includes(r.symbol) ? 'Unarchive' : 'Archive')) }], rows));
}
function priceForm(sym) { const p = priceMap()[sym];
  openForm('Price for ' + sym, [num('price', 'Price per share (Rs.)', { req: 1 }), { k: 'date', label: 'Price date', type: 'date', req: 1 }], { price: p ? p.price : '', date: today() }, async (v) => {
    if (v.price === '' || !(v.price >= 0) || v.price > Calc.LIM.price) throw new Error('Enter a valid price (0 to 100,000).'); if (!Calc.isoD(v.date)) throw new Error('Choose a valid price date.'); const rec = { id: sym, price: v.price, date: v.date, source: 'Manually entered' };
    await DB.put('prices', rec); S.prices = S.prices.filter((x) => x.id !== sym).concat(rec); render(); const eff = priceMap()[sym]; if (eff && eff.source === 'Imported' && eff.date > v.date) toast(`Saved, but imported history has a newer price (${eff.price} on ${fmtD(eff.date)}), which is still the one used for valuation.`, true); else toast('Price saved'); }); }
function vTx() {
  const q = S.q.toLowerCase(), rows = [...S.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).filter((t) => (t.symbol + (t.name || '')).toLowerCase().includes(q));
  return h('div', {}, h('button', { class: 'btn primary', on: { click: () => txForm() } }, 'Add transaction'),
    table([{ h: 'Date', v: (r) => fmtD(r.date) }, { h: 'Symbol', v: (r) => r.symbol }, { h: 'Type', v: (r) => r.type }, { h: 'Qty / ratio', n: 1, v: (r) => (r.type === 'split' || r.type === 'reverse' ? `${r.ratioNew}:${r.ratioOld}` : r.qty) }, { h: 'Price', n: 1, v: (r) => r.price },
      { h: 'Fees', n: 1, v: (r) => fmt(Calc.txAmounts(r).fees) }, { h: 'Total cost / net proceeds', n: 1, v: (r) => fmt(Calc.txAmounts(r).total) }, { h: 'Broker', v: (r) => r.broker || '' },
      { h: '', v: (r) => h('span', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => txForm(r) } }, 'Edit'), h('button', { class: 'btn sm', on: { click: () => confirmDel('transactions', 'transactions', r.id, 'transaction') } }, 'Delete')) }], rows));
}
function divChartsBase(d) {
  const yr = {}; Object.entries(d.byMonth).forEach(([m, v]) => (yr[m.slice(0, 4)] = (yr[m.slice(0, 4)] || 0) + v)); const f0 = (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 });
  return h('div', { class: 'grid2' }, bars('Net dividends received by year (Rs.)', Object.entries(yr).sort().map(([l, v]) => ({ l, v: v / 100 })), f0),
    bars('Net dividends received by stock (Rs.)', Object.entries(d.bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, v]) => ({ l, v: v / 100 })), f0));
}
function divCharts(d) {
  const base = divChartsBase(d); if (!S.dividends.length) return base;
  const b = Calc.dividendBreakdown(S.dividends), f0 = (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 }), yrs = Object.keys(b.byYear).sort(), all = [...new Set([...yrs, ...Object.keys(b.expByYear)])].sort(), tot = Object.values(d.bySymbol).reduce((x, y) => x + y, 0);
  return h('div', {}, base, h('div', { class: 'grid2' }, dual('Gross vs net received by year (Rs.)', yrs.map((y) => ({ l: y, a: b.byYear[y].gross / 100, b: b.byYear[y].net / 100 })), 'Gross', 'Net (actual where entered)', f0),
    bars('Withholding tax by year (Rs.)', yrs.map((y) => ({ l: y, v: b.byYear[y].tax / 100 })), f0),
    dual('Expected vs received by year (Rs.)', all.map((y) => ({ l: y, a: (b.expByYear[y] || 0) / 100, b: (b.byYear[y] ? b.byYear[y].net : 0) / 100 })), 'Expected / announced', 'Received', f0),
    bars('Dividends by status (Rs.; cancelled = estimate)', ['received', 'expected', 'announced', 'cancelled'].map((k) => ({ l: k, v: b.status[k] / 100 })), f0),
    bars('Withholding tax by month, last 12 (Rs.)', Object.entries(b.taxByMonth).sort().slice(-12).map(([l, v]) => ({ l, v: v / 100 })), f0),
    bars('Share of received net dividends by stock (%)', tot ? Object.entries(d.bySymbol).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([l, v]) => ({ l, v: (v / tot) * 100 })) : [], (v) => v.toFixed(1) + '%')));
}
function vDiv() {
  const d = Calc.dividendTotals(S.dividends), q = S.q.toLowerCase(), rows = [...S.dividends].sort((a, b) => ((a.payDate || '') < (b.payDate || '') ? 1 : -1)).filter((x) => (x.symbol + (x.name || '')).toLowerCase().includes(q));
  return h('div', {}, h('div', { class: 'cards' }, card('Gross received', 'Rs. ' + fmt(d.gross)), card('Withholding tax', 'Rs. ' + fmt(d.tax)), card('Net received', 'Rs. ' + fmt(d.net)), card('Expected (not received)', 'Rs. ' + fmt(d.expected))),
    divCharts(d), h('button', { class: 'btn primary', on: { click: () => divForm() } }, 'Add dividend'),
    table([{ h: 'Pay date', v: (r) => fmtD(r.payDate) }, { h: 'Symbol', v: (r) => r.symbol }, { h: 'Status', v: (r) => r.status }, { h: 'Shares', n: 1, v: (r) => r.shares }, { h: 'DPS', n: 1, v: (r) => r.dps },
      { h: 'Gross', n: 1, v: (r) => fmt(Calc.dividendAmounts(r).gross) }, { h: 'Tax', n: 1, v: (r) => fmt(Calc.dividendAmounts(r).tax) }, { h: 'Net', n: 1, v: (r) => fmt(Calc.dividendAmounts(r).net) },
      { h: 'Actual received', n: 1, v: (r) => (Calc.dividendAmounts(r).isActual ? fmt(Calc.dividendAmounts(r).received) : 'estimate') },
      { h: '', v: (r) => h('span', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => divForm(r) } }, 'Edit'), h('button', { class: 'btn sm', on: { click: () => confirmDel('dividends', 'dividends', r.id, 'dividend') } }, 'Delete')) }], rows));
}

/* ---------- Backup / restore ---------- */
const buildBackup = () => ({ app: 'PSX Portfolio Manager', appVersion: APP_VERSION, schemaVersion: SCHEMA, createdAt: new Date().toISOString(),
  data: { transactions: S.transactions, dividends: S.dividends, prices: S.prices, settings: S.settings, cash: S.cash, watchlist: S.watchlist, pricehist: S.pricehist, audit: S.audit, brokers: S.brokers } });
async function exportBackup() { download(`PSX_Portfolio_Backup_${today()}.json`, JSON.stringify(buildBackup(), null, 2), 'application/json'); await setSetting('lastBackup', new Date().toISOString()); render();
  toast('Backup file generated. Check your Downloads folder.'); }
function validateBackup(b) {
  const e = []; if (!b || b.app !== 'PSX Portfolio Manager' || !b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return ['Not a PSX Portfolio Manager backup.'];
  if (b.schemaVersion > SCHEMA) return ['Backup is from a newer version of the app. Update the app first.'];
  const D = b.data, isD = (x) => Calc.isoD(x || ''), STORES = ['transactions', 'dividends', 'prices', 'settings', 'cash', 'watchlist', 'pricehist', 'audit', 'brokers'];
  STORES.forEach((k) => { if (!Array.isArray(D[k] || [])) e.push(k + ' is not a list'); });
  if (e.length) return e;
  STORES.forEach((k) => { const seen = new Set(); D[k] = D[k] || []; D[k].forEach((r, i) => { if (!r || typeof r !== 'object' || typeof r.id !== 'string' && typeof r.id !== 'number' || r.id === '') e.push(`${k} #${i + 1}: missing id`); else if (seen.has(r.id)) e.push(`${k} #${i + 1}: duplicate id`); else seen.add(r.id); }); });
  if (e.length) return e.slice(0, 15);
  (D.transactions || []).forEach((t, i) => {
    if (!isD(t.date) || !t.symbol || !['buy', 'sell', 'rights', 'bonus', 'split', 'reverse'].includes(t.type) || !(t.price >= 0) || (['split', 'reverse'].includes(t.type) ? !(t.ratioNew > 0 && t.ratioOld > 0) : !(t.qty > 0 && Number.isInteger(t.qty)))) e.push(`transaction #${i + 1}: invalid fields`); });
  (D.dividends || []).forEach((d, i) => { if (!d.symbol || !(d.shares > 0) || !(d.dps >= 0) || !['announced', 'expected', 'received', 'cancelled'].includes(d.status) || (d.payDate && !isD(d.payDate)) || (d.exDate && !isD(d.exDate)) || (d.status === 'received' && !d.payDate) || !(((d.taxRate === '' ? 0 : d.taxRate) ?? 0) >= 0 && (d.taxRate || 0) <= 100) || ((d.other || 0) < 0) || (d.actual !== '' && d.actual != null && !(d.actual >= 0))) e.push(`dividend #${i + 1}: invalid fields`); });
  (D.settings || []).forEach((x, i) => { const v = x.value, ok = typeof x.id === 'string' && (x.id === 'archived' ? Array.isArray(v) : x.id === 'presets' ? Array.isArray(v) && v.every((q) => q && typeof q.name === 'string' && q.f && typeof q.f === 'object') : x.id === 'costMethod' ? ['wavg', 'fifo'].includes(v) : x.id === 'fyStart' ? Number.isInteger(v) && v >= 1 && v <= 12 : x.id === 'theme' ? THEMES.includes(v) : true); if (!ok) e.push(`setting #${i + 1} (${x.id}): invalid value`); });
  (D.cash || []).forEach((m, i) => { if (!isD(m.date) || !Number.isFinite(m.amount) || !['deposit', 'withdrawal', 'adjustment'].includes(m.kind)) e.push(`cash entry #${i + 1}: invalid fields`); });
  (D.pricehist || []).forEach((p, i) => { if (!p.symbol || !isD(p.date) || !(p.price >= 0)) e.push(`price history #${i + 1}: invalid fields`); });
  (D.watchlist || []).forEach((w, i) => { if (!w.symbol) e.push(`watchlist #${i + 1}: invalid fields`); });
  (D.prices || []).forEach((p, i) => { if (!(p.price >= 0)) e.push(`price #${i + 1}: invalid`); });
  if (!e.length) { const c = Calc.computePortfolio(D.transactions || []); e.push(...c.errors); } return e.slice(0, 15);
}
async function chooseRestore(file) {
  if (file.size > 25e6) return toast('File too large (25 MB limit).', true);
  let b; try { b = JSON.parse(await file.text()); } catch { return toast('File is not valid JSON.', true); }
  const errs = validateBackup(b); const D = (b && b.data) || {};
  const dlg = $('#dlg'); dlg.replaceChildren(h('h2', {}, 'Restore preview'), errs.length ? h('div', {}, h('p', { class: 'err' }, 'This file failed validation and will not be imported:'), h('ul', {}, errs.map((x) => h('li', {}, x)))) :
    h('div', {}, h('p', {}, `Backup created ${b.createdAt}: ${(D.transactions || []).length} transactions, ${(D.dividends || []).length} dividends, ${(D.prices || []).length} prices. Your current data: ${S.transactions.length} transactions, ${S.dividends.length} dividends.`),
      h('p', { class: 'note' }, `Merge would add ${(D.transactions || []).filter((r) => !S.transactions.some((x) => x.id === r.id)).length} transaction(s) and ${(D.dividends || []).filter((r) => !S.dividends.some((x) => x.id === r.id)).length} dividend(s) not already here. If this backup came from this same portfolio and you imported the same CSV on both devices, Merge can double-count; use Replace instead.`), h('p', { class: 'note' }, 'Replace erases current data first (a safety backup downloads automatically). Merge adds records with new IDs and keeps your current version of any record with the same ID.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', on: { click: () => doRestore(D, false) } }, 'Merge'), h('button', { class: 'btn danger', on: { click: () => doRestore(D, true) } }, 'Replace current portfolio'))),
    h('button', { class: 'btn', on: { click: () => dlg.close() } }, 'Cancel')); dlg.showModal();
}
async function doRestore(D, replace) {
  try { if (replace) { if (!confirm('Replace ALL current data with the backup? This cannot be undone except via the safety backup.')) return; download(`PSX_Portfolio_SafetyBackup_${Date.now()}.json`, JSON.stringify(buildBackup()), 'application/json'); }
    const keep = replace ? {} : Object.fromEntries(['transactions', 'dividends', 'prices', 'settings', 'cash', 'watchlist', 'pricehist', 'audit', 'brokers'].map((k) => [k, new Set(S[k].map((r) => r.id))]));
    const data = Object.fromEntries(['transactions', 'dividends', 'prices', 'settings', 'cash', 'watchlist', 'pricehist', 'audit', 'brokers'].map((k) => [k, (D[k] || []).filter((r) => replace || !keep[k].has(r.id))]));
    if (!replace) { const pe = Calc.computePortfolio(S.transactions.concat(data.transactions)).errors; if (pe.length) return toast('Merge refused: it would create a negative holding (' + pe[0] + '). Nothing was changed.', true); }
    await DB.bulk(data, replace); await loadAll(); await logBulk(replace ? 'restore-replace' : 'restore-merge', 'Backup restore'); $('#dlg').close(); render(); toast(replace ? 'Portfolio replaced' : 'Backup merged');
  } catch (e) { toast('Restore failed; nothing was changed. ' + (e && e.name || ''), true); }
}
function vData() {
  const lb = setting('lastBackup'), mk = (label, name, rows) => h('button', { class: 'btn', on: { click: () => download(name, toCSV(rows), 'text/csv') } }, label), inp = h('input', { type: 'file', accept: '.json,application/json', on: { change: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) chooseRestore(f); } } });
  const s = summary();
  return h('div', {}, autosaveCard(), h('p', { class: lb ? 'note' : 'err' }, lb ? 'Last backup file generated: ' + fmtD(lb.slice(0, 10)) : 'No backup yet. Browser data can be lost if you clear site data or change profile.'),
    h('p', { class: 'note' }, 'Backups contain sensitive financial data. Store them somewhere private.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: exportBackup } }, 'Export full backup (JSON)'), h('label', { class: 'btn' }, 'Restore from backup…', inp)),
    h('h3', {}, 'CSV import (you choose the columns after picking a file)'), h('p', { class: 'note' }, 'Typical headers (different names can be mapped on the next screen): date (YYYY-MM-DD), symbol, type (buy/sell/bonus/split/reverse), qty, price. Optional: brokerage, taxes, other, broker, ref, notes, ratioNew, ratioOld. Exact duplicates are skipped; any invalid row blocks the import.'),
      h('div', { class: 'row wrap' }, h('label', { class: 'btn' }, 'Choose CSV…', h('input', { type: 'file', accept: '.csv,text/csv', on: { change: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startImport('transactions', f); } } })),
        h('button', { class: 'btn', on: { click: () => download('transactions_template.csv', toCSV([['date', 'symbol', 'type', 'qty', 'price', 'brokerage', 'taxes', 'other', 'broker', 'ref', 'notes', 'ratioNew', 'ratioOld'], ['2026-01-05', 'ABC', 'buy', 100, 50, 50, 0, 0, '', '', '', '', '']]), 'text/csv') } }, 'Download template')),
    h('div', { class: 'row wrap' }, [['dividends', 'Import dividends CSV (with eligible shares)…', 'dividends_template.csv', [['symbol', 'payDate', 'status', 'shares', 'dps', 'taxRate', 'other', 'actual', 'broker'], ['ABC', '2026-06-10', 'received', 100, 2.5, 15, 0, '', '']]],
      ['holdings', 'Import holdings CSV…', 'holdings_template.csv', [['Sr. No.', 'Stock Name', 'Symbol', 'Rate', '52 Week High', 'Gap', 'Shares', 'Amount', 'Avg Buy', 'Dividend', 'Est Div @1000', 'Sector'], [1, 'Lucky Cement', 'LUCK', 450.5, 520, '', 1000, '', 380.25, '', '', 'Cement']]],
      ['dividendSheet', 'Import dividends (sheet format)…', 'dividends_sheet_template.csv', [['Sr. No.', 'Stock Name', 'Symbol', 'Date', 'Dividend', 'Tax%', 'Actual Dividend'], [1, 'Lucky Cement', 'LUCK', '15-Mar-2026', 10, 15, 8500]]],
      ['cash', 'Import cash ledger CSV…', 'cash_template.csv', [['date', 'kind', 'amount', 'notes'], ['2026-01-02', 'deposit', 100000, 'initial funding']]]].map(([k, l, f, rows]) => [h('label', { class: 'btn' }, l, h('input', { type: 'file', accept: '.csv,text/csv', on: { change: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startImport(k, f); } } })), h('button', { class: 'btn', on: { click: () => download(f, toCSV(rows), 'text/csv') } }, 'Template')])),
    h('h3', {}, 'CSV exports'), h('div', { class: 'row wrap' },
      mk('Transactions', 'transactions.csv', [['date', 'symbol', 'type', 'qty', 'price', 'brokerage', 'taxes', 'other', 'broker', 'ref', 'notes', 'ratioNew', 'ratioOld', 'tags']].concat(S.transactions.map((t) => [t.date, t.symbol, t.type, t.qty, t.price, t.brokerage, t.taxes, t.other, t.broker, t.ref, t.notes, t.ratioNew, t.ratioOld, t.tags]))),
      mk('Dividends', 'dividends.csv', [['symbol', 'payDate', 'status', 'shares', 'dps', 'gross', 'tax', 'net', 'actual', 'taxRate', 'other', 'exDate', 'broker', 'name', 'notes', 'tags']].concat(S.dividends.map((d) => { const a = Calc.dividendAmounts(d); return [d.symbol, d.payDate, d.status, d.shares, d.dps, a.gross / 100, a.tax / 100, a.net / 100, d.actual, d.taxRate, d.other, d.exDate, d.broker, d.name, d.notes, d.tags]; }))),
      mk('Holdings', 'holdings.csv', [['symbol', 'qty', 'avg_cost', 'cost_basis', 'price', 'value', 'unrealized']].concat(s.holdings.map((r) => [r.symbol, r.qty, r.avg.toFixed(4), r.cost / 100, r.price, r.value == null ? '' : r.value / 100, r.unrealized == null ? '' : r.unrealized / 100]))),
      mk('Cash ledger', 'cash_ledger.csv', [['date', 'type', 'symbol', 'amount', 'balance']].concat(Calc.cashLedger(S.transactions, S.dividends, S.cash).map((r) => [r.date, r.kind, r.symbol, r.amount / 100, r.balance / 100]))),
      mk('Prices', 'prices.csv', [['symbol', 'price', 'date', 'source']].concat(S.prices.map((p) => [p.id, p.price, p.date, p.source])))),
    h('h3', {}, 'Danger zone'), h('button', { class: 'btn danger', on: { click: async () => { if (confirm('Delete ALL portfolio data from this browser? Export a backup first.') && prompt('Type DELETE to confirm') === 'DELETE') { await DB.wipe(); await loadAll(); await logBulk('wipe', 'All data deleted'); render(); toast('All data deleted'); } } } }, 'Delete all data'));
}
function vSettings() {
  const sel = h('select', { on: { change: async (e) => { await setSetting('theme', e.target.value); applyTheme(); } } }, THEMES.map((t) => h('option', { value: t, ...(t === setting('theme', 'light') ? { selected: '' } : {}) }, t)));
  return h('div', {}, h('label', { class: 'inline' }, 'Theme ', sel), h('button', { class: 'btn', on: { click: () => { S.view = 'audit'; render(); } } }, 'Open change history'), h('label', { class: 'inline' }, 'Cost-basis method ', h('select', { on: { change: async (e) => { await setSetting('costMethod', e.target.value); render(); toast('Cost method changed; realized P&L recalculated'); } } }, [['wavg', 'Weighted average'], ['fifo', 'FIFO']].map(([v, l]) => h('option', { value: v, ...(v === costMethod() ? { selected: '' } : {}) }, l)))), h('p', { class: 'note' }, 'Switching method restates realized P&L and remaining cost per holding; total return is unchanged. Your records are not modified.'), h('label', { class: 'inline' }, 'Financial year starts in ', h('select', { on: { change: async (e) => { await setSetting('fyStart', +e.target.value); toast('Saved'); } } }, MON.map((m, i) => h('option', { value: i + 1, ...(i + 1 === setting('fyStart', 7) ? { selected: '' } : {}) }, m)))), h('p', { class: 'note' }, 'Currency: PKR · Market: Pakistan Stock Exchange · Cost basis: weighted average. This is an independent tool, not an official PSX application. No tax or commission rates are assumed; enter actual amounts.'),
    h('p', { class: 'note' }, 'App version ' + APP_VERSION + ' · schema ' + SCHEMA + '. Storage persistence: ' + (S.persisted === true ? 'granted' : 'not guaranteed; keep backups') + '.'));
}
function cashForm(m) {
  openForm(m ? 'Edit cash entry' : 'Add deposit / withdrawal', [{ k: 'date', label: 'Date', type: 'date', req: 1, def: today() }, { k: 'kind', label: 'Type', opts: ['deposit', 'withdrawal', 'adjustment'] },
    num('amount', 'Amount (Rs.; adjustments may be negative)', { req: 1 }), { k: 'notes', label: 'Notes' }], m ? { ...m, amount: Math.abs(m.amount) * (m.kind === 'adjustment' ? Math.sign(m.amount) : 1) } : {}, async (v) => {
    if (!Calc.isoD(v.date) || !Number.isFinite(v.amount) || Math.abs(v.amount) > Calc.LIM.money) throw new Error('Enter a valid date (1950-2100) and a reasonable amount.');
    if (!['deposit', 'withdrawal', 'adjustment'].includes(v.kind)) throw new Error('Choose a type.'); if (v.amount === 0) throw new Error('Amount cannot be zero.');
    if (v.kind !== 'adjustment') { if (!(v.amount > 0)) throw new Error('Amount must be above zero.'); if (v.kind === 'withdrawal') v.amount = -v.amount; }
    const rec = { ...(m || {}), ...v, id: m ? m.id : uid(), createdAt: m ? m.createdAt : Date.now() };
    await DB.put('cash', rec); await log(m ? 'edit' : 'add', 'cash', m, rec); S.cash = S.cash.filter((x) => x.id !== rec.id).concat(rec); render(); toast('Cash entry saved'); });
}
function vCash() {
  const rows = Calc.cashLedger(S.transactions, S.dividends, S.cash), last = rows.length ? rows[rows.length - 1].balance : 0, dep = S.cash.filter((m) => m.kind === 'deposit').reduce((a, m) => a + Calc.P(m.amount), 0), wd = S.cash.filter((m) => m.kind === 'withdrawal').reduce((a, m) => a + Calc.P(m.amount), 0);
  return h('div', {}, h('div', { class: 'cards' }, card('Deposits', 'Rs. ' + fmt(dep)), card('Withdrawals', 'Rs. ' + fmt(-wd)), card('Cash balance', 'Rs. ' + fmt(last), cls(last), 'Correct only if every deposit/withdrawal is recorded')),
    h('p', { class: 'note' }, 'Purchases, sale proceeds (net of fees) and received dividends are taken from your records automatically. Add only deposits, withdrawals and adjustments here. Cash flow is not profit.'),
    h('button', { class: 'btn primary', on: { click: () => cashForm() } }, 'Add deposit / withdrawal'),
    table([{ h: 'Date', v: (r) => fmtD(r.date) }, { h: 'Type', v: (r) => r.kind }, { h: 'Symbol', v: (r) => r.symbol }, { h: 'Amount', n: 1, c: (r) => cls(r.amount), v: (r) => fmt(r.amount) }, { h: 'Balance', n: 1, v: (r) => fmt(r.balance) },
      { h: '', v: (r) => (r.manual ? h('span', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => cashForm(S.cash.find((x) => x.id === r.id)) } }, 'Edit'), h('button', { class: 'btn sm', on: { click: () => confirmDel('cash', 'cash', r.id, 'cash entry') } }, 'Delete')) : 'auto') }], rows));
}
/* ---------- CSV import (transactions) ---------- */
function parseCSV(t) { const rows = []; let r = [], f = '', q = false, first = true, cnt = { ',': 0, ';': 0, '\t': 0 }, D = ',';   // delimiter is auto-detected from the header line (comma, semicolon or tab)
  { let iq = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '"') iq = !iq; else if (!iq && (c === '\n' || c === '\r')) break; else if (!iq && c in cnt) cnt[c]++; } D = Object.keys(cnt).reduce((a, k) => (cnt[k] > cnt[a] ? k : a), ','); } const end = () => { r.push(f); f = ''; if (r.length > 1 || r[0] !== '') rows.push(r); r = []; };
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === D) { r.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; end(); } else f += c; } end(); return rows; }
/* ---------- Reports: one filter set drives summary, table, CSV and print ---------- */
const RF = { tag: '', minAmt: '', maxAmt: '', minRet: '', maxRet: '', minDiv: '', maxDiv: '', hide: [], sort: '', dir: 'asc', sector: '', report: 'transactions', start: '', end: '', symbol: '', type: '', status: '', broker: '' };
const REPORTS = { stocks: 'Stock-wise performance (lifetime)', transactions: 'Transactions (purchases & sales)', realized: 'Realized P&L', dividends: 'Dividend income', fees: 'Brokerage & charges' };
function reportData(f) {
  const inR = (d) => (!f.start || (d || '') >= f.start) && (!f.end || (d || '') <= f.end), secOf = Object.fromEntries(S.watchlist.concat(S.transactions).filter((x) => x.sector).map((x) => [x.symbol, x.sector.toLowerCase()])), sym = (s) => (!f.symbol || s === f.symbol.toUpperCase()) && (!f.sector || secOf[s] === f.sector.toLowerCase()), brk = (b) => !f.broker || (b || '') === f.broker;
  const hasTag = (r) => !f.tag || String(r.tags || '').toLowerCase().split(',').map((x) => x.trim()).includes(f.tag.toLowerCase()), P100 = (x) => (x === '' ? null : Number(x) * 100), mnA = P100(f.minAmt), mxA = P100(f.maxAmt), mnD = P100(f.minDiv), mxD = P100(f.maxDiv),
    mnR = f.minRet === '' ? null : Number(f.minRet), mxR = f.maxRet === '' ? null : Number(f.maxRet), amtOk = (v) => (mnA == null || v >= mnA) && (mxA == null || v <= mxA), txById = Object.fromEntries(S.transactions.map((t) => [t.id, t]));
  const txs = S.transactions.filter((t) => inR(t.date) && sym(t.symbol) && brk(t.broker) && (!f.type || t.type === f.type) && hasTag(t) && amtOk(Math.abs(Calc.txAmounts(t).total))).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (f.report === 'dividends') {
    const ds = S.dividends.filter((d) => inR(d.payDate) && sym(d.symbol) && brk(d.broker) && (!f.status || d.status === f.status) && hasTag(d) && amtOk(Calc.dividendAmounts(d).received)).sort((a, b) => ((a.payDate || '') < (b.payDate || '') ? -1 : 1)), t = Calc.dividendTotals(ds);
    return { cols: [['Pay date'], ['Symbol'], ['Status'], ['Shares', 'n'], ['DPS', 'n'], ['Gross', 'm'], ['Tax', 'm'], ['Net / actual', 'm']], rows: ds.map((d) => { const a = Calc.dividendAmounts(d); return [d.payDate || '', d.symbol, d.status, d.shares, d.dps, a.gross, a.tax, a.received]; }),
      sum: [['Gross received', t.gross], ['Withholding tax', t.tax], ['Net received', t.net], ['Expected / announced (not received)', t.expected]] };
  }
  if (f.report === 'realized') {
    const rr = summary().realizedRows.filter((r) => inR(r.date) && sym(r.symbol) && hasTag(txById[r.id] || {}) && amtOk(r.proceeds)).sort((a, b) => (a.date < b.date ? -1 : 1));   // cost basis uses full history; broker filter does not apply
    return { cols: [['Date'], ['Symbol'], ['Net proceeds', 'm'], ['Cost of shares sold', 'm'], ['Realized P&L', 'm']], rows: rr.map((r) => [r.date, r.symbol, r.proceeds, r.costSold, r.pl]),
      sum: [['Net proceeds', rr.reduce((a, r) => a + r.proceeds, 0)], ['Cost sold', rr.reduce((a, r) => a + r.costSold, 0)], ['Realized P&L', rr.reduce((a, r) => a + r.pl, 0)]] };
  }
  if (f.report === 'stocks') {   // whole-history view: date range does not apply
    const tagged = new Set(S.transactions.filter(hasTag).map((t) => t.symbol)), sp = Calc.stockPerformance(S.transactions, S.dividends, priceMap(), costMethod())
      .filter((r) => sym(r.symbol) && (!f.tag || tagged.has(r.symbol)) && amtOk(r.invested) && (mnR == null || (r.retPct != null && r.retPct >= mnR)) && (mxR == null || (r.retPct != null && r.retPct <= mxR)) && (mnD == null || r.divNet >= mnD) && (mxD == null || r.divNet <= mxD)), sm = (k) => sp.reduce((a, r) => a + (r[k] || 0), 0);
    return { cols: [['Symbol'], ['Invested', 'm'], ['Realized', 'm'], ['Unrealized', 'm'], ['Net dividends', 'm'], ['Total return', 'm'], ['Return %', 'n']], rows: sp.map((r) => [r.symbol, r.invested, r.realized, r.unrealized, r.divNet, r.total, r.retPct]),
      sum: [['Invested', sm('invested')], ['Realized P&L', sm('realized')], ['Unrealized (priced)', sm('unrealized')], ['Net dividends', sm('divNet')], ['Total return (priced stocks)', sm('total')]] };
  }
  const trade = txs.filter((t) => ['buy', 'sell', 'rights'].includes(t.type)), sumF = (k) => trade.reduce((a, t) => a + Calc.P(t[k]), 0);
  if (f.report === 'fees') return { cols: [['Date'], ['Symbol'], ['Type'], ['Brokerage', 'm'], ['Taxes', 'm'], ['Other', 'm'], ['Total charges', 'm']],
    rows: trade.map((t) => [t.date, t.symbol, t.type, Calc.P(t.brokerage), Calc.P(t.taxes), Calc.P(t.other), Calc.txAmounts(t).fees]), sum: [['Brokerage', sumF('brokerage')], ['Taxes', sumF('taxes')], ['Other', sumF('other')], ['Total charges', trade.reduce((a, t) => a + Calc.txAmounts(t).fees, 0)]] };
  const buys = trade.filter((t) => t.type !== 'sell'), sells = trade.filter((t) => t.type === 'sell');
  return { cols: [['Date'], ['Symbol'], ['Type'], ['Qty / ratio'], ['Price', 'n'], ['Charges', 'm'], ['Total cost / net proceeds', 'm']],
    rows: txs.map((t) => [t.date, t.symbol, t.type, t.type === 'split' || t.type === 'reverse' ? t.ratioNew + ':' + t.ratioOld : t.qty, t.price, Calc.txAmounts(t).fees, Calc.txAmounts(t).total]),
    sum: [['Total purchased (incl. charges)', buys.reduce((a, t) => a + Calc.txAmounts(t).total, 0)], ['Total sold (net of charges)', sells.reduce((a, t) => a + Calc.txAmounts(t).total, 0)], ['Rows', null]] };
}
function vPrices() {
  const rows = summary().holdings;
  const save = async () => {
    const date = $('#pr_date').value, recs = []; if (!Calc.isoD(date)) return toast('Choose a valid price date.', true);
    for (const r of rows) { const el = document.getElementById('np_' + r.symbol); if (!el || el.value.trim() === '') continue; const v = Number(el.value); if (!Number.isFinite(v) || v < 0) return toast(`Invalid price for ${r.symbol}.`, true);
      if (r.price !== v || r.priceDate !== date) recs.push({ id: r.symbol, price: v, date, source: 'Manually entered' }); }
    if (!recs.length) return toast('No changes to save.');
    try { await DB.bulk({ prices: recs }, false); await loadAll(); render(); const pm = priceMap(), old = recs.filter((x) => pm[x.id] && pm[x.id].source === 'Imported' && pm[x.id].date > x.date).map((x) => x.id); toast(`Saved ${recs.length} price(s)` + (old.length ? `. Imported history has a newer price for ${old.join(', ')}, so that stays in use.` : ''), !!old.length); } catch (e) { toast('Could not save prices; nothing was changed.', true); }
  };
  return h('div', {}, h('p', { class: 'note' }, 'Type the latest price for each holding, then press Save all prices. Boxes start with the current saved price; leave a box blank to skip it. All prices are saved together or not at all.'),
    h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, 'Price date ', h('input', { id: 'pr_date', type: 'date', value: today() })), h('button', { class: 'btn primary', on: { click: save } }, 'Save all prices')),
    table([{ h: 'Symbol', v: (r) => h('strong', {}, r.symbol) }, { h: 'Name', v: (r) => r.name || '' }, { h: 'Qty', n: 1, v: (r) => r.qty }, { h: 'Current price', n: 1, v: (r) => (r.price == null ? 'not set' : r.price) }, { h: 'As of', v: (r) => fmtD(r.priceDate) },
      { h: 'New price', v: (r) => h('input', { id: 'np_' + r.symbol, type: 'number', step: 'any', min: '0', value: r.price == null ? '' : r.price, 'aria-label': 'New price for ' + r.symbol }) }, { h: 'Value now', n: 1, v: (r) => fmt(r.value) }], rows));
}
function insightsBlock() {
  const secOf = Object.fromEntries(S.watchlist.concat(S.transactions).filter((x) => x.sector).map((x) => [x.symbol, x.sector])), I = Calc.insights(S.transactions, S.dividends, priceMap(), costMethod(), secOf), f0 = (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 });
  const c = (label, x, name, key) => card(label, x ? x[name] : '–', key === 'total' && x ? cls(x.total) : '', x ? 'Rs. ' + fmt(x[key]) : 'No data yet'), pl = (arr, nm) => arr.filter((x) => x.total != null).sort((a, b) => b.total - a.total).slice(0, 12).map((x) => ({ l: x[nm], v: x.total / 100 }));
  return h('div', {}, h('div', { class: 'cards' }, c('Most invested stock', I.topInvestStock, 'symbol', 'cost'), c('Most profitable stock', I.topProfitStock, 'symbol', 'total'), c('Biggest loss stock', I.topLossStock, 'symbol', 'total'),
      c('Most invested sector', I.topInvestSector, 'sector', 'cost'), c('Most profitable sector', I.topProfitSector, 'sector', 'total'), c('Biggest loss sector', I.topLossSector, 'sector', 'total')),
    h('p', { class: 'note' }, 'Invested = cost of what you hold now. Profit / loss = realized + unrealized + received dividends; stocks without a price are left out. Set sectors on transactions or the watchlist.'),
    h('div', { class: 'grid2' }, bars('Profit / loss by stock (Rs.)', pl(I.stocks, 'symbol'), f0), bars('Profit / loss by sector (Rs.)', pl(I.sectors, 'sector'), f0), bars('Invested by sector (Rs.)', I.sectors.filter((x) => x.cost > 0).sort((p, q) => q.cost - p.cost).map((x) => ({ l: x.sector, v: x.cost / 100 })), f0)));
}
function vReports() {
  const f = RF, raw = reportData(f), d = Calc.customizeReport(raw, f), ids = ['tag', 'minAmt', 'maxAmt', 'minRet', 'maxRet', 'minDiv', 'maxDiv', 'start', 'end', 'symbol', 'sector', 'type', 'status', 'broker'], presets = setting('presets', []);
  const inp = (k, l, t) => h('label', {}, l, h('input', { id: 'rf_' + k, type: t || 'text', value: f[k] })), read = () => { ids.forEach((k) => (RF[k] = $('#rf_' + k).value.trim())); const prev = RF.report; RF.report = $('#rf_report').value; if (RF.report !== prev) { RF.hide = []; RF.sort = ''; } else { RF.sort = $('#rf_sort').value; RF.dir = $('#rf_dir').value; RF.hide = base.filter((n, i) => !$('#cc_' + i).checked); } };
  const rep = h('select', { id: 'rf_report' }, Object.entries(REPORTS).map(([k, l]) => h('option', { value: k, ...(k === f.report ? { selected: '' } : {}) }, l)));
  const typ = h('select', { id: 'rf_type' }, ['', 'buy', 'sell', 'rights', 'bonus', 'split', 'reverse'].map((o) => h('option', { value: o, ...(o === f.type ? { selected: '' } : {}) }, o || 'all types')));
  const sta = h('select', { id: 'rf_status' }, ['', 'announced', 'expected', 'received', 'cancelled'].map((o) => h('option', { value: o, ...(o === f.status ? { selected: '' } : {}) }, o || 'all statuses')));
  const pre = h('select', { id: 'rf_preset', 'aria-label': 'Load saved filters', on: { change: (e) => { const p = presets.find((x) => x.name === e.target.value); if (p) { Object.assign(RF, p.f); render(); } } } }, h('option', { value: '' }, 'Load preset…'), presets.map((p) => h('option', { value: p.name }, p.name)));
  const per = h('select', { id: 'rf_period', on: { change: (e) => { const r = Calc.periodRange(e.target.value, today(), setting('fyStart', 7)); if (r) { $('#rf_start').value = r[0]; $('#rf_end').value = r[1]; } } } },
    [['', 'Custom dates'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['year', 'This calendar year'], ['fy', 'This financial year']].map(([v, l]) => h('option', { value: v }, l)));
  const base = raw.cols.map((c) => c[0]), custom = h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, 'Sort by ', h('select', { id: 'rf_sort' }, h('option', { value: '' }, 'default'), base.map((n) => h('option', { value: n, ...(n === f.sort ? { selected: '' } : {}) }, n)))),
    h('select', { id: 'rf_dir', 'aria-label': 'Sort direction' }, ['asc', 'desc'].map((o) => h('option', { value: o, ...(o === f.dir ? { selected: '' } : {}) }, o))), h('span', { class: 'note' }, 'Show columns:'),
    base.map((n, i) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'cc_' + i, ...(!(f.hide || []).includes(n) ? { checked: '' } : {}) }), n)));
  const active = ids.filter((k) => f[k]).map((k) => `${k}=${f[k]}`).join(', ') || 'none';
  const csvRows = [d.cols.map((c) => c[0])].concat(d.rows.map((r) => r.map((v, i) => (d.cols[i][1] === 'm' ? (v == null ? '' : v / 100) : v))));
  const printNow = () => { const t = document.title; document.title = `PSX_${f.report}_${today()}`; addEventListener('afterprint', () => (document.title = t), { once: true }); window.print(); };
  return h('div', { class: 'report' }, h('div', { class: 'noprint' },
    h('div', { class: 'filters' }, h('label', {}, 'Report', rep), h('label', {}, 'Period', per), inp('start', 'From', 'date'), inp('end', 'To', 'date'), inp('symbol', 'Stock symbol')),
    h('details', {}, h('summary', {}, 'More filters'), h('div', { class: 'filters' }, inp('sector', 'Sector'), inp('tag', 'Tag'), inp('broker', 'Broker / account'), h('label', {}, 'Transaction type', typ), h('label', {}, 'Dividend status', sta),
      inp('minAmt', 'Min amount (Rs.)', 'number'), inp('maxAmt', 'Max amount (Rs.)', 'number'), inp('minRet', 'Min total return %', 'number'), inp('maxRet', 'Max total return %', 'number'), inp('minDiv', 'Min net dividends (Rs.)', 'number'), inp('maxDiv', 'Max net dividends (Rs.)', 'number'))),
    h('details', {}, h('summary', {}, 'Columns, sorting and saved filters'), custom, h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: async () => { read(); const n = prompt('Name for this filter set'); if (!n) return; await setSetting('presets', presets.filter((p) => p.name !== n).concat({ name: n, f: { ...RF } })); render(); toast('Saved'); } } }, 'Save these filters'), pre)),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => { read(); render(); } } }, 'Show report'), h('button', { class: 'btn', on: { click: () => { Object.assign(RF, { tag: '', minAmt: '', maxAmt: '', minRet: '', maxRet: '', minDiv: '', maxDiv: '', hide: [], sort: '', dir: 'asc', sector: '', start: '', end: '', symbol: '', type: '', status: '', broker: '' }); render(); } } }, 'Clear filters'),
      h('button', { class: 'btn', on: { click: () => download(`report_${f.report}_${today()}.csv`, toCSV(csvRows), 'text/csv') } }, 'Download CSV'), h('button', { class: 'btn', on: { click: printNow } }, 'Print / Save as PDF')),
    h('p', { class: 'note' }, 'In the print window choose "Save as PDF" to keep a file. Only the report below is printed. Dividend dates use payment date; realized P&L uses your full history; return % and dividend filters apply to Stock-wise performance.')),
    h('h3', { class: 'printonly' }, REPORTS[f.report]), h('p', { class: 'printonly' }, `Period: ${f.start || 'start'} to ${f.end || 'latest'} · Filters: ${active} · Generated ${fmtD(today())}`),
    h('div', { class: 'cards' }, d.sum.map(([l, v]) => card(l, v == null ? String(d.rows.length) : 'Rs. ' + fmt(v), v ? cls(v) : ''))),
    table(d.cols.map((c, i) => ({ h: c[0], n: c[1] === 'm' || c[1] === 'n', v: (r) => (c[1] === 'm' ? fmt(r[i]) : /^\d{4}-\d{2}-\d{2}$/.test(r[i]) ? fmtD(r[i]) : r[i]) })), d.rows));
}
function wlForm(w) {
  openForm(w ? 'Edit watchlist entry' : 'Add to watchlist', [{ k: 'symbol', label: 'Symbol', req: 1 }, { k: 'name', label: 'Company name' }, { k: 'sector', label: 'Sector' }, num('target', 'Target price (Rs.)'), num('alert', 'Alert price: flag when last price is at or above'), { k: 'notes', label: 'Notes' }], w || {}, async (v) => {
    if (!v.symbol || !Calc.okSym(v.symbol)) throw new Error('Symbol is required (1-20 characters, no spaces).'); if (v.target !== '' && !(v.target > 0)) throw new Error('Target price must be above zero.'); if (v.alert !== '' && !(v.alert > 0)) throw new Error('Alert price must be above zero.');
    if ((!w || w.id !== v.symbol) && S.watchlist.some((x) => x.id === v.symbol)) throw new Error(v.symbol + ' is already on the watchlist. Edit that entry instead.');
    const rec = { ...(w || {}), ...v, id: v.symbol }; if (w && w.id !== rec.id) await DB.del('watchlist', w.id);
    await DB.put('watchlist', rec); await log(w ? 'edit' : 'add', 'watchlist', w, rec); S.watchlist = S.watchlist.filter((x) => x.id !== rec.id && (!w || x.id !== w.id)).concat(rec); render(); toast('Watchlist saved'); });
}
async function importPriceCSV(file) {
  if (file.size > 5e6) return toast('CSV too large (5 MB limit).', true);
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, '')); if (rows.length < 2 || rows.length > 20001) return toast('Need 1 to 20,000 data rows.', true);
  const hd = rows[0].map((x) => x.trim().toLowerCase()), ix = ['symbol', 'date', 'price'].map((n) => hd.indexOf(n)); if (ix.some((i) => i < 0)) return toast('Headers must include symbol, date, price. Use the template.', true);
  const have = Object.fromEntries(S.pricehist.map((p) => [p.id, p.price])), seen = {}, recs = [], errs = []; let upd = 0;
  rows.slice(1).forEach((r, i) => { const sym = (r[ix[0]] || '').trim().toUpperCase(), date = (r[ix[1]] || '').trim(), pr = (r[ix[2]] || '').trim(), price = Number(Calc.unc(pr)), id = sym + '|' + date;
    if (!sym || !Calc.isoD(date) || pr === '' || !Number.isFinite(price) || price < 0) return errs.push(`Row ${i + 2}: invalid symbol, date (YYYY-MM-DD) or price`);
    if (id in seen && seen[id] !== price) return errs.push(`Row ${i + 2}: ${sym} on ${date} appears twice with different prices`); if (id in seen) return; seen[id] = price;
    if (id in have && have[id] !== price) upd++; if (!(id in have) || have[id] !== price) recs.push({ id, symbol: sym, date, price, source: 'Imported' }); });
  const dlg = $('#dlg'); dlg.replaceChildren(h('h2', {}, 'Price import preview'), h('p', {}, `${recs.length - upd} new price(s), ${upd} will overwrite an existing imported price, ${Object.keys(seen).length - recs.length} unchanged, ${errs.length} problem(s).`),
    errs.length ? h('div', {}, h('p', { class: 'err' }, 'Nothing is imported until these are fixed:'), h('ul', {}, errs.slice(0, 10).map((x) => h('li', {}, x)))) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'), h('button', { class: 'btn primary', ...(errs.length || !recs.length ? { disabled: '' } : {}), on: { click: async () => { try { await DB.bulk({ pricehist: recs }, false); await loadAll(); await logBulk('import', recs.length + ' prices (CSV)'); dlg.close(); render(); toast(`Imported ${recs.length} prices`); } catch (e) { toast('Import failed; nothing was changed.', true); } } } }, 'Import ' + recs.length + ' prices')));
  dlg.showModal();
}
function vWatch() {
  const pm = priceMap(), q = S.q.toLowerCase(), rows = S.watchlist.filter((w) => (w.symbol + (w.name || '')).toLowerCase().includes(q)).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  return h('div', {}, h('p', { class: 'note' }, 'Prices here are entered or imported by you; none are live. Price history CSV headers: symbol, date (YYYY-MM-DD), price.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => wlForm() } }, 'Add to watchlist'), h('label', { class: 'btn' }, 'Import price history CSV…', h('input', { type: 'file', accept: '.csv,text/csv', on: { change: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importPriceCSV(f); } } })),
      h('button', { class: 'btn', on: { click: () => download('price_history_template.csv', toCSV([['symbol', 'date', 'price'], ['ABC', '2026-01-30', '55.25']]), 'text/csv') } }, 'Download template')),
    table([{ h: 'Symbol', v: (r) => h('strong', {}, r.symbol) }, { h: 'Name', v: (r) => r.name || '' }, { h: 'Sector', v: (r) => r.sector || '' },
      { h: 'Last price', n: 1, v: (r) => (pm[r.symbol] ? `${pm[r.symbol].price} (${pm[r.symbol].source || 'Manually entered'}, ${fmtD(pm[r.symbol].date)})` : 'not set') }, { h: 'Target', n: 1, v: (r) => r.target || '–' },
      { h: 'To target', n: 1, v: (r) => (pm[r.symbol] && pm[r.symbol].price > 0 && r.target ? pct(((r.target - pm[r.symbol].price) / pm[r.symbol].price) * 100) : '–') }, { h: 'Alert', v: (r) => (r.alert && pm[r.symbol] && pm[r.symbol].price >= r.alert ? 'At/above alert price' : '') },
      { h: '', v: (r) => h('span', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => priceForm(r.symbol) } }, 'Set price'), h('button', { class: 'btn sm', on: { click: () => wlForm(r) } }, 'Edit'), h('button', { class: 'btn sm', on: { click: () => confirmDel('watchlist', 'watchlist', r.id, 'watchlist entry') } }, 'Delete')) }], rows));
}
/* ---------- Generic CSV import with column mapping (transactions, dividends, cash ledger) ---------- */
async function startImport(kind, file) {
  if (file.size > 5e6) return toast('CSV too large (5 MB limit).', true);
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, '')); if (rows.length < 2) return toast('CSV has no data rows.', true); if (rows.length > 5001) return toast('Limit is 5000 rows per import.', true);
  const spec = Calc.IMPORTS[kind], hd = rows[0].map((x) => x.trim()), dlg = $('#dlg'), err = h('p', { class: 'err', role: 'alert' });
  const sels = spec.fields.map(([k, req]) => h('label', {}, k + (req ? ' (required)' : ''), h('select', { id: 'map_' + k }, h('option', { value: '' }, '— not in file —'), hd.map((x, i) => h('option', { value: String(i), ...(x.toLowerCase() === k.toLowerCase() ? { selected: '' } : {}) }, x || '(blank header)')))));
  dlg.replaceChildren(h('h2', {}, 'Map columns: ' + spec.label), h('p', { class: 'note' }, `${rows.length - 1} data row(s) found. Match each field to a column of your file (matching names are pre-selected). Dates must be YYYY-MM-DD.`), ...sels, ...(spec.needsDate ? [h('label', {}, 'Opening balance date (holdings are added as buy transactions on this date; import once)', h('input', { id: 'imp_date', type: 'date', value: today() }))] : []), err,
    h('div', { class: 'row' }, h('button', { class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'), h('button', { class: 'btn primary', on: { click: () => { const map = {};
      spec.fields.forEach(([k]) => { const v = document.getElementById('map_' + k).value; if (v !== '') map[k] = +v; }); const miss = spec.fields.filter(([k, req]) => req && map[k] == null).map(([k]) => k);
      if (miss.length) { err.textContent = 'Please map: ' + miss.join(', '); return; } previewImport(kind, rows, map, { date: $('#imp_date') ? $('#imp_date').value : '' }); } } }, 'Preview import')));
  if (!dlg.open) dlg.showModal();
}
async function previewImport(kind, rows, map, ctx) {
  const spec = Calc.IMPORTS[kind], dlg = $('#dlg'), seen = new Set(S[spec.store].map(spec.key)), good = [], errs = [], dups = [], ctx2 = { ...ctx, txs: S.transactions, cache: {} };
  rows.slice(1).forEach((r, i) => { const g = (k) => (map[k] == null ? '' : (r[map[k]] || '').trim()), rec = spec.build(g, i, uid, ctx2); if (!rec) return errs.push(`Row ${i + 2}: invalid or missing value${kind === 'dividendSheet' ? ' (check the date, or that you held the stock on that date)' : ''}`);
    const key = spec.key(rec); if (seen.has(key)) return dups.push(i + 2); seen.add(key); good.push(rec); });
  if (!errs.length && good.length && kind === 'transactions') { const pe = Calc.computePortfolio(S.transactions.concat(good)).errors; if (pe.length) errs.push('Imported rows would create a negative holding: ' + pe[0]); }
  dlg.replaceChildren(h('h2', {}, 'Import preview: ' + spec.label), h('p', {}, `${good.length} new row(s) ready, ${dups.length} duplicate row(s) will be skipped${dups.length ? ' (rows ' + dups.slice(0, 10).join(', ') + ')' : ''}, ${errs.length} problem(s).`),
    errs.length ? h('div', {}, h('p', { class: 'err' }, 'Nothing is imported until these are fixed in the file:'), h('ul', {}, errs.slice(0, 10).map((x) => h('li', {}, x)))) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'), h('button', { class: 'btn primary', ...(errs.length || !good.length ? { disabled: '' } : {}), on: { click: async () => {
      try { const ex = spec.extra ? spec.extra(good) : {}; if (ex.prices) { const pm = priceMap(); ex.prices = ex.prices.filter((x) => !pm[x.id] || pm[x.id].date < x.date); }   // never replace a newer price with an older opening rate
      await DB.bulk({ [spec.store]: spec.clean ? good.map(spec.clean) : good, ...ex }, false); await loadAll(); await logBulk('import', `${good.length} ${spec.store} (CSV)`); dlg.close(); render(); toast(`Imported ${good.length} rows`); } catch (e) { toast('Import failed; nothing was changed.', true); } } } }, 'Import ' + good.length + ' rows')));
  if (!dlg.open) dlg.showModal();
}
/* ---------- Autosave to a folder (File System Access API: Chrome/Edge on desktop) ---------- */
const FS = { ok: 'showDirectoryPicker' in window, dir: null, state: 'off', last: null, err: '', t: 0 };
async function initAutosave() { if (!FS.ok) return; try { const d = await DB.getHandle(); if (d) { FS.dir = d; FS.state = (await d.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'on' : 'ask'; } } catch (e) { /* no saved folder */ } }
async function chooseFolder() { try { const d = await showDirectoryPicker({ mode: 'readwrite' }); await DB.setHandle(d); FS.dir = d; FS.state = 'on'; await writeAutosave(); render(); toast('Autosave folder set'); } catch (e) { if (e.name !== 'AbortError') toast('Could not use that folder: ' + (e.message || e.name), true); } }
async function resumeAutosave() { try { if ((await FS.dir.requestPermission({ mode: 'readwrite' })) === 'granted') { FS.state = 'on'; await writeAutosave(); render(); } } catch (e) { toast('Permission was not granted.', true); } }
async function writeAutosave() {
  if (FS.state !== 'on') return;
  try { const json = JSON.stringify(buildBackup(), null, 2);   // latest file + one file per day
    for (const n of ['PSX_Portfolio_Autosave.json', `PSX_Portfolio_Backup_${today()}.json`]) { const w = await (await FS.dir.getFileHandle(n, { create: true })).createWritable(); await w.write(json); await w.close(); }
    FS.last = new Date(); FS.err = ''; } catch (e) { FS.state = 'ask'; FS.err = 'Could not write to the folder: ' + (e.message || e.name); }
  refreshAutosave();
}
const scheduleAutosave = () => { if (FS.state === 'on') { clearTimeout(FS.t); FS.t = setTimeout(writeAutosave, 1500); } };
function refreshAutosave() { const b = $('#asv'); if (!b) return; b.hidden = !FS.dir; b.textContent = FS.state === 'on' ? 'Autosave on' + (FS.last ? ' · ' + FS.last.toLocaleTimeString() : '') : 'Resume autosave'; b.className = 'btn sm' + (FS.state === 'on' ? '' : ' warn'); }
function autosaveCard() {
  const st = FS.state;
  return h('div', { class: 'card' }, h('strong', {}, 'Autosave to a folder'),
    h('small', {}, !FS.ok ? 'Not supported in this browser. Use Chrome or Edge on a Windows PC. On Android, use "Export full backup" instead.' : st === 'on' ? `On. Every change is saved to "${FS.dir.name}" about 2 seconds later (a latest file plus one file per day).${FS.last ? ' Last saved ' + FS.last.toLocaleTimeString() + '.' : ''}` : st === 'ask' ? `Folder "${FS.dir.name}" needs your permission again (browsers ask after a restart). Press Resume.` : 'Off. Choose a folder, for example inside OneDrive or Google Drive, and autosave starts.'),
    FS.err ? h('small', { class: 'err' }, FS.err) : null,
    h('div', { class: 'row wrap' }, FS.ok ? h('button', { class: 'btn primary', on: { click: chooseFolder } }, FS.dir ? 'Change folder' : 'Choose folder') : null, st === 'ask' ? h('button', { class: 'btn', on: { click: resumeAutosave } }, 'Resume') : null,
      st === 'on' ? h('button', { class: 'btn', on: { click: async () => { await writeAutosave(); render(); toast('Saved to folder'); } } }, 'Save now') : null));
}
/* ---------- Charts tab: pick a dataset, see an interactive donut or bars ---------- */
const PAL = (i) => `hsl(${(i * 53 + 210) % 360} 62% ${i % 2 ? 44 : 54}%)`;
function donut(title, items, fmtv) {
  const tot = items.reduce((a, i) => a + i.v, 0);
  if (!(tot > 0)) return h('div', { class: 'chart' }, h('h3', {}, title), h('p', { class: 'empty' }, 'No data yet.'));
  const ns = 'http://www.w3.org/2000/svg', mk = (t, at, txt) => { const e = document.createElementNS(ns, t); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); if (txt != null) e.textContent = txt; return e; };
  const svg = mk('svg', { viewBox: '0 0 220 220', class: 'donut', role: 'img', 'aria-label': title }), c1 = mk('text', { x: 110, y: 104, 'text-anchor': 'middle', class: 'dc1' }, 'Total'), c2 = mk('text', { x: 110, y: 124, 'text-anchor': 'middle', class: 'dc2' }, fmtv(tot)), paths = [], legend = h('ul', { class: 'legend' });
  const show = (i) => { paths.forEach((p, j) => p.setAttribute('class', 'slice' + (j === i ? ' on' : ''))); c1.textContent = i == null ? 'Total' : items[i].l; c2.textContent = i == null ? fmtv(tot) : `${fmtv(items[i].v)} · ${((items[i].v / tot) * 100).toFixed(1)}%`; };
  let a0 = -Math.PI / 2; const R = 96, r = 58, P = (rad, a) => [110 + rad * Math.cos(a), 110 + rad * Math.sin(a)];
  items.forEach((it, i) => { const f = Math.min(it.v / tot, 0.99999), a1 = a0 + f * 2 * Math.PI, big = f > 0.5 ? 1 : 0, [x0, y0] = P(R, a0), [x1, y1] = P(R, a1), [x2, y2] = P(r, a1), [x3, y3] = P(r, a0);
    const p = mk('path', { d: `M${x0} ${y0}A${R} ${R} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${big} 0 ${x3} ${y3}Z`, fill: PAL(i), class: 'slice', tabindex: '0' });
    p.append(mk('title', {}, `${it.l}: ${fmtv(it.v)} (${((it.v / tot) * 100).toFixed(1)}%)`)); ['mouseenter', 'focus', 'click'].forEach((ev) => p.addEventListener(ev, () => show(i))); p.addEventListener('mouseleave', () => show(null));
    paths.push(p); svg.append(p); a0 = a1;
    legend.append(h('li', { on: { mouseenter: () => show(i), mouseleave: () => show(null) } }, h('span', { class: 'sw', style: `background:${PAL(i)}` }), `${it.l}: ${fmtv(it.v)} (${((it.v / tot) * 100).toFixed(1)}%)`)); });
  svg.append(c1, c2); return h('div', { class: 'chart' }, h('h3', {}, title), h('div', { class: 'donutwrap' }, svg, legend));
}
function vCharts() {
  const s = summary(), secOf = Object.fromEntries(S.watchlist.concat(S.transactions).filter((x) => x.sector).map((x) => [x.symbol, x.sector])), I = Calc.insights(S.transactions, S.dividends, priceMap(), costMethod(), secOf), d = Calc.dividendTotals(S.dividends), b = Calc.dividendBreakdown(S.dividends);
  const f0 = (v) => v.toLocaleString('en-PK', { maximumFractionDigits: 0 }), R = (x) => x / 100;
  const DS = { hcost: ['My holdings by cost', s.holdings.map((x) => ({ l: x.symbol, v: R(x.cost) }))], hval: ['My holdings by market value (priced only)', s.holdings.filter((x) => x.value != null).map((x) => ({ l: x.symbol, v: R(x.value) }))],
    sector: ['Sectors by cost', I.sectors.filter((x) => x.cost > 0).map((x) => ({ l: x.sector, v: R(x.cost) }))], plstock: ['Profit / loss by stock', I.stocks.filter((x) => x.total != null).map((x) => ({ l: x.symbol, v: R(x.total) })), 1],
    plsector: ['Profit / loss by sector', I.sectors.filter((x) => x.total != null).map((x) => ({ l: x.sector, v: R(x.total) })), 1], dstock: ['Dividends received by stock', Object.entries(d.bySymbol).map(([l, v]) => ({ l, v: R(v) }))],
    dyear: ['Dividends received by year', Object.entries(b.byYear).sort().map(([l, v]) => ({ l, v: R(v.net) }))], dmonth: ['Dividends received by month (last 24)', Object.entries(d.byMonth).sort().slice(-24).map(([l, v]) => ({ l, v: R(v) }))] };
  const sel = DS[S.chartSel] ? S.chartSel : 'hcost', [title, raw, signed] = DS[sel], asBars = signed || S.chartType === 'bar', items = [...raw].sort((x, y) => y.v - x.v);
  const pick = (id, opts, cur, key) => h('select', { id, on: { change: (e) => { S[key] = e.target.value; render(); } } }, opts.map(([v, l]) => h('option', { value: v, ...(v === cur ? { selected: '' } : {}) }, l)));
  return h('div', {}, h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, 'Show ', pick('ch_sel', Object.entries(DS).map(([k, v]) => [k, v[0]]), sel, 'chartSel')),
    signed ? null : h('label', { class: 'inline' }, 'As ', pick('ch_type', [['donut', 'Donut'], ['bar', 'Bars']], S.chartType || 'donut', 'chartType'))),
    h('p', { class: 'note' }, 'Hover or tap a slice or bar for its value. Profit / loss = realized + unrealized + received dividends; stocks without a price are left out.'), asBars ? bars(title + ' (Rs.)', items, f0) : donut(title + ' (Rs.)', items.filter((x) => x.v > 0), f0));
}
const NAV = ['dashboard', 'holdings', 'prices', 'transactions', 'dividends', 'charts', 'reports', 'cash', 'watchlist', 'data', 'settings'];
const VIEWS = { charts: ['Charts', vCharts], prices: ['Prices', vPrices], audit: ['Audit & Undo', vAudit], watchlist: ['Watchlist', vWatch], reports: ['Reports', vReports], cash: ['Cash', vCash], dashboard: ['Dashboard', vDashboard], holdings: ['Holdings', vHoldings], transactions: ['Transactions', vTx], dividends: ['Dividends', vDiv], data: ['Backup & Import', vData], settings: ['Settings', vSettings] };
function render() {
  refreshUndo(); refreshAutosave(); const [t, f] = VIEWS[S.view]; $('#title').textContent = t;
  try { $('#main').replaceChildren(f()); } catch (e) { console.error(e); $('#main').replaceChildren(h('p', { class: 'err', role: 'alert' }, 'This page could not be shown because some saved data looks invalid (' + (e && e.message) + '). Your data is untouched. Open Backup & Import to export a backup, or switch pages.')); }
  document.querySelectorAll('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === S.view ? 'page' : 'false'));
}
const applyTheme = () => (document.documentElement.dataset.theme = setting('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
async function loadAll() { for (const k of ['transactions', 'dividends', 'prices', 'settings', 'cash', 'watchlist', 'pricehist', 'audit', 'brokers']) S[k] = await DB.all(k); S.audit.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)); applyTheme(); }

(async function init() {
  $('#nav').append(...NAV.map((k) => [k, VIEWS[k]]).map(([k, [l]]) => h('button', { 'data-v': k, on: { click: () => { S.view = k; S.q = ''; $('#q').value = ''; $('#side').classList.remove('open'); render(); } } }, l)));
  $('#undo').onclick = undoLast; $('#asv').onclick = () => (FS.state === 'ask' ? resumeAutosave() : ((S.view = 'data'), render())); $('#menu').onclick = () => $('#side').classList.toggle('open'); $('#q').oninput = (e) => { S.q = e.target.value; render(); };
  const net = () => { $('#net').textContent = navigator.onLine ? 'Online' : 'Offline (stored data only; no live prices)'; }; addEventListener('online', net); addEventListener('offline', net); net();
  DB.onStatus((st, why) => { if (st === 'saved') scheduleAutosave(); const el = $('#save'); el.className = st; el.textContent = st === 'saving' ? 'Saving…' : st === 'saved' ? 'Saved ' + new Date().toLocaleTimeString() : 'Save error' + (why ? ': ' + why : ''); });
  try { await DB.open(); await loadAll(); await initAutosave(); if (navigator.storage && navigator.storage.persist) S.persisted = await navigator.storage.persist(); }
  catch (e) { $('#main').textContent = 'Storage is unavailable in this browser (private mode?). Data cannot be saved.'; return; }
  let rt = 0; DB.onRemote(() => { clearTimeout(rt); rt = setTimeout(async () => { try { await loadAll(); render(); } catch (e) { /* ignore */ } }, 300); });
  const lb = setting('lastBackup'); if ((S.transactions.length || S.dividends.length) && (!lb || Date.now() - Date.parse(lb) > 30 * 864e5)) toast('Backup reminder: export a full backup from Import / Export.', true);
  render(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
})();
