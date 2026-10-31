const C = require('../js/calculations.js'); let ok = 0, bad = 0;
const eq = (n, a, b) => { if (a === b) ok++; else { bad++; console.log('FAIL', n, 'got', a, 'want', b); } };
const tx = [
 { id: 1, date: '2026-01-05', symbol: 'ABC', type: 'buy', qty: 100, price: 50, brokerage: 50 },            // 5050.00
 { id: 2, date: '2026-02-05', symbol: 'ABC', type: 'buy', qty: 100, price: 70, brokerage: 70, taxes: 10 },  // 7080.00 -> 12130/200
 { id: 3, date: '2026-03-05', symbol: 'ABC', type: 'sell', qty: 50, price: 80, brokerage: 40 },            // net 3960; cost sold 3032.50
];
let r = C.summarize(tx, [], { ABC: { price: 75, date: '2026-03-06' } }); const h = r.holdings[0];
eq('qty', h.qty, 150); eq('cost basis', h.cost, 909750); eq('avg', h.avg, 60.65);
eq('realized', r.realized, 396000 - 303250); eq('value', h.value, 1125000); eq('unrealized', h.unrealized, 1125000 - 909750);
r = C.summarize([...tx, { id: 4, date: '2026-04-01', symbol: 'ABC', type: 'sell', qty: 150, price: 60 }], [], {});
eq('closed holdings', r.holdings.length, 0); eq('realized after full sale', r.realized, 396000 - 303250 + (900000 - 909750));
eq('oversell rejected', C.computePortfolio([...tx, { id: 5, date: '2026-05-01', symbol: 'ABC', type: 'sell', qty: 999, price: 1 }]).errors.length, 1);
const d = { symbol: 'ABC', shares: 150, dps: 2.5, taxRate: 15, other: 0, status: 'received', payDate: '2026-06-10', actual: '' };
const a = C.dividendAmounts(d); eq('gross', a.gross, 37500); eq('tax', a.tax, 5625); eq('net', a.net, 31875);
const t = C.dividendTotals([d, { ...d, status: 'expected' }, { ...d, status: 'cancelled' }, { ...d, actual: 310 }]);
eq('received only', t.net, 31875 + 31000); eq('expected', t.expected, 31875);
r = C.summarize(tx, [d], { ABC: { price: 75 } }); eq('total return', r.totalReturn, 92750 + 215250 + 31875);
r = C.summarize(tx, [], {}); eq('no price -> no unrealized', r.unrealized, 0); eq('unpriced flag', r.unpriced, 1);
// corporate actions: bonus keeps cost, split/reverse keep cost, fractional rejected
const ca = [{ id: 1, date: '2026-01-01', symbol: 'X', type: 'buy', qty: 100, price: 10 }, { id: 2, date: '2026-02-01', symbol: 'X', type: 'bonus', qty: 25 },
  { id: 3, date: '2026-03-01', symbol: 'X', type: 'split', ratioNew: 2, ratioOld: 1 }];
r = C.summarize(ca, [], {}); eq('bonus+split qty', r.holdings[0].qty, 250); eq('cost unchanged', r.holdings[0].cost, 100000); eq('avg after', r.holdings[0].avg, 4);
r = C.summarize([...ca, { id: 4, date: '2026-04-01', symbol: 'X', type: 'reverse', ratioNew: 1, ratioOld: 10 }], [], {}); eq('reverse qty', r.holdings[0].qty, 25);
eq('fractional rejected', C.computePortfolio([...ca, { id: 5, date: '2026-05-01', symbol: 'X', type: 'reverse', ratioNew: 1, ratioOld: 7 }]).errors.length, 1);
const led = C.cashLedger([{ date: '2026-01-05', symbol: 'ABC', type: 'buy', qty: 100, price: 50, brokerage: 50 }, { date: '2026-03-05', symbol: 'ABC', type: 'sell', qty: 50, price: 80, brokerage: 40 }],
  [{ symbol: 'ABC', shares: 50, dps: 2, taxRate: 15, status: 'received', payDate: '2026-06-01' }, { symbol: 'ABC', shares: 50, dps: 2, taxRate: 15, status: 'expected', payDate: '2026-07-01' }],
  [{ id: 'm', date: '2026-01-01', kind: 'deposit', amount: 10000 }]);
