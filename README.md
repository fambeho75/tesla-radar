# Model Y Radar

Small installable web app (PWA) for judging **Tesla Model Y prices in Sweden** three ways — used, new and private leasing — plus a rough cost-of-ownership comparison.
Plain HTML/CSS/JS, no build step. Works under any sub-path (e.g. `https://fambeho75.github.io/<repo>/`).

- **Used** — Model Y ads in southern Sweden (Skåne, Halland, Blekinge, Kronoberg, Jönköping, Kalmar, Västra Götaland, Östergötland), Juniper (2025 refresh) and older.
  Price-vs-km and price-vs-model-year scatter, a fitted price model, value badges (Good = 7 %+ under the model, Great = 15 %+, Pricey = 10 %+ over),
  filters for variant, generation, region, max price, max km, a budget line (default 250 000 kr). Every row links to its ad.
- **New** — Tesla Sverige list prices per version (cash, incl. moms, no options), each with its source(s) and fetch date; incentives and Tesla financing.
- **Leasing** — Tesla privatleasing, GoMore (insurance + service + tyres included) and leasing ads on Blocket (Ayvens Release used-car leasing, dealer campaigns):
  monthly price, term, km/year, down payment, fees and total over the contract.
- **Compare** — N-year cost (default 3 years, 15 000 km/yr) for one used car, one new version and one lease offer. All non-sourced inputs are editable and labelled *Assumption*.
- Dark by default, sun/moon toggle remembered; filters and assumptions saved in `localStorage`. Service worker caches the shell and the last data snapshot for offline use.

## Data

A static site can't scrape Blocket or Tesla from the browser (CORS, bot walls), so the page reads a snapshot in `data/`:

| File | Contents |
|---|---|
| `data/used.json` | `listings[]` (price, year, km, region, variant, generation, seller, ad URL), `sources[]` status, `excluded[]`, fitted `model` |
| `data/new.json` | `variants[]` with `prices[]` per source, `financing[]`, `incentives[]`, `delivery`, `sources[]` |
| `data/lease.json` | `offers[]` (monthly, term, km/yr, down payment, fees, includes, offer URL, source URL), `sources[]` |

Every price carries `source_url` and `fetched_at`. Values carried forward after a failed fetch are marked `stale`.

`node scripts/fetch-data.mjs` regenerates all three (≈1 min; `--only=used|new|lease`). Needs Node 18+ and `curl`; the kostnader.se step needs
`playwright-core` + Chrome/Chromium (without it, that source's last values are kept and marked stale).

### Sources (checked 2026-11-09)

| Source | Used for | Works from a script? |
|---|---|---|
| [Blocket](https://www.blocket.se/mobility/search/car?variant=1.8078.2000555) | used ads (search state embedded in the page), first-registration date for MY2025, leasing ads | yes (curl) |
| [Wayke](https://www.wayke.se/sok/tesla/model-y) | dealer ads (JSON-LD); ~90 % are duplicates of Blocket ads and are merged | yes (curl; Node's own `fetch` gets 403) |
| [Bilissimo](https://bilissimo.se/model/116-tesla-model-y) | new list prices per version (server-rendered, updated daily) | yes |
| [kostnader.se](https://kostnader.se/bil/tesla-model-y-kostnad) | new prices "enligt Tesla", Tesla privatleasing (handpenning, term, mil), restvärdeslån | JS-rendered → headless browser |
| [Leasa Bil](https://leasabil.com/bilmarken/Tesla/Tesla-Model-Y) | confirms Tesla privatleasing prices; setup + invoice fee | yes |
| [GoMore](https://gomore.se/leasing/tesla) | privatleasing incl. insurance/service/tyres | yes |
| tesla.com (`/sv_se/modely`, design studio, `inventory/api/v4`) | — | **no**: Akamai "Access Denied" (403) from curl and headless Chrome |
| Carla, Alleasing | — | **no**: Vercel bot checkpoint (429) |
| Bytbil, Kvdbil | — | reachable but not used: Bytbil carries the same dealer stock as Blocket; Kvdbil is auctions (bids, not asking prices) |

Curated facts (incentives) live in `scripts/curated.json`; the fetcher re-checks each source page still says what we quote.

### Juniper vs older

Model year 2026 → Juniper. Model year ≤ 2024 → older. **Model year 2025 is ambiguous** — many MY2025 cars on Blocket are the old model, first registered Oct 2024–Feb 2025.
The fetcher reads *Registreringsdatum* from each MY2025 Blocket ad: before 2025-03-01 → older, from 2025-04-01 → Juniper, March or unknown → "Gen?".

### Price model

Least squares: `price ≈ b0 + b1·age + b2·(km/10 000) + dummies(LR AWD, LR RWD, Performance, Juniper)` on the current listings (unknown variant / unclear generation excluded).
It's a rough yardstick for asking prices — a car far below the line may have a reason (damage, import, export-only price, very high km).

## Refreshing the snapshot

Recommended: a scheduled GitHub Action in the repo (daily ~06:00), roughly:

```yaml
on: { schedule: [{ cron: "0 5 * * *" }], workflow_dispatch: {} }
jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i --no-save playwright-core && npx playwright install --with-deps chromium
      - run: CHROME=$(ls ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | head -1) node scripts/fetch-data.mjs
      - run: node test/radar.test.js
      - run: |
          git config user.name "modely-radar-bot"; git config user.email "actions@users.noreply.github.com"
          git add data && git diff --cached --quiet || (git commit -m "data: refresh snapshot" && git push)
```

Caveat: Blocket/Wayke may treat GitHub's datacentre IPs differently from this box; if the Action starts failing, a daily run on another machine that commits `data/` works the same way.

## Files

`index.html`, `styles.css`, `app.js` (UI), `radar.js` (pure logic: classification, price model, value scoring, filters, lease totals, TCO — also used by the fetcher and tests),
`sw.js`, `manifest.webmanifest`, icons (`icon.svg`, `icon-rounded.svg`, `icon-maskable.svg`, `icon-small.svg`, `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`,
`icon-maskable-192/512.png`, `favicon-32.png`), `src/` icon generator + renderer (cairosvg), `scripts/` fetcher + curated facts, `data/`, `test/`.

Bump `CACHE` in `sw.js` and the `?v=` query strings when shipping app changes (data files don't need it).

## Run / test

```sh
python3 -m http.server 8795        # then open http://127.0.0.1:8795/
node --check app.js radar.js sw.js scripts/fetch-data.mjs
node test/radar.test.js            # unit tests + snapshot sanity
BASE=http://127.0.0.1:8795/ node test/browser.test.js   # headless Chrome (playwright-core), writes screenshots/
node scripts/fetch-data.mjs        # refresh data/
python3 src/gen_icons.py && python3 src/render_icons.py
```

Asking prices, not sale prices. Not affiliated with Tesla.
