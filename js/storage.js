/* IndexedDB persistence. Every change is written immediately; nothing is saved on unload. */
const DB = (() => {
  const NAME = 'psx-portfolio', VERSION = 6, STORES = ['transactions', 'dividends', 'prices', 'settings', 'cash', 'watchlist', 'pricehist', 'audit', 'brokers'];
  let db, status = () => {}, remote = () => {}; const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('psx-portfolio') : null; if (bc) bc.onmessage = () => remote();   // other tabs reload after any write, so a stale tab cannot overwrite newer data
  const open = () => new Promise((res, rej) => {
    const rq = indexedDB.open(NAME, VERSION);
    rq.onupgradeneeded = (e) => { const d = rq.result; // migrations go here, keyed on e.oldVersion; never delete stores
      STORES.concat('handles').forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); };
    rq.onsuccess = () => { db = rq.result; db.onversionchange = () => db.close(); res(); }; rq.onerror = () => rej(rq.error);
  });
  const run = (stores, fn) => new Promise((res, rej) => {
    status('saving');
    const tx = db.transaction(stores, 'readwrite'); let out;
    tx.oncomplete = () => { status('saved'); if (bc) bc.postMessage('changed'); res(out); };
    tx.onabort = tx.onerror = () => { status('error', tx.error && tx.error.name); rej(tx.error); };
    out = fn((s) => tx.objectStore(s));
  });
  const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    open, all, onStatus: (f) => (status = f), onRemote: (f) => (remote = f),
    put: (s, rec) => run([s], (st) => st(s).put(rec)),
    del: (s, id) => run([s], (st) => st(s).delete(id)),
    // Replace or merge in ONE transaction: a failure rolls everything back.
    bulk: (data, replace) => run(STORES, (st) => { STORES.forEach((s) => { if (replace) st(s).clear(); (data[s] || []).forEach((r) => st(s).put(r)); }); }),
    getHandle: () => new Promise((res) => { const r = db.transaction('handles').objectStore('handles').get('autosave'); r.onsuccess = () => res(r.result ? r.result.h : null); r.onerror = () => res(null); }),
    setHandle: (h) => new Promise((res, rej) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put({ id: 'autosave', h }); t.oncomplete = res; t.onerror = () => rej(t.error); }),
    clearHandle: () => new Promise((res) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').delete('autosave'); t.oncomplete = res; }),
    wipe: () => run(STORES, (st) => STORES.forEach((s) => st(s).clear())),
  };
})();