eq('ledger rows (expected div excluded)', led.length, 4); eq('ledger balance', led[led.length - 1].balance, 1000000 - 505000 + 396000 + 8500);
eq('xirr 10% over 2y', Math.round(C.xirr([{ date: '2026-01-01', amount: -100 }, { date: '2028-01-01', amount: 121 }]) * 1e6), 100000);
eq('xirr no sign change', C.xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-06-01', amount: -5 }]), null);
let x = C.portfolioXirr([{ date: '2025-01-01', symbol: 'A', type: 'buy', qty: 10, price: 10 }], [], { A: { price: 11, date: '2026-01-01' } });
eq('portfolio xirr 10%', Math.round(x.rate * 1e4), 1000);
x = C.portfolioXirr([{ date: '2025-01-01', symbol: 'A', type: 'buy', qty: 10, price: 10 }], [], {}); eq('refuses unpriced', x.rate, null);
x = C.portfolioXirr([{ date: '2025-01-01', symbol: 'A', type: 'buy', qty: 10, price: 10 }, { date: '2025-07-01', symbol: 'A', type: 'sell', qty: 10, price: 12 }], [], {});
eq('closed position xirr positive', x.rate > 0.4 && x.rate < 0.5, true);
const vt = [{ date: '2026-01-05', symbol: 'A', type: 'buy', qty: 10, price: 10 }], vh = [{ symbol: 'A', date: '2026-01-31', price: 11 }, { symbol: 'A', date: '2026-02-28', price: 12 }];
let vs = C.valueSeries(vt, vh, '2026-03-15'); eq('series months', vs.points.length, 3); eq('jan value', vs.points[0].value, 11000); eq('mar uses last price', vs.points[2].value, 12000); eq('cost', vs.points[0].cost, 10000);
vs = C.valueSeries(vt, [], '2026-03-15'); eq('no prices -> all skipped', vs.points.length + '/' + vs.skipped, '0/3');
eq('rights adds cost', C.summarize([{ id: 1, date: '2026-01-01', symbol: 'R', type: 'buy', qty: 100, price: 10 }, { id: 2, date: '2026-02-01', symbol: 'R', type: 'rights', qty: 50, price: 8 }], [], {}).holdings[0].cost, 140000);
eq('rights in ledger', C.cashLedger([{ date: '2026-02-01', symbol: 'R', type: 'rights', qty: 50, price: 8 }], [], [])[0].amount, -40000);
eq('period month', C.periodRange('month', '2026-10-28', 7).join(), '2026-10-01,2026-10-31'); eq('period lastmonth', C.periodRange('lastmonth', '2026-10-28', 7).join(), '2026-09-01,2026-09-30');
eq('period quarter', C.periodRange('quarter', '2026-10-28', 7).join(), '2026-10-01,2026-12-31'); eq('fy in H2', C.periodRange('fy', '2026-10-28', 7).join(), '2026-07-01,2027-06-30');
eq('fy in H1', C.periodRange('fy', '2026-03-10', 7).join(), '2025-07-01,2026-06-30'); eq('lastmonth in Jan', C.periodRange('lastmonth', '2026-01-15', 7).join(), '2025-12-01,2025-12-31');
const fb = [{ id: 1, date: '2026-01-01', symbol: 'F', type: 'buy', qty: 100, price: 10 }, { id: 2, date: '2026-02-01', symbol: 'F', type: 'buy', qty: 100, price: 20 }, { id: 3, date: '2026-03-01', symbol: 'F', type: 'sell', qty: 150, price: 30 }];
let fw = C.summarize(fb, [], { F: { price: 30 } }, 'wavg'), ff = C.summarize(fb, [], { F: { price: 30 } }, 'fifo');
eq('fifo realized', ff.realized, 250000); eq('fifo remaining cost', ff.holdings[0].cost, 100000); eq('wavg realized', fw.realized, 225000); eq('wavg remaining cost', fw.holdings[0].cost, 75000);
eq('total return method-independent', ff.totalReturn, fw.totalReturn); eq('default is wavg', C.summarize(fb, [], {}).realized, 225000);
const fs2 = [fb[0], fb[1], { id: 4, date: '2026-02-15', symbol: 'F', type: 'split', ratioNew: 2, ratioOld: 1 }, { id: 5, date: '2026-03-01', symbol: 'F', type: 'sell', qty: 250, price: 10 }];
ff = C.summarize(fs2, [], {}, 'fifo'); eq('fifo after split qty', ff.holdings[0].qty, 150); eq('fifo after split cost', ff.holdings[0].cost, 150000); eq('fifo split realized', ff.realized, 250000 - 150000);
const fbn = [fb[0], { id: 6, date: '2026-01-15', symbol: 'F', type: 'bonus', qty: 100 }, { id: 7, date: '2026-02-01', symbol: 'F', type: 'sell', qty: 100, price: 20 }];
eq('fifo bonus lot sold first costs 100k', C.summarize(fbn, [], {}, 'fifo').realized, 100000); eq('wavg bonus', C.summarize(fbn, [], {}, 'wavg').realized, 150000);
const fz = C.summarize([...fb, { id: 8, date: '2026-04-01', symbol: 'F', type: 'sell', qty: 50, price: 1 }], [], {}, 'fifo'); eq('fifo full exit: no holding', fz.holdings.length, 0); eq('fifo full exit: realized = proceeds - total cost', fz.realized, 455000 - 300000);
const rA = { id: 'a', v: 1 }, rB = { id: 'a', v: 2 };
let pl = C.planUndo({ action: 'add', recId: 'a', after: rA }, [rA, { id: 'z' }]); eq('undo add removes', pl.next.length, 1); eq('undo add deletes id', pl.del, 'a');
pl = C.planUndo({ action: 'edit', recId: 'a', before: rA, after: rB }, [rB]); eq('undo edit restores', pl.next[0].v, 1); eq('undo edit no delete', pl.del, null);
pl = C.planUndo({ action: 'delete', recId: 'a', before: rA, after: null }, []); eq('undo delete restores', pl.next.length, 1);
pl = C.planUndo({ action: 'edit', recId: 'NEW', before: { id: 'OLD' }, after: { id: 'NEW' } }, [{ id: 'NEW' }]); eq('undo rename restores old', pl.next[0].id, 'OLD'); eq('undo rename deletes new', pl.del, 'NEW');
const bt = [{ id: 1, date: '2026-01-01', symbol: 'Q', type: 'buy', qty: 10, price: 10, brokerage: 5, broker: 'KASB' }, { id: 2, date: '2026-02-01', symbol: 'Q', type: 'sell', qty: 10, price: 12, brokerage: 5, broker: 'KASB' }, { id: 3, date: '2026-02-02', symbol: 'W', type: 'buy', qty: 1, price: 1 }];
const bs = C.brokerSummary(bt, [{ symbol: 'Q', shares: 10, dps: 1, taxRate: 0, status: 'received', payDate: '2026-03-01', broker: 'KASB' }, { symbol: 'Q', shares: 10, dps: 1, status: 'expected', broker: 'KASB' }]);
eq('broker groups', bs.length, 2); const kb = bs.find((x) => x.broker === 'KASB'); eq('broker bought', kb.bought, 10500); eq('broker sold', kb.sold, 11500); eq('broker fees', kb.fees, 1000); eq('broker div received only', kb.divNet, 1000);
const cs = C.summarize(bt, [], {}); eq('closed listed', cs.closed.length, 1); eq('closed realized', cs.closed[0].realized, 11500 - 10500); eq('open excludes closed', cs.holdings.length, 1);
const mk = (o) => (k) => (o[k] == null ? '' : String(o[k])), uidf = () => 'u', I = C.IMPORTS;
const dv0 = { symbol: 'abc', shares: 100, dps: 2.5, status: 'Received', payDate: '2026-06-10', taxRate: 15 };
let rec = I.dividends.build(mk(dv0), 0, uidf); eq('div import ok', rec && rec.symbol + rec.status + rec.shares, 'ABCreceived100'); eq('div actual blank stays blank', rec.actual, '');
eq('div bad status', I.dividends.build(mk({ ...dv0, status: 'paid' }), 0, uidf), null); eq('div received needs payDate', I.dividends.build(mk({ ...dv0, payDate: '' }), 0, uidf), null);
eq('div tax >100', I.dividends.build(mk({ ...dv0, taxRate: 150 }), 0, uidf), null); eq('div missing shares', I.dividends.build(mk({ ...dv0, shares: '' }), 0, uidf), null);
eq('div announced w/o date ok', !!I.dividends.build(mk({ ...dv0, status: 'announced', payDate: '' }), 0, uidf), true);
eq('cash withdrawal negative', I.cash.build(mk({ date: '2026-01-01', kind: 'Withdrawal', amount: 500 }), 0, uidf).amount, -500); eq('cash adjustment signed', I.cash.build(mk({ date: '2026-01-01', kind: 'adjustment', amount: -20 }), 0, uidf).amount, -20);
eq('cash zero deposit rejected', I.cash.build(mk({ date: '2026-01-01', kind: 'deposit', amount: 0 }), 0, uidf), null); eq('cash blank amount rejected', I.cash.build(mk({ date: '2026-01-01', kind: 'deposit', amount: '' }), 0, uidf), null);
eq('cash bad date', I.cash.build(mk({ date: '01/02/2026', kind: 'deposit', amount: 5 }), 0, uidf), null);
eq('tx split zeroes qty', I.transactions.build(mk({ date: '2026-01-01', symbol: 'x', type: 'split', ratioNew: 2, ratioOld: 1, qty: 9 }), 0, uidf).qty, 0); eq('tx fractional qty rejected', I.transactions.build(mk({ date: '2026-01-01', symbol: 'x', type: 'buy', qty: 1.5, price: 1 }), 0, uidf), null);
eq('dup key stable', I.dividends.key(rec), 'ABC|2026-06-10|received|100|2.5');
const sp = C.stockPerformance([{ id: 1, date: '2026-01-01', symbol: 'S', type: 'buy', qty: 100, price: 10 }, { id: 2, date: '2026-01-02', symbol: 'U', type: 'buy', qty: 10, price: 10 }],
  [{ symbol: 'S', shares: 100, dps: 0.5, taxRate: 0, status: 'received', payDate: '2026-03-01' }, { symbol: 'S', shares: 100, dps: 9, taxRate: 0, status: 'expected', payDate: '2026-09-01' }], { S: { price: 12, date: '2026-04-01' } });
const sS = sp.find((x) => x.symbol === 'S'), sU = sp.find((x) => x.symbol === 'U');
eq('stock invested', sS.invested, 100000); eq('stock total return (expected div excluded)', sS.total, 20000 + 5000); eq('stock return pct', sS.retPct, 25); eq('unpriced -> no return', sU.retPct, null);
const cd = { cols: [['A'], ['B', 'm'], ['C']], rows: [['x', 5, 'p'], ['y', 9, 'q'], ['z', null, 'r']], sum: [] };
let cz = C.customizeReport(cd, { sort: 'B', dir: 'desc', hide: ['C'] }); eq('sort desc first', cz.rows[0][0], 'y'); eq('null last', cz.rows[2][0], 'z'); eq('hide col', cz.cols.length, 2); eq('hidden dropped from rows', cz.rows[0].length, 2);
eq('hide all falls back to all', C.customizeReport(cd, { hide: ['A', 'B', 'C'] }).cols.length, 3); eq('sort asc strings', C.customizeReport(cd, { sort: 'A', dir: 'asc' }).rows[0][0], 'x');
const bd = C.dividendBreakdown([{ symbol: 'A', shares: 100, dps: 10, taxRate: 15, status: 'received', payDate: '2025-06-01' }, { symbol: 'A', shares: 100, dps: 10, taxRate: 15, status: 'received', payDate: '2026-06-01', actual: 800 },
  { symbol: 'A', shares: 100, dps: 10, taxRate: 15, status: 'expected', payDate: '2026-12-01' }, { symbol: 'A', shares: 100, dps: 10, taxRate: 15, status: 'cancelled', payDate: '2026-09-01' }, { symbol: 'A', shares: 100, dps: 10, taxRate: 15, status: 'announced' }]);
eq('2025 gross', bd.byYear['2025'].gross, 100000); eq('2025 tax', bd.byYear['2025'].tax, 15000); eq('2025 net', bd.byYear['2025'].net, 85000); eq('2026 net uses actual', bd.byYear['2026'].net, 80000);
eq('expected 2026', bd.expByYear['2026'], 85000); eq('undated announced', bd.expByYear['undated'], 85000); eq('received excludes expected/cancelled', bd.status.received, 165000); eq('cancelled is estimate', bd.status.cancelled, 85000); eq('tax by month', bd.taxByMonth['2026-06'], 15000);
const tw = (txs, divs, hist, today) => C.twr(txs, divs, hist, today);
let t1 = tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 100, price: 10 }, { date: '2026-01-16', symbol: 'T', type: 'buy', qty: 100, price: 11 }], [], [{ symbol: 'T', date: '2025-12-31', price: 10 }, { symbol: 'T', date: '2026-01-31', price: 11 }], '2026-01-31');
eq('twr periods', t1.used + '/' + t1.total, '2/2'); eq('twr Dec return zero', Math.round(t1.periods[0].r * 1e4), 0); eq('twr Jan modified Dietz', Math.round(t1.periods[1].r * 1e4), 653);
t1 = tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 100, price: 10 }], [{ symbol: 'T', shares: 100, dps: 1, taxRate: 0, status: 'received', payDate: '2026-01-20' }], [{ symbol: 'T', date: '2025-12-31', price: 10 }, { symbol: 'T', date: '2026-01-31', price: 10 }], '2026-01-31');
eq('twr dividend is return', Math.round(t1.periods[1].r * 1e4), 1000);
t1 = tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 100, price: 10 }], [], [{ symbol: 'T', date: '2025-12-31', price: 10 }, { symbol: 'T', date: '2026-01-31', price: 11 }, { symbol: 'T', date: '2026-02-28', price: 12.1 }], '2026-02-28');
eq('twr chain-linked', Math.round(t1.cum * 1e4), 2100); eq('no annualised under 12 months', t1.ann, null);
t1 = tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 100, price: 10 }], [], [{ symbol: 'T', date: '2025-12-31', price: 10 }, { symbol: 'T', date: '2026-02-28', price: 12 }], '2026-02-28');
eq('stale price carries forward (3/3, 20% total)', t1.used + '/' + t1.total + '/' + Math.round(t1.cum * 1e4), '3/3/2000');
t1 = tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 100, price: 10 }], [], [{ symbol: 'T', date: '2026-01-31', price: 11 }, { symbol: 'T', date: '2026-02-28', price: 12 }], '2026-02-28');
eq('months before first price skipped, not estimated', t1.used + '/' + t1.total, '1/3'); eq('no prices -> reason', tw([{ date: '2025-12-15', symbol: 'T', type: 'buy', qty: 1, price: 1 }], [], [], '2026-01-31').cum, null);
eq('date iso', C.parseDateAny('2026-03-05'), '2026-03-05'); eq('date DD-MMM-YYYY', C.parseDateAny('05-Mar-2026'), '2026-03-05'); eq('date DD/MM/YYYY', C.parseDateAny('15/03/2026'), '2026-03-15'); eq('date impossible', C.parseDateAny('31/02/2026'), null); eq('date junk', C.parseDateAny('soon'), null);
const hb = C.IMPORTS.holdings.build(mk({ Symbol: 'lucky', Shares: '1,000', 'Avg Buy': '350.5', Rate: '400', 'Stock Name': 'Lucky Cement', Sector: 'Cement' }), 0, uidf, { date: '2026-01-01' });
eq('holdings row', hb.symbol + hb.qty + hb.price + hb.type + hb._rate, 'LUCKY1000350.5buy400'); eq('holdings clean drops _rate', '_rate' in C.IMPORTS.holdings.clean(hb), false); eq('holdings extra price', C.IMPORTS.holdings.extra([hb]).prices[0].price, 400);
eq('holdings bad shares', C.IMPORTS.holdings.build(mk({ Symbol: 'x', Shares: '1.5', 'Avg Buy': '1' }), 0, uidf, { date: '2026-01-01' }), null);
const dtx = [{ date: '2026-01-01', symbol: 'LUCKY', type: 'buy', qty: 1000, price: 300 }, { date: '2026-04-01', symbol: 'LUCKY', type: 'sell', qty: 400, price: 350 }], dctx = { txs: dtx, cache: {} };
const ds1 = C.IMPORTS.dividendSheet.build(mk({ Symbol: 'Lucky', Date: '15-Mar-2026', Dividend: '10', 'Tax%': '15%', 'Actual Dividend': '8,500' }), 0, uidf, dctx);
eq('sheet dividend shares at date', ds1.shares, 1000); eq('sheet dividend received', ds1.status, 'received'); eq('sheet tax %', ds1.taxRate, 15); eq('sheet actual', ds1.actual, 8500);
eq('sheet shares after sale', C.IMPORTS.dividendSheet.build(mk({ Symbol: 'LUCKY', Date: '2026-06-01', Dividend: '5' }), 0, uidf, dctx).shares, 600); eq('sheet blank actual -> expected', C.IMPORTS.dividendSheet.build(mk({ Symbol: 'LUCKY', Date: '2026-06-01', Dividend: '5' }), 0, uidf, dctx).status, 'expected');
eq('sheet no shares held -> invalid', C.IMPORTS.dividendSheet.build(mk({ Symbol: 'LUCKY', Date: '2025-12-01', Dividend: '5' }), 0, uidf, dctx), null);
const it = C.insights([{ date: '2026-01-01', symbol: 'A', type: 'buy', qty: 100, price: 10, sector: 'Bank' }, { date: '2026-01-01', symbol: 'B', type: 'buy', qty: 10, price: 100, sector: 'Cement' }, { date: '2026-01-01', symbol: 'C', type: 'buy', qty: 50, price: 10, sector: 'Bank' }], [],
  { A: { price: 12 }, B: { price: 80 }, C: { price: 11 } }, 'wavg', { A: 'Bank', B: 'Cement', C: 'Bank' });
