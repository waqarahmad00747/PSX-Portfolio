# PSX Portfolio Manager (PWA, core edition)

Static, offline-first portfolio tracker. No backend, no accounts, no external requests. Data lives in your browser's IndexedDB.

## Run / install
1. Upload this folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages). Opening index.html from a file manager works for basic use but does NOT give the PWA install or offline cache.
2. Windows (Edge/Chrome): open the site, use the install icon in the address bar.
3. Android (Chrome): menu > Install app / Add to Home screen.
4. Open once online so the shell caches; afterwards it works offline.

## Backup and restore
Import / Export > Export full backup (JSON). The same file restores on Windows and Android. Restore validates the file, shows counts, then offers Merge or Replace (Replace downloads a safety backup and asks for confirmation). Backups contain sensitive data.

## Formulas
- Buy cost = qty x price + brokerage + taxes + other. Sell net = qty x price - those charges.
- Weighted average cost = total cost basis / quantity. Cost of shares sold = average cost x quantity sold (all remaining cost on a full sale).
- Realized P&L = net sale proceeds - cost of shares sold. Unrealized = market value - remaining cost basis (priced holdings only).
- Dividend gross = eligible shares x DPS; tax = gross x rate; net = gross - tax - other deductions. Only "received" dividends count as income; an actual amount overrides the estimate.
- Total return = realized + unrealized + net dividends received. Fees are inside cost basis / proceeds, so they are not deducted twice.
- Money is computed in integer paisa, rounded to the nearest paisa.

## Corporate actions
Bonus: quantity increases, total cost unchanged. Split / reverse split: quantity x new/old, total cost unchanged; fractional results are rejected. No tax treatment is assumed.

## Cash ledger
Purchases, net sale proceeds and received dividends are derived from records (not stored twice). Only deposits, withdrawals and adjustments are entered. Balance is meaningful only if all of those are recorded.

## CSV import
Transactions only, matched by header name (template provided). Preview, duplicate skipping, and all-or-nothing commit; any invalid row blocks the import.

## Reports
Reports > choose Transactions, Realized P&L, Dividend income or Brokerage & charges; filter by date range, symbol, broker, transaction type and dividend status. Summary cards, table, CSV export and print all use the same filtered rows. Presets are stored in settings (so they are in backups).

## Annualised return (XIRR)
Solves sum(amount / (1+r)^(days/365)) = 0 over dated investment flows: purchases (out), net sale proceeds and received dividends (in), and current market value as the final inflow. Deposits and withdrawals are ignored so funding is not counted as performance. Needs a price for every holding; shows a caution under 365 days of history. Not a time-weighted return.

## Watchlist and price history
Watchlist entries hold target and alert prices. Import price history from CSV (symbol, date, price) with preview and all-or-nothing commit. The newest of your manual price and imported price is used for valuation and is labelled with its source. The dashboard month-end value chart uses imported history only and skips months where a held stock has no price.

## Rights issues
Recorded as a transaction of type `rights` at the subscription price with actual charges. It is treated exactly like a purchase (adds shares and cost; appears in the ledger as an outflow). No tax or entitlement rules are assumed.

## Report periods
The Period shortcut fills the date range (this/last month, quarter, calendar year, financial year). The financial-year start month is set in Settings (default July). The sector filter uses the sector you entered on transactions or the watchlist.

## FIFO cost basis
Settings > Cost-basis method. FIFO sells the oldest lots first; a lot's cost includes its purchase fees and is released in proportion, with the exact remainder on the last share of a lot. Bonus shares form a zero-cost lot; splits and reverse splits rescale lot quantities and keep cost. Weighted average (default) keeps bonus cost pooled. Switching only changes the calculation; records are untouched and total return is the same under both.

## Audit trail and undo
Adds, edits and deletes of transactions, dividends, cash entries and watchlist items are logged (last 1,000 kept; included in backups). The header Undo button and the Audit & Undo page reverse the most recent change only; a transaction undo is refused if it would create a negative holding. Imports, restores and Delete-all are logged but cannot be undone, and they block undoing anything earlier.

## Holding details, archiving, brokers
Holdings > Details shows a position's cost, value, P&L, transactions, dividends and realized sales. Show closed positions lists fully sold stocks with their realized P&L. Archive only hides a row (totals and reports are unchanged). Brokers: names you add become suggestions in the Broker / account field, and Brokers shows totals grouped by the broker text on your records.

