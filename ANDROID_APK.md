# Getting this app onto an Android phone

The app is a Progressive Web App (PWA). The APK could not be built inside the QA sandbox (no Android SDK / blocked downloads), so use one of these two routes. Both need the folder uploaded to an HTTPS host first (GitHub Pages, Netlify or Cloudflare Pages, all free).

## Route A: install straight from Chrome (no APK, 1 minute)
1. Open your hosted https:// address in Chrome on the phone.
2. Wait a few seconds, then menu (three dots) > Install app (or Add to Home screen).
3. Open it once while online; afterwards it works offline. Data stays in the phone's browser storage, so use Backup & Import > Export full backup regularly.

## Route B: make a real APK with PWABuilder (free, about 5 minutes, from any browser)
1. Go to https://www.pwabuilder.com and paste your hosted address, then Start.
2. It reads manifest.json (already complete: name, id, 192/512 icons incl. maskable, standalone) and the service worker.
3. Package for stores > Android > Generate. Keep the default "Signed" option and download the zip.
4. Inside the zip is an .apk (install on your own phone: allow "Install unknown apps") and an .aab (for Google Play). Keep the signing key file and its password safe; you need the same key for every future update.

## Notes for the APK
- It opens your hosted site as a full-screen app (Trusted Web Activity), so updating the hosted files updates the app. The service worker cache name is bumped in this release so phones fetch the fixes.
- Autosave to a folder does not exist on Android (the app says so). Use Export full backup and save the JSON to Google Drive / Files.
- Do not delete the app or clear its storage without a backup: that erases the data.