eq('top invested stock', it.topInvestStock.symbol, 'A'); eq('top profit stock', it.topProfitStock.symbol, 'A'); eq('top loss stock', it.topLossStock.symbol, 'B'); eq('top invested sector', it.topInvestSector.sector, 'Bank'); eq('top profit sector', it.topProfitSector.sector, 'Bank'); eq('top loss sector', it.topLossSector.sector, 'Cement');
// --- QA regression tests (import validation) ---
const g = (o) => (k) => (o[k] == null ? '' : String(o[k])); let _n = 0; const uid = () => 'u' + _n++, IM = C.IMPORTS;
eq('isoD rejects 2026-13-45', C.isoD('2026-13-45'), false); eq('isoD rejects 2026-02-30', C.isoD('2026-02-30'), false); eq('isoD rejects 0000-01-01', C.isoD('0000-01-01'), false); eq('isoD accepts leap day', C.isoD('2028-02-29'), true); eq('isoD rejects non-leap 29 Feb', C.isoD('2026-02-29'), false);
eq('tx import rejects impossible date', IM.transactions.build(g({ date: '2026-13-45', symbol: 'a', type: 'buy', qty: 1, price: 1 }), 0, uid), null);
const tc = IM.transactions.build(g({ date: '2026-02-28', symbol: 'a', type: 'buy', qty: '1,000', price: '1,250.50' }), 0, uid); eq('tx import strips thousands separators', tc && tc.qty * 100000 + tc.price, 1000 * 100000 + 1250.5);
eq('holdings import rejects blank Avg Buy', IM.holdings.build(g({ Symbol: 'L', Shares: 5, 'Avg Buy': '' }), 0, uid, { date: '2026-01-01' }), null);
eq('dividend sheet rejects blank Dividend', IM.dividendSheet.build(g({ Symbol: 'L', Date: '2026-03-01', Dividend: '' }), 0, uid, { txs: [{ date: '2026-01-01', symbol: 'L', type: 'buy', qty: 5, price: 1 }], cache: {} }), null);
eq('dividend import rejects blank shares', IM.dividends.build(g({ symbol: 'L', shares: '', dps: 1, status: 'expected' }), 0, uid), null);
eq('cash import rejects blank amount', IM.cash.build(g({ date: '2026-01-01', kind: 'deposit', amount: '' }), 0, uid), null);
const fx = [{ id: 1, date: '2026-01-01', symbol: 'A', type: 'buy', qty: 10, price: 10 }, { id: 2, date: '2026-01-02', symbol: 'A', type: 'buy', qty: 10, price: 20 }];
eq('valueSeries uses FIFO cost when asked', C.valueSeries(fx.concat({ id: 3, date: '2026-01-03', symbol: 'A', type: 'sell', qty: 10, price: 30 }), [{ symbol: 'A', date: '2026-01-31', price: 25 }], '2026-01-31', 'fifo').points[0].cost, 20000);
eq('P rounds 1.005 to 101 paisa', C.P(1.005), 101); eq('P rounds 12.345 to 1235', C.P(12.345), 1235); eq('P(-1.005) symmetric', C.P(-1.005), -101); eq('P(0.29)', C.P(0.29), 29); eq('P(NaN/blank)', C.P(''), 0);
eq('decimal comma 1250,50 is NOT read as 125050', C.IMPORTS.transactions.build(g({ date: '2026-02-28', symbol: 'a', type: 'buy', qty: 1, price: '1250,50' }), 0, uid), null); eq('1,250.50 still fine', C.IMPORTS.transactions.build(g({ date: '2026-02-28', symbol: 'a', type: 'buy', qty: 1, price: '1,250.50' }), 0, uid).price, 1250.5); eq('1,25 rejected', C.IMPORTS.cash.build(g({ date: '2026-01-01', kind: 'deposit', amount: '1,25' }), 0, uid), null); eq('symbol with space rejected on import', C.IMPORTS.transactions.build(g({ date: '2026-02-28', symbol: 'A B', type: 'buy', qty: 1, price: 1 }), 0, uid), null); eq('qty above limit rejected on import', C.IMPORTS.transactions.build(g({ date: '2026-02-28', symbol: 'A', type: 'buy', qty: 1e12, price: 1 }), 0, uid), null); eq('year 1900 rejected', C.isoD('1900-01-01'), false);
// --- same-day ordering: a sale typed BEFORE the same-day purchase it depends on is still valid ---
const sd = [{ id: 1, createdAt: 1, date: '2026-05-01', symbol: 'D', type: 'sell', qty: 10, price: 12 }, { id: 2, createdAt: 2, date: '2026-05-01', symbol: 'D', type: 'buy', qty: 10, price: 10 }];
let sdr = C.computePortfolio(sd); eq('same-day sell typed before buy: no error', sdr.errors.length, 0); eq('same-day sell/buy realized', sdr.positions[0].realized, 2000); eq('same-day sell/buy leaves 0 held', sdr.positions[0].qty, 0);
eq('same-day sell with NO purchase still errors', C.computePortfolio([sd[0]]).errors.length, 1);
eq('sale on an EARLIER day than the buy still errors', C.computePortfolio([{ ...sd[0], date: '2026-04-30' }, sd[1]]).errors.length, 1);
eq('two same-day buys both pulled forward', C.computePortfolio([{ id: 1, createdAt: 1, date: '2026-05-01', symbol: 'D', type: 'sell', qty: 15, price: 12 }, { id: 2, createdAt: 2, date: '2026-05-01', symbol: 'D', type: 'buy', qty: 10, price: 10 }, { id: 3, createdAt: 3, date: '2026-05-01', symbol: 'D', type: 'buy', qty: 5, price: 10 }]).errors.length, 0);
eq('other-symbol same-day buy is NOT pulled forward', C.computePortfolio([{ id: 1, createdAt: 1, date: '2026-05-01', symbol: 'D', type: 'sell', qty: 5, price: 12 }, { id: 2, createdAt: 2, date: '2026-05-01', symbol: 'E', type: 'buy', qty: 10, price: 10 }]).errors.length, 1);
console.log(`${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
