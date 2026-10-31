/* Pure financial engine. Amounts are PKR numbers in records; all math is done in integer paisa. */
(function (root) {
  const P = (x) => { const v = Number(x) || 0; return Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7); };   // nearest paisa, half away from zero; the 1e-7 cancels binary error (1.005*100 = 100.4999...)
  const sortTx = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));

  const isBuy = (t) => t.type === 'buy' || t.type === 'rights', isTrade = (t) => isBuy(t) || t.type === 'sell';   // rights issue = purchase at the subscription price
  // Buy total = gross + fees. Sell net = gross - fees.
  function txAmounts(t) {
    const gross = Math.round(Number(t.qty) * P(t.price));
    const fees = P(t.brokerage) + P(t.taxes) + P(t.other);
    return { gross, fees, total: isBuy(t) ? gross + fees : gross - fees };
  }

  // Same-day entries keep the order they were typed. If a sale would exceed holdings only because a same-day purchase/bonus of that
  // stock was typed AFTER it, that purchase is brought forward (an intraday buy-then-sell is valid). Pure; returns a new array.
  function sameDayOrder(arr) {
    const q = {}, out = [...arr];
    for (let i = 0; i < out.length; i++) {
      const t = out[i], have = q[t.symbol] || 0;
      if (t.type === 'sell' && Number(t.qty) > have) {
        let need = Number(t.qty) - have;
        for (let j = i + 1; j < out.length && out[j].date === t.date && need > 0; j++) {
          const u = out[j]; if (u.symbol === t.symbol && (isBuy(u) || u.type === 'bonus')) { out.splice(j, 1); out.splice(i, 0, u); need -= Number(u.qty); q[u.symbol] = (q[u.symbol] || 0) + Number(u.qty); i++; }
        }
      }
      const c = out[i]; q[c.symbol] = (q[c.symbol] || 0) + (c.type === 'sell' ? -Number(c.qty) : (c.type === 'split' || c.type === 'reverse') ? (q[c.symbol] || 0) * Number(c.ratioNew) / Number(c.ratioOld) - (q[c.symbol] || 0) : (isBuy(c) || c.type === 'bonus') ? Number(c.qty) : 0);
    }
    return out;
  }
  // Weighted-average cost. Returns positions, realized rows and errors.
  function computePortfolio(txs, method) {
    const fifo = method === 'fifo';
    const pos = {}, errors = [], realizedRows = [];
    sameDayOrder([...txs].sort(sortTx)).forEach((t) => {
      const s = t.symbol, a = txAmounts(t);
      const p = pos[s] || (pos[s] = { symbol: s, name: t.name, sector: t.sector || '', qty: 0, cost: 0, realized: 0, fees: 0, lots: [] });
      if (t.name) p.name = t.name; if (t.sector) p.sector = t.sector;
      if (t.type === 'bonus') { p.qty += Number(t.qty); p.lots.push({ qty: Number(t.qty), cost: 0 }); return; }   // FIFO: bonus shares form a zero-cost lot (documented assumption)   // bonus shares: quantity up, total cost unchanged (assumption: no cost, no tax treatment applied)
      if (t.type === 'split' || t.type === 'reverse') {            // ratio = new shares per old shares; total cost unchanged
        const nq = (p.qty * Number(t.ratioNew)) / Number(t.ratioOld);
        if (!(nq >= 0) || Math.abs(nq - Math.round(nq)) > 1e-9) errors.push(`${s}: ${t.type} on ${t.date} gives fractional shares (${nq}); record the cash-in-lieu separately`); else { p.lots.forEach((l) => (l.qty = (l.qty * Number(t.ratioNew)) / Number(t.ratioOld))); p.qty = Math.round(nq); }
        return; }
      if (isBuy(t)) { p.qty += Number(t.qty); p.cost += a.total; p.fees += a.fees; p.lots.push({ qty: Number(t.qty), cost: a.total }); }
      else {
        const q = Number(t.qty);
        if (q > p.qty) { errors.push(`${s}: sale of ${q} on ${t.date} exceeds ${p.qty} held`); return; }
        let sold;
        if (fifo) {   // consume oldest lots first; a fully consumed lot releases its exact remaining cost
          sold = 0; let need = q;
          while (need > 1e-9 && p.lots.length) { const l = p.lots[0], take = Math.min(l.qty, need), cst = take >= l.qty - 1e-9 ? l.cost : Math.round((l.cost * take) / l.qty);
            sold += cst; l.cost -= cst; l.qty -= take; need -= take; if (l.qty <= 1e-9) p.lots.shift(); }
        } else sold = q === p.qty ? p.cost : Math.round((p.cost * q) / p.qty);
        const pl = a.total - sold;
        p.qty -= q; p.cost -= sold; p.realized += pl; p.fees += a.fees;
        realizedRows.push({ id: t.id, date: t.date, symbol: s, proceeds: a.total, costSold: sold, pl });
      }
    });
    return { positions: Object.values(pos), realizedRows, errors };
  }

  // Gross = shares x DPS; Net = gross - tax - other. Rounded to the paisa.
  function dividendAmounts(d) {
    const gross = Math.round(Number(d.shares) * P(d.dps));
    const tax = Math.round((gross * (Number(d.taxRate) || 0)) / 100);
    const net = gross - tax - P(d.other);
    const hasActual = d.actual !== '' && d.actual != null;
    return { gross, tax, other: P(d.other), net, received: hasActual ? P(d.actual) : net, isActual: hasActual };
  }

  // Only status "received" counts as income; announced/expected are tracked separately.
  function dividendTotals(divs) {
    const r = { gross: 0, tax: 0, net: 0, expected: 0, bySymbol: {}, byMonth: {} };
    divs.forEach((d) => {
      const a = dividendAmounts(d);
      if (d.status === 'received') {
        r.gross += a.gross; r.tax += a.tax; r.net += a.received;
        r.bySymbol[d.symbol] = (r.bySymbol[d.symbol] || 0) + a.received;
        const m = (d.payDate || '').slice(0, 7); if (m) r.byMonth[m] = (r.byMonth[m] || 0) + a.received;
      } else if (d.status === 'announced' || d.status === 'expected') r.expected += a.net;
    });
    return r;
  }

  // Valuation uses manually entered prices only. Unpriced positions are excluded from value AND from the cost used for unrealized P&L.
  function summarize(txs, divs, prices, method) {
    const pf = computePortfolio(txs, method), dt = dividendTotals(divs);
    let cost = 0, value = 0, pricedCost = 0, realized = 0, fees = 0;
    const holdings = pf.positions.filter((p) => p.qty > 0).map((p) => {
      const pr = prices[p.symbol], mv = pr ? Math.round(p.qty * P(pr.price)) : null;
      cost += p.cost; if (mv != null) { value += mv; pricedCost += p.cost; }
      return { ...p, avg: p.cost / p.qty / 100, price: pr ? pr.price : null, priceDate: pr ? pr.date : '', value: mv,
        unrealized: mv != null ? mv - p.cost : null, retPct: mv != null && p.cost ? ((mv - p.cost) / p.cost) * 100 : null, divNet: dt.bySymbol[p.symbol] || 0 };
    });
    pf.positions.forEach((p) => { realized += p.realized; fees += p.fees; });
    const unrealized = value - pricedCost;
    const closed = pf.positions.filter((p) => p.qty === 0).map((p) => ({ symbol: p.symbol, name: p.name, sector: p.sector, qty: 0, avg: null, cost: 0, price: null, value: null, unrealized: null, retPct: null, realized: p.realized, divNet: dt.bySymbol[p.symbol] || 0, closed: true }));
    return { closed, holdings, cost, value, unrealized, unpriced: holdings.filter((h) => h.price == null).length, realized, fees, div: dt,
      totalReturn: realized + unrealized + dt.net, errors: pf.errors, realizedRows: pf.realizedRows };
  }

  // Cash ledger: trades and received dividends are DERIVED (never stored twice); only manual entries are stored.
  // Fees are already inside purchase totals / net sale proceeds, so they are not listed again.
  function cashLedger(txs, divs, manual) {
    const rows = [];
    txs.forEach((t) => { if (isTrade(t)) { const a = txAmounts(t); rows.push({ date: t.date, kind: t.type === 'rights' ? 'Rights subscription' : isBuy(t) ? 'Purchase' : 'Sale proceeds', symbol: t.symbol, amount: isBuy(t) ? -a.total : a.total }); } });
    divs.forEach((d) => { if (d.status === 'received' && d.payDate) rows.push({ date: d.payDate, kind: 'Dividend received', symbol: d.symbol, amount: dividendAmounts(d).received }); });
    manual.forEach((m) => rows.push({ id: m.id, manual: 1, date: m.date, kind: m.kind, symbol: '', amount: P(m.amount), notes: m.notes }));
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let bal = 0; rows.forEach((r) => { bal += r.amount; r.balance = bal; });
    return rows;
  }
  // XIRR: annual rate r where sum(amount / (1+r)^(days/365)) = 0. Bisection (robust; no divergence). Returns null if no sign change.
  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  function xirr(flows) {
    if (flows.length < 2) return null; const d0 = Math.min(...flows.map((f) => dayNum(f.date)));
    const npv = (r) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, (dayNum(f.date) - d0) / 365), 0);
    let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi); if (!(flo * fhi < 0)) return null;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = npv(mid); if (fm * flo > 0) { lo = mid; flo = fm; } else hi = mid; }
    return (lo + hi) / 2;
  }
  // Investment-only flows: purchases out, net sale proceeds and RECEIVED dividends in, plus current market value as the final inflow.
  // Deposits/withdrawals are ignored (funding is not performance). Refuses if any holding has no price.
  function portfolioXirr(txs, divs, prices) {
    const flows = [];
    txs.forEach((t) => { if (isTrade(t)) flows.push({ date: t.date, amount: isBuy(t) ? -txAmounts(t).total : txAmounts(t).total }); });
    divs.forEach((d) => { if (d.status === 'received' && d.payDate) flows.push({ date: d.payDate, amount: dividendAmounts(d).received }); });
    if (!flows.some((f) => f.amount < 0)) return { rate: null, reason: 'Needs at least one purchase' };
    const s = summarize(txs, divs, prices); let end = flows.reduce((m, f) => (f.date > m ? f.date : m), '');
    if (s.holdings.length) {
      if (s.unpriced) return { rate: null, reason: 'Set a price for every holding to value the portfolio' };
      const pd = s.holdings.map((h) => h.priceDate).filter(Boolean).sort().pop(); if (pd && pd > end) end = pd; flows.push({ date: end, amount: s.value });
    }
    const first = flows.reduce((m, f) => (f.date < m ? f.date : m), '9999'), days = dayNum(end) - dayNum(first);
    if (days < 1) return { rate: null, reason: 'Needs at least one day between first purchase and valuation' };
    const rate = xirr(flows); return rate == null ? { rate: null, reason: 'No solvable rate for these cash flows' } : { rate, days };
  }
  // Month-end market value from IMPORTED price history only. A month is skipped (never estimated) if any held symbol has no price on or before that date.
  function valueSeries(txs, hist, today, method) {
    if (!txs.length) return { points: [], skipped: 0 };
    const by = {}; hist.forEach((h) => (by[h.symbol] || (by[h.symbol] = [])).push(h)); Object.values(by).forEach((a) => a.sort((x, y) => (x.date < y.date ? -1 : 1)));
    const first = txs.map((t) => t.date).sort()[0]; let y = +first.slice(0, 4), m = +first.slice(5, 7) - 1; const points = []; let skipped = 0;
    for (let i = 0; i < 360; i++) {
      const d = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10), end = d > today ? today : d;
      let cost = 0, val = 0, ok = true;
      computePortfolio(txs.filter((t) => t.date <= end), method).positions.forEach((p) => { if (p.qty > 0) { cost += p.cost; const a = by[p.symbol] || []; let px = null;
        for (let j = a.length - 1; j >= 0; j--) if (a[j].date <= end) { px = a[j].price; break; } if (px == null) ok = false; else val += Math.round(p.qty * P(px)); } });
      if (ok) points.push({ month: end.slice(0, 7), end, cost, value: val }); else skipped++;
      if (end >= today) break; if (++m > 11) { m = 0; y++; }
    }
    return { points, skipped };
  }
  // Period shortcuts -> [start, end] ISO dates. fy = first month (1-12) of the financial year (Pakistan default July).
  function periodRange(p, now, fy) {
    const y = +now.slice(0, 4), m = +now.slice(5, 7) - 1, U = Date.UTC, iso = (d) => new Date(d).toISOString().slice(0, 10), q = Math.floor(m / 3) * 3, sy = m + 1 >= fy ? y : y - 1;
    return { month: [iso(U(y, m, 1)), iso(U(y, m + 1, 0))], lastmonth: [iso(U(y, m - 1, 1)), iso(U(y, m, 0))], quarter: [iso(U(y, q, 1)), iso(U(y, q + 3, 0))],
      year: [y + '-01-01', y + '-12-31'], fy: [iso(U(sy, fy - 1, 1)), iso(U(sy + 1, fy - 1, 0))] }[p] || null;
  }
  // Undo plan for one audit entry against the current list of that record type (pure; caller validates and persists).
  function planUndo(e, list) {
    const rest = list.filter((x) => x.id !== e.recId && !(e.after && x.id === e.after.id));
    if (e.action === 'add') return { next: rest, del: e.recId, put: null };
    return { next: rest.concat(e.before), del: e.after && e.after.id !== e.before.id ? e.after.id : null, put: e.before };
  }
  // Per-broker totals from the free-text broker field on records ("(none)" when blank). Dividends: received only.
  function brokerSummary(txs, divs) {
    const m = {}, g = (b) => m[b || '(none)'] || (m[b || '(none)'] = { broker: b || '(none)', trades: 0, bought: 0, sold: 0, fees: 0, divNet: 0 });
    txs.forEach((t) => { if (isTrade(t)) { const r = g(t.broker), a = txAmounts(t); r.trades++; r.fees += a.fees; if (isBuy(t)) r.bought += a.total; else r.sold += a.total; } });
    divs.forEach((d) => { if (d.status === 'received') g(d.broker).divNet += dividendAmounts(d).received; });
    return Object.values(m).sort((a, b) => (a.broker < b.broker ? -1 : 1));
  }
  // CSV import specs: field list (name, required), duplicate key, and a pure row builder (null = invalid row). Used with the column-mapping screen.
  const isoD = (x) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return +m[1] >= 1950 && +m[1] <= 2100 && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; },
    LIM = { qty: 1e8, price: 1e5, money: 1e10, shares: 1e8 }, okSym = (x) => /^\S{1,20}$/.test(x),   // limits keep paisa arithmetic below 2^53 (no silent precision loss)
    unc = (x) => (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(String(x)) ? String(x).replace(/,/g, '') : String(x)),   // strips ONLY real thousands separators; '1250,50' (decimal comma) stays invalid instead of becoming 125050
    cn = (x) => (x === '' ? NaN : Number(unc(x))), nn = (x) => (x === '' ? 0 : Number(unc(x))), TX_TYPES = ['buy', 'sell', 'rights', 'bonus', 'split', 'reverse'], DIV_STATUS = ['announced', 'expected', 'received', 'cancelled'];
  const MONS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // Accepts YYYY-MM-DD, DD-MMM-YYYY, or DD/MM/YYYY (day first). Returns ISO or null; rejects impossible dates.
  function parseDateAny(x) {
    x = String(x || '').trim(); if (isoD(x)) return x; let d, mo, y, m = x.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ,]+(\d{4})$/);
    if (m) { d = +m[1]; mo = MONS[m[2].toLowerCase()]; y = +m[3]; } else if ((m = x.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; } else return null;
    if (!mo || mo > 12 || d < 1) return null; const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return new Date(iso + 'T00:00:00Z').getUTCDate() === d ? iso : null;
  }
  const IMPORTS = {
    transactions: { label: 'Transactions', store: 'transactions', fields: [['date', 1], ['symbol', 1], ['type', 1], ['qty'], ['price'], ['brokerage'], ['taxes'], ['other'], ['broker'], ['ref'], ['notes'], ['ratioNew'], ['ratioOld'], ['tags']],
      key: (t) => [t.date, t.symbol, t.type, t.qty, t.price, t.ref || ''].join('|'),
      build(g, i, uid) { const t = { id: uid(), createdAt: Date.now() + i, date: g('date'), symbol: g('symbol').toUpperCase(), type: g('type').toLowerCase(), qty: nn(g('qty')), price: nn(g('price')), brokerage: nn(g('brokerage')), taxes: nn(g('taxes')), other: nn(g('other')),
          broker: g('broker'), ref: g('ref'), notes: g('notes'), tags: g('tags'), ratioNew: nn(g('ratioNew')), ratioOld: nn(g('ratioOld')) }, split = t.type === 'split' || t.type === 'reverse';
        if (!isoD(t.date) || !t.symbol || !TX_TYPES.includes(t.type) || !okSym(t.symbol) || t.qty > LIM.qty || t.price > LIM.price || [t.brokerage, t.taxes, t.other].some((x) => x > LIM.money) || [t.qty, t.price, t.brokerage, t.taxes, t.other].some((x) => !Number.isFinite(x) || x < 0) || (split ? !(t.ratioNew > 0 && t.ratioOld > 0) : !(t.qty > 0 && Number.isInteger(t.qty)))) return null;
        if (split) { t.qty = 0; t.price = 0; } return t; } },
    dividends: { label: 'Dividends', store: 'dividends', fields: [['symbol', 1], ['shares', 1], ['dps', 1], ['status', 1], ['payDate'], ['exDate'], ['taxRate'], ['other'], ['actual'], ['broker'], ['name'], ['notes'], ['tags']],
      key: (d) => [d.symbol, d.payDate, d.status, d.shares, d.dps].join('|'),
      build(g, i, uid) { const d = { id: uid(), createdAt: Date.now() + i, symbol: g('symbol').toUpperCase(), name: g('name'), type: 'Cash', payDate: g('payDate'), exDate: g('exDate'), shares: cn(g('shares')), dps: cn(g('dps')),
          taxRate: nn(g('taxRate')), other: nn(g('other')), status: g('status').toLowerCase(), actual: g('actual') === '' ? '' : cn(g('actual')), broker: g('broker'), notes: g('notes'), tags: g('tags') };
        if (!okSym(d.symbol) || d.shares > LIM.shares || d.dps > LIM.price || d.other > LIM.money || !(d.shares > 0) || !(d.dps >= 0) || !(d.taxRate >= 0 && d.taxRate <= 100) || !(d.other >= 0) || !DIV_STATUS.includes(d.status) || (d.payDate && !isoD(d.payDate)) || (d.exDate && !isoD(d.exDate)) || (d.status === 'received' && !d.payDate) || (d.actual !== '' && !(d.actual >= 0))) return null;
        return d; } },
    holdings: { label: 'Holdings (opening balances)', store: 'transactions', needsDate: 1, fields: [['Symbol', 1], ['Shares', 1], ['Avg Buy', 1], ['Stock Name'], ['Sector'], ['Rate']],
      key: (t) => [t.date, t.symbol, t.type, t.qty, t.price, t.ref].join('|'),
      build(g, i, uid, ctx) { const N = (x) => Number(unc(x)), t = { id: uid(), createdAt: Date.now() + i, date: ctx.date, symbol: g('Symbol').toUpperCase(), name: g('Stock Name'), sector: g('Sector'), type: 'buy', qty: N(g('Shares')), price: g('Avg Buy') === '' ? NaN : N(g('Avg Buy')),
          brokerage: 0, taxes: 0, other: 0, broker: '', ref: 'Opening balance', notes: 'Imported holding', tags: '', _rate: g('Rate') === '' ? null : N(g('Rate')) };
        if (!isoD(t.date || '') || !okSym(t.symbol) || t.qty > LIM.qty || t.price > LIM.price || !(t.qty > 0 && Number.isInteger(t.qty)) || !Number.isFinite(t.price) || t.price < 0 || (t._rate != null && !(t._rate >= 0))) return null; return t; },
      clean: (t) => { const { _rate, ...r } = t; return r; }, extra: (good) => ({ prices: good.filter((t) => t._rate > 0).map((t) => ({ id: t.symbol, price: t._rate, date: t.date, source: 'Imported' })) }) },
    dividendSheet: { label: 'Dividends (sheet format)', store: 'dividends', fields: [['Symbol', 1], ['Date', 1], ['Dividend', 1], ['Stock Name'], ['Tax%'], ['Actual Dividend']],
      key: (d) => [d.symbol, d.payDate, d.status, d.shares, d.dps].join('|'),
      build(g, i, uid, ctx) { const N = (x) => Number(unc(String(x).replace(/%/g, ''))), sym = g('Symbol').toUpperCase(), date = parseDateAny(g('Date')); if (!okSym(sym) || !date) return null;
        const ck = sym + '|' + date, cache = ctx.cache || {}; if (!(ck in cache)) { const p = computePortfolio(ctx.txs.filter((t) => t.date <= date)).positions.find((x) => x.symbol === sym); cache[ck] = p ? p.qty : 0; }
        const dps = g('Dividend') === '' ? NaN : N(g('Dividend')), tax = g('Tax%') === '' ? 0 : N(g('Tax%')), act = g('Actual Dividend') === '' ? '' : N(g('Actual Dividend'));
        if (!(cache[ck] > 0) || dps > LIM.price || !(dps >= 0) || !Number.isFinite(dps) || !(tax >= 0 && tax <= 100) || (act !== '' && !(act >= 0))) return null;   // eligible shares = quantity held on that date per your transactions
        return { id: uid(), createdAt: Date.now() + i, symbol: sym, name: g('Stock Name'), type: 'Cash', payDate: date, exDate: '', shares: cache[ck], dps, taxRate: tax, other: 0, status: act === '' ? 'expected' : 'received', actual: act, broker: '', notes: 'Imported (sheet)', tags: '' }; } },
    cash: { label: 'Cash ledger (deposits / withdrawals / adjustments)', store: 'cash', fields: [['date', 1], ['kind', 1], ['amount', 1], ['notes']],
      key: (m) => [m.date, m.kind, m.amount, m.notes || ''].join('|'),
      build(g, i, uid) { const m = { id: uid(), createdAt: Date.now() + i, date: g('date'), kind: g('kind').toLowerCase(), amount: cn(g('amount')), notes: g('notes') };
        if (!isoD(m.date) || !['deposit', 'withdrawal', 'adjustment'].includes(m.kind) || !Number.isFinite(m.amount) || (m.kind !== 'adjustment' && !(m.amount > 0))) return null;
        if (m.kind === 'withdrawal') m.amount = -m.amount; return m; } },
  };
  // Per-stock lifetime performance. Total return = realized + unrealized (needs a price) + received net dividends; % is on total purchase cost incl. fees.
  function stockPerformance(txs, divs, prices, method) {
    const s = summarize(txs, divs, prices, method), inv = {}; txs.forEach((t) => { if (isBuy(t)) inv[t.symbol] = (inv[t.symbol] || 0) + txAmounts(t).total; });
    return s.holdings.concat(s.closed).map((h) => { const invested = inv[h.symbol] || 0, unr = h.closed ? 0 : h.unrealized, total = unr == null ? null : h.realized + unr + h.divNet;
      return { symbol: h.symbol, sector: h.sector || '', invested, realized: h.realized, unrealized: unr, divNet: h.divNet, total, retPct: total != null && invested ? Math.round((total / invested) * 1e4) / 100 : null }; }).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  }
  // Report builder: sort by a column and hide columns (never hides everything). Pure.
  function customizeReport(d, o) {
    let rows = d.rows; const cols = d.cols, cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
    const si = o.sort ? cols.findIndex((c) => c[0] === o.sort) : -1; if (si >= 0) rows = [...rows].sort((a, b) => (a[si] == null || b[si] == null ? (a[si] == null ? (b[si] == null ? 0 : 1) : -1) : cmp(a[si], b[si]) * (o.dir === 'desc' ? -1 : 1)));   // empty values always last
    let keep = cols.map((c, i) => i).filter((i) => !(o.hide || []).includes(cols[i][0])); if (!keep.length) keep = cols.map((c, i) => i);
    return { ...d, cols: keep.map((i) => cols[i]), rows: rows.map((r) => keep.map((i) => r[i])) };
  }
  // Dividend breakdowns by pay-date year. Received uses the actual amount when entered; expected = announced + expected; cancelled is an estimate only.
  function dividendBreakdown(divs) {
    const out = { byYear: {}, expByYear: {}, taxByMonth: {}, status: { announced: 0, expected: 0, received: 0, cancelled: 0 } };
    divs.forEach((d) => { const a = dividendAmounts(d), y = (d.payDate || '').slice(0, 4) || 'undated'; out.status[d.status] = (out.status[d.status] || 0) + (d.status === 'received' ? a.received : a.net);
      if (d.status === 'received') { const o = out.byYear[y] || (out.byYear[y] = { gross: 0, tax: 0, net: 0 }); o.gross += a.gross; o.tax += a.tax; o.net += a.received; const m = (d.payDate || '').slice(0, 7); if (m) out.taxByMonth[m] = (out.taxByMonth[m] || 0) + a.tax; }
      else if (d.status === 'announced' || d.status === 'expected') out.expByYear[y] = (out.expByYear[y] || 0) + a.net; });
    return out;
  }
  // Approximate time-weighted return: monthly Modified Dietz returns, chain-linked. Holdings-only view: purchases (incl. fees) are contributions,
  // net sale proceeds are withdrawals, received dividends are return. Needs imported prices for every held stock at both month-ends; other months are skipped, never estimated.
  function twr(txs, divs, hist, today) {
    const first = txs.map((t) => t.date).sort()[0];
    if (!first || !hist.length) return { periods: [], used: 0, total: 0, cum: null, reason: 'Import price history to compute' };
    const by = {}; valueSeries(txs, hist, today).points.forEach((p) => (by[p.month] = p));
    const U = Date.UTC, iso = (d) => new Date(d).toISOString().slice(0, 10); let y = +first.slice(0, 4), m = +first.slice(5, 7) - 1; const periods = []; let total = 0;
    for (let i = 0; i < 360; i++) {
      const prevEnd = iso(U(y, m, 0)), full = iso(U(y, m + 1, 0)), end = full > today ? today : full; total++;
      const p1 = by[end.slice(0, 7)], p0 = total === 1 ? { value: 0 } : by[prevEnd.slice(0, 7)];
      if (p1 && p0) {
        const T = dayNum(end) - dayNum(prevEnd); let flow = 0, wsum = 0, dv = 0;
        txs.forEach((t) => { if (isTrade(t) && t.date > prevEnd && t.date <= end) { const a = txAmounts(t).total, f = isBuy(t) ? a : -a; flow += f; wsum += (f * (dayNum(end) - dayNum(t.date))) / T; } });
        divs.forEach((d) => { if (d.status === 'received' && d.payDate > prevEnd && d.payDate <= end) dv += dividendAmounts(d).received; });
        const den = p0.value + wsum; if (den > 0) periods.push({ month: end.slice(0, 7), r: (p1.value - p0.value - flow + dv) / den });
      }
      if (end >= today) break; if (++m > 11) { m = 0; y++; }
    }
    const used = periods.length; if (!used) return { periods, used, total, cum: null, reason: 'No month has prices for every holding' };
    const cum = periods.reduce((a, p) => a * (1 + p.r), 1) - 1;
    return { periods, used, total, cum, ann: used === total && used >= 12 ? Math.pow(1 + cum, 12 / used) - 1 : null };
  }
  // Dashboard insights: most invested / most profit / most loss, by stock and by sector. Invested = cost basis of current holdings; profit/loss = realized + unrealized + received dividends (priced stocks only).
  function insights(txs, divs, prices, method, sectorOf) {
    const s = summarize(txs, divs, prices, method), sec = (y) => sectorOf[y] || 'Unassigned';
    const stocks = stockPerformance(txs, divs, prices, method).map((r) => ({ symbol: r.symbol, sector: sec(r.symbol), cost: (s.holdings.find((h) => h.symbol === r.symbol) || { cost: 0 }).cost, total: r.total })), sm = {};
    stocks.forEach((x) => { const o = sm[x.sector] || (sm[x.sector] = { sector: x.sector, cost: 0, total: 0 }); o.cost += x.cost; if (x.total != null) o.total += x.total; });
    const sectors = Object.values(sm), top = (a, k, sign) => a.filter((x) => x[k] != null && (sign > 0 ? x[k] > 0 : x[k] < 0)).sort((p, q) => (q[k] - p[k]) * sign)[0] || null;
    return { stocks, sectors, topInvestStock: top(stocks, 'cost', 1), topProfitStock: top(stocks, 'total', 1), topLossStock: top(stocks, 'total', -1), topInvestSector: top(sectors, 'cost', 1), topProfitSector: top(sectors, 'total', 1), topLossSector: top(sectors, 'total', -1) };
  }
  const api = { unc, LIM, okSym, isoD, insights, parseDateAny, twr, dividendBreakdown, stockPerformance, customizeReport, IMPORTS, brokerSummary, planUndo, periodRange, valueSeries, xirr, portfolioXirr, cashLedger, P, txAmounts, computePortfolio, dividendAmounts, dividendTotals, summarize };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
