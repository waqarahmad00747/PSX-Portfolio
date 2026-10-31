# QA report (module by module)

Tested in Chromium (Playwright) against a local server, timezone Asia/Karachi. Engine tests: 147 passed.

## Module 1: engine and shared helpers
- New transactions had no type (blank Type dropdown), so a buy failed with a false "negative holding"; cash entries got a blank kind. Selects now default to the first option.
- `h()` flattened children one level only: the dividends, holdings, dividend-sheet and cash import buttons never rendered.
- CSV export turned every negative number into text (`'-250`). Numbers stay numeric; text is still neutralised against formula injection.
- `today()` used UTC (a day behind in Pakistan 00:00-05:00). Now local date.
- Dates were checked by pattern only (2026-13-45 accepted). Now real calendar dates.
- Blank Avg Buy (holdings) and blank Dividend (dividend sheet) silently became 0. Now rejected. Thousands separators accepted.
- Corrupt saved data blanked the whole page. Now an on-screen message and data untouched.
- Value-over-time chart ignored the FIFO setting. CSS-selector-unsafe IDs (`Avg Buy`, `Tax%`, `A.B`) broke the mapping screen and Prices tab.

## Module 2: transaction, dividend, cash forms
- Negative deductions / negative actual dividend, pay date before ex-date, zero cash adjustment and invalid type are rejected; failed deletes report an error.

## Module 3: backup, restore, exports
- `data:null`, corrupt settings, duplicate/missing ids in any store, impossible dates, non-whole quantities and bad dividend fields are rejected with a clear dialog.
- Merge shows how many records are new, warns about double-counting, and is refused if it would create a negative holding.
- Dividends CSV export now round-trips (tax rate, deductions, ex-date, broker, name, notes, tags); transactions CSV includes tags.

## Module 4: CSV imports
- Holdings import no longer overwrites a newer price with an older opening rate.
- File inputs reset after use (re-selecting the same file name previously did nothing).
- Price-history import validates real calendar dates.

## Module 5: prices and watchlist
- Set price defaults to today with the current price prefilled, and requires a valid date.
- Warning when an imported newer price overrides a price you just saved.
- Watchlist: duplicate symbols and renames onto an existing symbol are refused; target/alert must be positive; no divide-by-zero.

## Module 6: reports, charts, settings, PWA
- File pickers are keyboard-reachable. Service worker cache bumped to v16 (installed copies pick up the fixes).
- Multi-tab sync added (BroadcastChannel). Database connection closes on version change.
- Verified: all five reports, filters, period shortcuts, sort/hide columns, CSV = table, presets, print view, charts, FIFO vs average (total return identical), themes persist.

## Known limits
- Two identical same-day trades with no reference number are treated as duplicates by CSV import (add a reference number).
- A price saved with a date older than imported history will not be used for valuation (a warning is shown).

---
# Round 2 (deeper pass, module by module)

Added: randomized engine stress test (3,000 random portfolios, 9,618 sales: FIFO vs average total return, cash conservation, input-order independence), hostile-text and large-number input, undo/audit sequences, mocked autosave folder, CSV parser edge cases, hand-calculated XIRR/TWR, empty-install rendering, accessibility labels, phone-size layout and PWA manifest/icons.

## Fixed in round 2
- **Engine:** a sale typed *before* the same-day purchase it depends on was rejected as an oversell. Same-day purchases/bonuses of that stock are now brought forward (a sale with no same-day purchase, or on an earlier day, is still rejected). Covered by new unit tests (165 total).
- **Restore:** a backup file containing just `null` crashed the restore dialog. Now shows the validation message.
- **Price-history CSV:** `"1,250.5"` (thousands separator) was rejected, unlike every other import. Now consistent: only real thousands separators are stripped; decimal commas (`1250,50`) are still rejected rather than misread as 125050.
- **Accessibility:** the saved-filters dropdown on Reports had no accessible name.

## Verified, no defect found
Engine invariants; XIRR and time-weighted return match closed-form hand calculations; undo chains across transactions, cash and dividends; audit cap (1,000); safety backup on Replace; wrong/cancelled confirmations never wipe data; autosave (latest + local-dated file, survives delete-all); CSV parser (quoted newlines, CRLF, semicolon/tab files, 100k rows in under 1.5 s, 5,000-row imports); formula-injection neutralised on export; HTML in names shown as text; every screen renders on an empty install; no sideways scroll or undersized touch targets at phone width; manifest and icons valid; offline start works.