## CSV import and column mapping
Transactions, dividends and cash-ledger CSVs: choose a file, map each field to a column (matching names are pre-selected), preview, then import. Exact duplicates are skipped, any invalid row blocks the whole import, and the commit is all-or-nothing. Transaction imports that would create a negative holding are blocked. Price history import still uses the fixed headers symbol, date, price. Dividend CSV: eligible shares are taken from the file, never guessed.

## More filters and the report builder
Tags (comma-separated) can be set on transactions and dividends (and imported). Reports can also filter by amount; the Stock-wise performance report adds return % and net-dividend filters. Under every report, choose a sort column and direction and tick which columns to show; the table and CSV follow, and the choices are saved with filter presets. Stock return % = (realized + unrealized + received net dividends) / total purchase cost including fees; holdings without a price show no return rather than a guess.

## Charts
Dashboard: invested cost vs market value at month-end (imported price history only; months without a price for every held stock are skipped, never estimated). Dividends: net by year and by stock, gross vs net by year, withholding tax by year and month, expected vs received by year, by status and share by stock. Received figures use the actual amount where you entered one; cancelled dividends are shown as estimates only.

## Time-weighted return (approximate)
Monthly Modified Dietz returns, chain-linked: return = (end value - start value - net flows + dividends received) / (start value + day-weighted flows). Holdings-only view: purchases including fees are contributions, net sale proceeds are withdrawals, received dividends count as return. It uses month-end values from imported price history, taking each stock's last price on or before the month-end, so sparse price files make returns lumpy (a flat month, then a jump) though the chain-linked total still holds. A month is skipped when a held stock has no price at all on or before its month-end, or the previous month was unavailable; skipped months are reported, never estimated, so the figure then covers only the months used. Annualised only when there is an unbroken run of 12+ months. Bonus shares are not treated as a flow. Because the app cannot value your portfolio on each flow date, this approximates true daily-valued TWR.

## Prices tab, holdings and dividend CSVs, insights, reports
Prices: one table of all holdings; type new prices and Save all prices (all-or-nothing). Holdings CSV (Sr. No., Stock Name, Symbol, Rate, 52 Week High, Gap, Shares, Amount, Avg Buy, Dividend, Est Div @1000, Sector): Symbol, Shares and Avg Buy are used to create opening buy transactions on the date you choose, Rate becomes the current price, Stock Name and Sector are stored; the other columns are calculated by the app and ignored. Import holdings once. Dividend sheet CSV (Sr. No., Stock Name, Symbol, Date, Dividend, Tax%, Actual Dividend): Dividend is per share, Date is the payment date (DD-MMM-YYYY, DD/MM/YYYY day-first, or YYYY-MM-DD), eligible shares = shares you held on that date according to your transactions (the row is rejected if none), Actual Dividend is the total amount received: filled = received, blank = expected. Dashboard insights: most invested / most profitable / biggest loss stock and sector with charts. Reports: simple filters shown, advanced ones collapsed; Print / Save as PDF prints only the report. The Brokers page was removed (the optional broker text field on records remains).

## Autosave to a folder
Backup & Import > Autosave to a folder > Choose folder. After each change (about 2 seconds later) the app writes PSX_Portfolio_Autosave.json (latest) and PSX_Portfolio_Backup_YYYY-MM-DD.json (one per day) into that folder, for example inside OneDrive or Google Drive. Needs Chrome or Edge on a desktop (the folder picker does not exist on Android Chrome). After a browser restart the browser asks permission again: press Resume once. The folder choice is kept outside the data stores, so restore and delete-all never remove it.

## Charts tab
Pick a dataset (holdings by cost or value, sectors, profit/loss by stock or sector, dividends by stock, year or month) and view it as an interactive donut or bars. Profit / loss charts are always bars.

## Tests
`node tests/test-calc.js` (147 checks: formulas, FIFO, XIRR/TWR, CSV import validation). A QA pass (see QA_REPORT.md) also exercised every screen in a real browser: forms, CSV imports, backup/restore, prices, watchlist, reports, charts, themes, print view, multi-tab sync and offline start. Android install and cross-device sync have not been tested.

## Not included yet
Quantities are derived from transactions only; opening balances can be entered as a dated buy.

## Multiple tabs
Changes made in one tab appear in other open tabs of the app within a second, so a stale tab cannot overwrite newer data.
