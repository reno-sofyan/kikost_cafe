---
name: run-kikost-cafe-pos
description: Build, run, and drive the Kinara Coffee POS web app (Vite/React/Dexie cashier PWA). Use when asked to start the app, run it, take a screenshot of a screen (Kasir, Produk, Laporan, Dapur, etc.), or click through a flow to verify a change actually renders — not for running the unit/e2e test suites, which have their own commands (see Test below).
---

This is a Vite/React/Dexie offline-first PWA (no server-rendered auth —
Dexie/IndexedDB is the source of truth, backend is optional sync/backup).
Drive it by starting the dev server, then running
`.claude/skills/run-kikost-cafe-pos/driver.mjs` (Playwright, using the
project's own `playwright` dependency — no extra install). All paths
below are relative to the repo root (`Kikost Cafe/`).

## Prerequisites

Node 20+ and the repo's own `npm install` are enough. Playwright's
Chromium binary needs to be present once:

```bash
npx playwright install chromium
# on a fresh Linux container, use --with-deps instead so system libs
# (libnss3, libatk, etc.) get pulled too:
#   npx playwright install --with-deps chromium
```

## Setup

```bash
npm install
```

No env vars are required to run the cashier app itself — it works fully
offline-first against local IndexedDB. (A backend URL/device key can be
configured later from inside the app at Pengaturan → Sinkronisasi, but
the driver below never needs it.)

## Build

No build step needed to run — the driver talks to the Vite **dev**
server directly (`npm run dev`), not a production build.

## Run (agent path)

**1. Start the dev server** (leave it running in the background; the
driver assumes `http://localhost:5173`):

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill   # free the port if a stale one is still up
nohup npm run dev > /tmp/vite-dev.log 2>&1 &
disown
i=0; until curl -sf http://localhost:5173 >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 1; i=$((i+1)); done
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:5173   # expect 200
```

Stop it the same way when done: `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill`.
(`$!` after `npm run dev &` is only the npm wrapper — killing the port's
listener is what actually frees it, same reasoning as `/run`'s
generic server pattern.)

**2. Drive it:**

```bash
node .claude/skills/run-kikost-cafe-pos/driver.mjs smoke
node .claude/skills/run-kikost-cafe-pos/driver.mjs goto /produk
node .claude/skills/run-kikost-cafe-pos/driver.mjs reset
```

| command | what it does |
|---|---|
| `smoke` | Gets to a logged-in Kasir screen with an active shift, from *any* starting state (empty onboarding, PIN login screen, or already logged in with shift already open) — handles all three, since which one you hit depends on whether `.profile/` already has a completed run. Screenshot → `screenshots/cashier.png`. |
| `goto <path>` | Runs `smoke`'s login/shift setup first, then either clicks the matching sidebar nav item (`/produk`, `/laporan`, `/dapur`, `/meja`, `/pengaturan`, `/riwayat`, `/stok`, `/pengeluaran`, `/pelanggan`, `/pesanan-qr`, `/cetak`) or `page.goto`s the path directly if it's not one of those. Screenshot → `screenshots/<path>.png`. |
| `reset` | Deletes the persistent browser profile (`.profile/`) so the next `smoke`/`goto` starts from onboarding again. Use this when you need a truly clean-state run (e.g. testing the onboarding wizard itself). |

The driver reuses a **persistent Chromium profile** at
`.claude/skills/run-kikost-cafe-pos/.profile/` (gitignored) across
invocations — real IndexedDB, so once onboarding has run once, every
later `smoke`/`goto` reopens already logged in with the shift still
open, in ~1s instead of redoing all 7 onboarding steps. Admin account
created by the driver: name `Demo Admin`, PIN `1234`.

Every run prints a console/page-error count and exits non-zero if any
were captured — treat a nonzero exit as "something threw," not just
"screenshot looks different."

Screenshots land in `.claude/skills/run-kikost-cafe-pos/screenshots/`
(gitignored).

## Run (human path)

```bash
npm run dev
```

Opens on `http://localhost:5173` — but the app is landscape-tablet-only
below 760px width or in portrait orientation (`#portrait-lock` in
`src/index.css` hides the app and shows a "putar perangkat" message
otherwise), so widen the browser window past 760px in landscape before
judging anything broken. Ctrl-C to stop.

## Test

```bash
npm run typecheck && npm run lint && npm test   # tsc + eslint + vitest (unit)
npm run build && npm run test:e2e               # Playwright e2e (needs the prod build, not the dev server)
```

`test:e2e` builds and serves via `vite preview` itself (see
`playwright.config.ts`) — don't run it against the dev server started
above, and don't run it while that dev server is still bound to 5173
(different port, `vite preview` defaults to 4173, so they don't
actually collide, but stop the dev server first anyway to avoid
confusing which one a failure came from).

---

## Gotchas

- **The app has no login page on first load — it's an onboarding
  wizard.** A fresh IndexedDB always starts at "Selamat Datang" (7
  steps: welcome → profile → fiscal → qris → printer → admin → finish),
  not a login form. The driver's `ensureLoggedIn()` detects which of
  the three states (onboarding / PIN login / already in) it landed on
  and branches — don't assume one fixed flow.
- **"Buka Shift" appears twice in a row on the fresh-onboarding path.**
  The empty-state button on the Kasir screen just **navigates** to
  `/shift`; the actual `OpenShiftModal` trigger is a *second*,
  identically-labeled button on that page. `getByRole('button', {name:
  'Buka Shift'})` alone is ambiguous once the modal is open (the
  page's trigger button is still in the DOM behind it) — the driver
  disambiguates with `.last()` for the modal's submit button.
- **`PinPad` has no auto-submit.** Typing 4 digits doesn't log you in —
  there's an explicit "Masuk" button (disabled until `value.length >=
  4`). Digit buttons are plain `<button>{digit}</button>`, so
  `getByRole('button', { name: '1', exact: true })` etc. works per
  digit.
- **Playwright's `text=a, text=b` comma selector doesn't mean "OR"
  the way you'd expect** when mixing engines — use
  `page.waitForFunction(() => /regex/.test(document.body.innerText))`
  instead of trying to build one compound `waitForSelector` string for
  "any of these three states."
- **Run the driver script from the repo root**, not by absolute path
  from elsewhere — it imports `playwright` from `node_modules`, which
  Node only resolves relative to a directory that has it (or an
  ancestor of one). `node .claude/skills/run-kikost-cafe-pos/driver.mjs
  smoke` from repo root works; copying the script out to `/tmp` and
  running it from there does not (`ERR_MODULE_NOT_FOUND`).

## Troubleshooting

- **`page.screenshot` shows only the "putar perangkat" message, app
  content missing**: viewport is portrait or narrower than 760px. The
  driver's context always launches at 1366×768 landscape — if you're
  driving manually, match that.
- **`ERR_MODULE_NOT_FOUND: playwright`**: you ran the driver from
  outside the repo, or copied it somewhere without `node_modules`
  nearby. `cd` to the repo root first.
- **`smoke` times out waiting for `Modal Awal`**: you're mid-onboarding
  but the flow found the *empty-state* "Buka Shift" button and clicked
  it without waiting for the `/shift` navigation to land before
  clicking again — the driver already accounts for this
  (`waitForFunction` between the two clicks), but if you're modifying
  the driver, keep that wait or the second click can fire on the old page.
