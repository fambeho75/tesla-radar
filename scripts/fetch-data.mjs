#!/usr/bin/env node
/* Model Y Radar — data fetcher. Regenerates data/used.json, data/new.json, data/lease.json.
   Usage: node scripts/fetch-data.mjs [--only=used|new|lease] [--quiet]
   Needs: Node 18+, curl on PATH. Optional: playwright-core + Chrome/Chromium for the one
   JS-rendered source (kostnader.se); without it that source's last values are carried forward.
   Every price written comes from a fetched page and carries source_url + fetched_at. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = require(join(ROOT, "radar.js"));
const DATA = join(ROOT, "data");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const NOW = new Date().toISOString();
const log = (...m) => { if (!args.quiet) console.error(...m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node's own fetch gets 403 from some sites' bot filters (TLS fingerprint); curl passes, so use curl.
function get(url) {
  const out = execFileSync("curl", ["-s", "-L", "--compressed", "--max-time", "40", "-A", UA,
    "-H", "Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: sv-SE,sv;q=0.9,en;q=0.7", "-w", "\n__STATUS__%{http_code}", url], { maxBuffer: 80e6 }).toString();
  const i = out.lastIndexOf("\n__STATUS__");
  return { status: +out.slice(i + 11), body: out.slice(0, i) };
}
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");
const num = (s) => +String(s).replace(/[^\d]/g, "");
const readJson = (f, fb) => { try { return JSON.parse(readFileSync(join(DATA, f), "utf8")); } catch (e) { return fb; } };
const writeJson = (f, d) => { writeFileSync(join(DATA, f), JSON.stringify(d, null, 1) + "\n"); log(`wrote data/${f}`); };

// ---------------------------------------------------------------- used
const BLOCKET_REGIONS = { "Skåne": "0.300012", "Halland": "0.300013", "Blekinge": "0.300010", "Kronoberg": "0.300007",
  "Jönköping": "0.300006", "Kalmar": "0.300008", "Västra Götaland": "0.300014", "Östergötland": "0.300005" };
const BLOCKET_MODEL_Y = "1.8078.2000555";
// Wayke only gives the dealer's town. Towns in the covered regions (others are ignored).
const TOWN_REGION = {};
const TOWNS = {
  "Skåne": "malmö helsingborg lund kristianstad landskrona trelleborg ängelholm hässleholm ystad eslöv höganäs svedala vellinge staffanstorp burlöv arlöv lomma kävlinge åstorp klippan bjuv perstorp hörby höör sjöbo skurup simrishamn tomelilla osby östra göinge broby bromölla båstad örkelljunga svalöv landskrona åhus tollarp hyllinge",
  "Halland": "halmstad varberg kungsbacka falkenberg laholm hyltebruk getinge frillesås åsa tvååker onsala",
  "Blekinge": "karlskrona karlshamn ronneby sölvesborg olofström",
  "Kronoberg": "växjö ljungby älmhult markaryd tingsryd alvesta lessebo uppvidinge lenhovda",
  "Jönköping": "jönköping huskvarna värnamo nässjö vetlanda gislaved tranås eksjö sävsjö vaggeryd mullsjö habo aneby gnosjö skillingaryd anderstorp",
  "Kalmar": "kalmar västervik oskarshamn nybro vimmerby hultsfred emmaboda mönsterås torsås borgholm färjestaden",
  "Västra Götaland": "göteborg mölndal mölnlycke partille kungälv borås trollhättan uddevalla skövde lidköping alingsås vänersborg falköping mariestad stenungsund lerum ulricehamn mark kinna tidaholm götene herrljunga vara grästorp essunga tibro karlsborg hjo töreboda gullspång lysekil strömstad tanum orust tjörn öckerö ale nödinge härryda landvetter bollebygd svenljunga tranemo åmål bengtsfors dals-ed mellerud färgelanda munkedal sotenäs torslanda sävedalen askim",
  "Östergötland": "linköping norrköping motala mjölby finspång vadstena söderköping åtvidaberg kinda boxholm ödeshög valdemarsvik ydre",
};
for (const [reg, list] of Object.entries(TOWNS)) for (const t of list.split(" ")) TOWN_REGION[t] = reg;
// multi-word towns
Object.assign(TOWN_REGION, { "hisings backa": "Västra Götaland", "västra frölunda": "Västra Götaland", "hisings kärra": "Västra Götaland", "östra göinge": "Skåne" });

function decodeBlocketState(html) {
  const m = html.match(/<script type="application\/json" data-react-query-state>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const d = JSON.parse(Buffer.from(m[1].trim(), "base64").toString("utf8"));
  for (const q of d.queries || []) { const x = q.state && q.state.data; if (x && Array.isArray(x.docs)) return x; }
  return null;
}
function blocketSearchUrl(params, page) {
  const u = new URL("https://www.blocket.se/mobility/search/car");
  u.searchParams.append("variant", BLOCKET_MODEL_Y);
  for (const [k, v] of params) u.searchParams.append(k, v);
  u.searchParams.set("sort", "PRICE_ASC");
  if (page > 1) u.searchParams.set("page", page);
  return u.toString();
}
function blocketPages(params, maxPages = 10) {
  const docs = []; let total = 0, status = 0;
  for (let p = 1; p <= maxPages; p++) {
    const r = get(blocketSearchUrl(params, p)); status = r.status;
    if (r.status !== 200) throw new Error(`Blocket HTTP ${r.status}`);
    const x = decodeBlocketState(r.body);
    if (!x) throw new Error("Blocket: search state not found in page (layout changed?)");
    total = x.metadata?.result_size?.match_count ?? total;
    docs.push(...x.docs);
    if (p >= (x.metadata?.paging?.last || 1)) break;
  }
  return { docs, total, status };
}

function fromBlocketDoc(d, region) {
  const spec = d.model_specification || "";
  const km = d.mileage == null ? null : d.mileage_unit === "SCANDINAVIAN_MILE" ? d.mileage * 10 : d.mileage;
  const g = R.classifyGeneration(d.year, spec + " " + (d.heading || ""), d.chassis_number);
  return {
    id: "blocket-" + d.id, source: "Blocket", url: d.canonical_url, title: `${d.heading || "Tesla Model Y"} ${spec}`.trim(),
    spec, price: d.price?.amount, price_ex_vat: d.price?.amount_ex_vat || null, year: d.year, km,
    location: d.location, region, seller: d.organisation_name || "Private seller", seller_type: d.dealer_segment === "Privat" ? "private" : "dealer",
    variant: R.classifyVariant(spec + " " + (d.heading || "")), gen: g.gen, gen_sure: g.sure,
    range_km: d.driving_range || null, published: d.timestamp ? new Date(d.timestamp).toISOString().slice(0, 10) : null,
    vin_year: d.chassis_number && d.chassis_number.length === 17 ? d.chassis_number[9] : null,
  };
}

async function fetchUsed(prev) {
  const sources = [], listings = [], excluded = [];
  // 1. Blocket, region by region (so every listing has a reliable län)
  let bStatus = { name: "Blocket", url: "https://www.blocket.se/mobility/search/car?variant=" + BLOCKET_MODEL_Y, kind: "used listings" };
  try {
    let n = 0;
    for (const [region, code] of Object.entries(BLOCKET_REGIONS)) {
      const { docs, total } = blocketPages([["location", code], ["sales_form", "1"]]);
      log(`Blocket ${region}: ${docs.length}/${total}`);
      for (const d of docs) {
        const l = fromBlocketDoc(d, region);
        if (!(l.price >= 100000) || l.km == null) { excluded.push({ url: l.url, price: l.price, reason: !(l.price >= 100000) ? "price below 100 000 kr (monthly price or placeholder)" : "no mileage" }); continue; }
        if (!listings.some((x) => x.id === l.id)) listings.push(l);
        n++;
      }
      await sleep(600);
    }
    // Model year 2025 can be either generation. Juniper deliveries in Sweden started in March 2025,
    // so read the first registration date from the ad page.
    let checked = 0;
    for (const l of listings.filter((x) => x.source === "Blocket" && x.year === 2025)) {
      try {
        const r = get(l.url); const m = text(r.body).match(/Registreringsdatum (20\d\d-\d\d-\d\d)/);
        if (m) {
          l.registered = m[1]; checked++;
          if (m[1] < "2025-03-01") Object.assign(l, { gen: "legacy", gen_sure: true, gen_basis: "first registered " + m[1] + " (before Juniper deliveries)" });
          else if (m[1] >= "2025-04-01") Object.assign(l, { gen: "juniper", gen_sure: true, gen_basis: "first registered " + m[1] });
          else Object.assign(l, { gen: "unclear", gen_sure: false, gen_basis: "first registered " + m[1] + " (March 2025: either generation)" });
        }
      } catch (e) {}
      await sleep(400);
    }
    Object.assign(bStatus, { status: "ok", count: n, my2025_checked: checked, fetched_at: NOW });
  } catch (e) {
    Object.assign(bStatus, { status: "failed", error: e.message, fetched_at: NOW });
    const keep = (prev.listings || []).filter((l) => l.source === "Blocket").map((l) => Object.assign(l, { stale: true }));
    listings.push(...keep); bStatus.carried_forward = keep.length;
  }
  sources.push(bStatus);

  // 2. Wayke (dealers; many are also on Blocket → de-duplicated)
  let wStatus = { name: "Wayke", url: "https://www.wayke.se/sok/tesla/model-y", kind: "used listings (dealers)" };
  try {
    let n = 0, dup = 0, outside = 0, total = 0;
    for (let p = 1; p <= 40; p++) {
      const r = get(`https://www.wayke.se/sok/tesla/model-y${p > 1 ? "?page=" + p : ""}`);
      if (r.status !== 200) throw new Error(`Wayke HTTP ${r.status}`);
      const blocks = [...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch (e) { return {}; } });
      const list = blocks.find((b) => b["@type"] === "ItemList");
      if (!list) throw new Error("Wayke: ItemList JSON-LD not found");
      total = list.numberOfItems || total;
      if (!list.itemListElement.length) break;
      for (const { item } of list.itemListElement) {
        const town = (item.offers?.seller?.address?.addressLocality || "").trim();
        const region = TOWN_REGION[town.toLowerCase()];
        if (!region) { outside++; continue; }
        const year = +item.vehicleModelDate, km = item.mileageFromOdometer?.value, price = item.offers?.price;
        if (!(price >= 100000) || km == null) continue;
        const twin = listings.find((x) => x.source === "Blocket" && x.price === price && x.year === year && Math.abs(x.km - km) <= Math.max(300, km * 0.02));
        if (twin) { (twin.also = twin.also || []).push({ source: "Wayke", url: item.url }); dup++; continue; }
        const g = R.classifyGeneration(year, item.name, null);
        listings.push({ id: "wayke-" + item.url.split("/").pop(), source: "Wayke", url: item.url, title: item.name, spec: item.name.replace(/^Tesla Model Y\s*/i, ""),
          price, price_ex_vat: null, year, km, location: town, region, seller: item.offers?.seller?.name || "Dealer", seller_type: "dealer",
          variant: R.classifyVariant(item.name), gen: g.gen, gen_sure: g.sure, range_km: null, published: null, vin_year: null });
        n++;
      }
      if (p * 24 >= total + 24) break;
      await sleep(500);
    }
    Object.assign(wStatus, { status: "ok", count: n, duplicates_of_blocket: dup, outside_regions: outside, total_sweden: total, fetched_at: NOW });
  } catch (e) {
    Object.assign(wStatus, { status: "failed", error: e.message, fetched_at: NOW });
    const keep = (prev.listings || []).filter((l) => l.source === "Wayke").map((l) => Object.assign(l, { stale: true }));
    listings.push(...keep); wStatus.carried_forward = keep.length;
  }
  sources.push(wStatus);

  // 3. Probes for sources that don't work from a script (kept in the report so it's visible when they start working)
  for (const [name, url, why] of [
    ["Tesla used inventory", "https://www.tesla.com/inventory/api/v4/inventory-results?query=" + encodeURIComponent(JSON.stringify({ query: { model: "my", condition: "used", options: {}, arrangeby: "Price", order: "asc", market: "SE", language: "sv", super_region: "europe" }, offset: 0, count: 50, outsideOffset: 0, outsideSearch: false })), "Akamai bot wall"],
    ["Bytbil", "https://www.bytbil.com/bil?Makes=Tesla&Models=Model%20Y", "same dealer stock as Blocket (same owner), HTML only — not scraped"],
    ["Kvdbil", "https://www.kvd.se/begagnade-bilar/tesla/model-y", "auctions (current bid, not an asking price) — not used"],
    ["Carla", "https://www.carla.se/bilar/tesla/model-y", "Vercel bot checkpoint; Carla's cars are listed on Blocket anyway"],
  ]) {
    let st; try { st = get(url).status; } catch (e) { st = 0; }
    sources.push({ name, url, kind: "used listings", status: st === 200 ? "reachable, not used" : `blocked (HTTP ${st})`, note: why, fetched_at: NOW });
  }

  const model = R.fitModel(listings, new Date().getFullYear() + 1);
  return {
    generated_at: NOW, regions: R.REGIONS, scope: "Tesla Model Y for sale (sales_form = used), southern Sweden, all prices",
    model: model && { beta: model.beta.map((b) => Math.round(b)), n: model.n, r2: +model.r2.toFixed(3), sd: Math.round(model.sd), features: model.features, refYear: model.refYear },
    sources, excluded, listings: listings.sort((a, b) => a.price - b.price),
  };
}

// ---------------------------------------------------------------- new
async function withBrowser(fn) {
  let pw;
  for (const p of [process.env.PW_CORE, "playwright-core", "playwright", "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core"]) {
    if (!p) continue; try { pw = require(p); break; } catch (e) {}
  }
  if (!pw) throw new Error("playwright-core not installed");
  const exe = process.env.CHROME || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((f) => existsSync(f));
  const b = await pw.chromium.launch(Object.assign({ headless: true }, exe ? { executablePath: exe } : {}));
  try { return await fn(b); } finally { await b.close(); }
}
async function renderText(url) {
  return withBrowser(async (b) => {
    const p = await (await b.newContext({ locale: "sv-SE", userAgent: UA })).newPage();
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }); await p.waitForTimeout(1500);
    return (await p.innerText("body")).replace(/[\u00a0\u202f\u2009]/g, " ");
  });
}
const NEW_NAMES = [ // [id, regex on source text, display name]
  ["RWD", /(?:Model Y,? )?bakhjulsdrift/i, "Model Y Bakhjulsdrift (Standard)"],
  ["LR_RWD", /Premium Long Range,? (?:med )?bakhjulsdrift/i, "Model Y Premium Long Range RWD"],
  ["LR_AWD", /Premium Long Range,? (?:med )?fyrhjulsdrift/i, "Model Y Premium Long Range AWD"],
  ["PERF", /Performance/i, "Model Y Performance AWD"],
];

async function fetchNew(prev) {
  const sources = [], variants = {};
  const add = (id, rec) => { (variants[id] = variants[id] || { id, name: NEW_NAMES.find((n) => n[0] === id)[2], prices: [] }).prices.push(rec); };
  // 0. Tesla itself (expected to be blocked from datacentre IPs)
  for (const url of ["https://www.tesla.com/sv_se/modely/design", "https://www.tesla.com/sv_se/modely"]) {
    let st; try { st = get(url).status; } catch (e) { st = 0; }
    sources.push({ name: "Tesla Sverige (" + url.replace("https://www.tesla.com", "") + ")", url, status: st === 200 ? "reachable — parser not written" : `blocked (HTTP ${st})`, fetched_at: NOW });
  }
  // 1. Bilissimo model page: server-rendered list prices per version (updated daily)
  const bil = { name: "Bilissimo", url: "https://bilissimo.se/model/116-tesla-model-y" };
  try {
    const r = get(bil.url); if (r.status !== 200) throw new Error("HTTP " + r.status);
    const t = text(r.body);
    const upd = (t.match(/Uppgifter uppdaterade ([0-9]{1,2} \w+ 20\d\d)/) || [])[1] || null;
    const seg = t.slice(t.indexOf("Version"), t.indexOf("Visa Specifikationer", t.lastIndexOf("Performance")) + 30);
    const rx = /(Bakhjulsdrift|Premium Long Range med bakhjulsdrift|Premium Long Range med fyrhjulsdrift|Performance) (\d{3}) km · (\d{3}) kW (\d{3} \d{3}) kr/g;
    let m, n = 0;
    while ((m = rx.exec(seg))) {
      const id = m[1] === "Bakhjulsdrift" ? "RWD" : /bakhjul/.test(m[1]) ? "LR_RWD" : /fyrhjul/.test(m[1]) ? "LR_AWD" : "PERF";
      add(id, { price: num(m[4]), range_km: +m[2], kw: +m[3], source_name: "Bilissimo", source_url: bil.url, fetched_at: NOW, source_updated: upd });
      n++;
    }
    if (!n) throw new Error("no version prices found");
    sources.push(Object.assign(bil, { status: "ok", count: n, source_updated: upd, fetched_at: NOW }));
  } catch (e) { sources.push(Object.assign(bil, { status: "failed", error: e.message, fetched_at: NOW })); }

  // 2. kostnader.se: prices "enligt Tesla <date>", Tesla privatleasing + restvärdeslån (JS-rendered → headless browser)
  const kost = { name: "kostnader.se", url: "https://kostnader.se/bil/tesla-model-y-kostnad" };
  let kostText = null;
  try {
    kostText = await renderText(kost.url);
    const asOf = (kostText.match(/Kontantpris enligt Tesla ([0-9]{1,2} \w+ 20\d\d)/) || [])[1] || null;
    const k0 = kostText.indexOf("Priser i Sverige"); const block = kostText.slice(k0, kostText.indexOf("Kontantpris enligt Tesla", k0));
    let n = 0;
    for (const [id, rx] of NEW_NAMES) {
      const re = new RegExp("Model Y" + (id === "RWD" ? ", bakhjulsdrift" : id === "LR_RWD" ? " Premium Long Range, bakhjulsdrift" : id === "LR_AWD" ? " Premium Long Range, fyrhjulsdrift" : " Performance, fyrhjulsdrift") + "\\s*\\n?\\s*([\\d ]{7,}) kr");
      const m = block.match(re);
      if (m) { add(id, { price: num(m[1]), source_name: "kostnader.se (cites Tesla" + (asOf ? ", " + asOf : "") + ")", source_url: kost.url, fetched_at: NOW, source_updated: asOf }); n++; }
    }
    if (!n) throw new Error("no prices found in rendered page");
    sources.push(Object.assign(kost, { status: "ok", count: n, source_updated: asOf, fetched_at: NOW }));
  } catch (e) {
    sources.push(Object.assign(kost, { status: "failed", error: e.message, fetched_at: NOW }));
    for (const v of prev.variants || []) for (const p of v.prices) if (/kostnader/.test(p.source_url)) add(v.id, Object.assign({}, p, { stale: true }));
  }
  const out = NEW_NAMES.map(([id]) => variants[id]).filter(Boolean).map((v) => Object.assign(v, {
    price: Math.min(...v.prices.map((p) => p.price)), range_km: (v.prices.find((p) => p.range_km) || {}).range_km || null,
    agree: new Set(v.prices.map((p) => p.price)).size === 1,
  }));

  // financing (restvärdeslån) from kostnader.se
  let financing = [];
  if (kostText) {
    const m = kostText.match(/Model Y, ([\d ]+) kr \((\d+) %\) kontant, (\d+) mån\s*\n?\s*([\d ]+) kr\/mån\s*\n?\s*([\d,]+) % nominell ränta, ([\d ]+) mil per år/);
    if (m) financing.push({ name: "Tesla restvärdeslån (Model Y RWD)", cash: num(m[1]), cash_pct: +m[2], months: +m[3], monthly: num(m[4]), rate_pct: +m[5].replace(",", "."), mil_per_year: num(m[6]),
      note: "Leaves a balloon (restskuld) at the end. Performance from 1,99 %. Excl. insurance and service.", source_name: "kostnader.se (cites Tesla)", source_url: kost.url, fetched_at: NOW });
  } else financing = (prev.financing || []).map((f) => Object.assign({}, f, { stale: true }));

  // curated incentives, re-verified
  const cur = JSON.parse(readFileSync(join(ROOT, "scripts", "curated.json"), "utf8"));
  const incentives = cur.incentives.map((i) => {
    let ok = false, st = 0; try { const r = get(i.source_url); st = r.status; ok = r.status === 200 && text(r.body).includes(i.verify); } catch (e) {}
    return Object.assign({}, i, { verified: ok, checked_at: NOW, http: st });
  });
  return {
    generated_at: NOW, variants: out, financing, incentives,
    delivery: { available: false, note: "Tesla's own site (where delivery estimates live) blocks automated requests, so no delivery estimate is fetched. Check the design studio.", url: "https://www.tesla.com/sv_se/modely/design" },
    sources,
  };
}

// ---------------------------------------------------------------- lease
async function fetchLease(prev, kostCache) {
  const sources = [], offers = [];
  const keep = (re) => (prev.offers || []).filter((o) => re.test(o.source_url)).map((o) => Object.assign({}, o, { stale: true }));

  // 1. Tesla privatleasing — Tesla blocked; read via kostnader.se (rendered) and leasabil.com (static)
  const kost = { name: "kostnader.se — Tesla privatleasing", url: "https://kostnader.se/bil/tesla-model-y-kostnad" };
  try {
    const t = kostCache || await renderText(kost.url);
    const i0 = t.indexOf("Privatleasing hos Tesla"); if (i0 < 0) throw new Error("section 'Privatleasing hos Tesla' not found");
    const blk = t.slice(i0, t.indexOf("Teslas restvärdeslån", i0));
    const terms = blk.match(/([\d ]+) kr i handpenning, (\d+) månader, ([\d ]+) mil per år/);
    if (!terms) throw new Error("lease terms not found");
    let n = 0;
    for (const [id, label, re] of [["RWD", "Model Y RWD", /Model Y, bakhjulsdrift\s*\n?\s*([\d ]+) kr\/mån/], ["LR_RWD", "Model Y Premium Long Range RWD", /Premium Long Range, bakhjulsdrift\s*\n?\s*([\d ]+) kr\/mån/],
      ["LR_AWD", "Model Y Premium Long Range AWD", /Premium Long Range, fyrhjulsdrift\s*\n?\s*([\d ]+) kr\/mån/], ["PERF", "Model Y Performance AWD", /Performance, fyrhjulsdrift\s*\n?\s*([\d ]+) kr\/mån/]]) {
      const m = blk.match(re); if (!m) continue;
      offers.push({ id: "tesla-" + id, provider: "Tesla", variant: id, name: label, condition: "new", year: null, monthly: num(m[1]), term_months: +terms[2],
        km_per_year: num(terms[3]) * 10, down_payment: num(terms[1]), down_payment_note: "förhöjd första hyra / handpenning",
        includes: ["service"], url: "https://www.tesla.com/sv_se/modely/design", source_name: "kostnader.se (cites Tesla)", source_url: kost.url, fetched_at: NOW });
      n++;
    }
    sources.push(Object.assign(kost, { status: n ? "ok" : "failed", count: n, fetched_at: NOW }));
  } catch (e) { sources.push(Object.assign(kost, { status: "failed", error: e.message, fetched_at: NOW })); offers.push(...keep(/kostnader\.se/)); }

  const lb = { name: "Leasa Bil (leasabil.com) — Tesla privatleasing", url: "https://leasabil.com/bilmarken/Tesla/Tesla-Model-Y" };
  try {
    const r = get(lb.url); if (r.status !== 200) throw new Error("HTTP " + r.status);
    const t = text(r.body);
    const setup = num((t.match(/Uppläggningsavgift ([\d ]+) kr/) || [])[1] || 0), inv = num((t.match(/Fakturaavgift ([\d ]+) kr/) || [])[1] || 0);
    const seen = new Set(); let n = 0;
    const main = t.match(/Model Y Standard fr\. ([\d ]+) kr\/mån/);
    const rows = [...t.matchAll(/Tesla Model Y (Long Range AWD|Long Range|Standard|Performance) Elbil (\d+) mån (\d+) mil fr\. ([\d ]+) kr\/mån/g)].map((m) => [m[1], +m[2], +m[3], num(m[4])]);
    if (main) rows.unshift(["Standard", 36, 1000, num(main[1])]);
    for (const [nm, term, mil, monthly] of rows) {
      const id = nm === "Standard" ? "RWD" : nm === "Long Range" ? "LR_RWD" : nm === "Long Range AWD" ? "LR_AWD" : "PERF";
      if (seen.has(id)) continue; seen.add(id);
      // Only add as a separate offer if kostnader.se didn't already give the same Tesla price; otherwise record as confirmation
      const twin = offers.find((o) => o.provider === "Tesla" && o.variant === id);
      if (twin) { (twin.confirmed_by = twin.confirmed_by || []).push({ source_name: "leasabil.com", source_url: lb.url, monthly, fetched_at: NOW });
        if (twin.monthly === monthly) { twin.setup_fee = setup; twin.monthly_fee = inv; twin.fees_source_url = lb.url; } continue; }
      offers.push({ id: "tesla-lb-" + id, provider: "Tesla", variant: id, name: "Model Y " + nm, condition: "new", year: null, monthly, term_months: term, km_per_year: mil * 10,
        down_payment: null, setup_fee: setup, monthly_fee: inv, includes: ["service"], url: "https://www.tesla.com/sv_se/modely/design", source_name: "leasabil.com", source_url: lb.url, fetched_at: NOW });
      n++;
    }
    sources.push(Object.assign(lb, { status: "ok", count: rows.length, setup_fee: setup, invoice_fee: inv, fetched_at: NOW }));
  } catch (e) { sources.push(Object.assign(lb, { status: "failed", error: e.message, fetched_at: NOW })); }

  // 2. GoMore privatleasing (insurance, service, tyres included)
  const gm = { name: "GoMore Leasing", url: "https://gomore.se/leasing/tesla" };
  try {
    const r = get(gm.url); if (r.status !== 200) throw new Error("HTTP " + r.status);
    const links = [...new Set([...r.body.matchAll(/href="(?:https:\/\/gomore\.se)?(\/leasing\/\d+-tesla-model-y[^"]*)"/g)].map((m) => m[1]))];
    const t = text(r.body); let n = 0;
    const rx = /Tesla (Model Y [^0-9]+?) ([\d ]+) SEK per månad(?: SEK [\d ]+)? El(?: Begagnad)? (\d+)(?:-(\d+))? månader · ([\d ]+)km\/år/g;
    let m; const seen = new Set();
    while ((m = rx.exec(t))) {
      const name = m[1].trim(); if (seen.has(name)) continue; seen.add(name);
      const slug = name.toLowerCase().replace(/ /g, "-");
      const link = links.find((l) => l.endsWith(slug)) || null;
      const used = /Begagnad/.test(m[0]);
      offers.push({ id: "gomore-" + slug, provider: "GoMore", variant: R.classifyVariant(name), name: "Tesla " + name, condition: used ? "used" : "new", year: null,
        monthly: num(m[2]), term_months: +(m[4] || m[3]), term_note: m[4] ? `${m[3]}–${m[4]} months` : null, km_per_year: num(m[5]), down_payment: 0,
        down_payment_note: "none listed", includes: ["insurance", "service", "tyres"], url: link ? "https://gomore.se" + link : gm.url, source_name: "GoMore", source_url: gm.url, fetched_at: NOW });
      n++;
    }
    if (!n) throw new Error("no Model Y offers parsed");
    sources.push(Object.assign(gm, { status: "ok", count: n, fetched_at: NOW }));
  } catch (e) { sources.push(Object.assign(gm, { status: "failed", error: e.message, fetched_at: NOW })); offers.push(...keep(/gomore/)); }

  // 3. Blocket leasing ads (Ayvens Release used-car leasing, dealer campaigns) — all of Sweden
  const bl = { name: "Blocket leasing ads", url: blocketSearchUrl([["sales_form", "5"]], 1) };
  try {
    const { docs } = blocketPages([["sales_form", "5"]], 5);
    let n = 0;
    for (const d of docs) {
      const spec = d.model_specification || "", org = d.organisation_name || "";
      if (!(d.price?.amount >= 3500)) { (bl.excluded = bl.excluded || []).push({ url: d.canonical_url, monthly: d.price?.amount, reason: "below 3 500 kr/month — likely a loan instalment or ex-VAT teaser, not a lease price" }); continue; }
      const ayvens = /ayvens/i.test(org);
      const m = spec.match(/(\d{1,2}) ?mån/), ins = spec.match(/(\d[\d ]*)\s?kr insats/);
      const exVat = d.price?.amount_ex_vat;
      offers.push({ id: "blocket-" + d.id, provider: org || "Blocket seller", variant: R.classifyVariant(spec), name: `Tesla Model Y ${spec}`.trim(),
        condition: d.year >= new Date().getFullYear() && !d.mileage ? "new" : "used", year: d.year, km: d.mileage != null ? d.mileage * 10 : null, location: d.location,
        monthly: d.price?.amount, monthly_ex_vat: exVat || null,
        term_months: ayvens ? 24 : m ? +m[1] : null, km_per_year: ayvens ? 10000 : null, down_payment: ayvens ? 0 : ins ? num(ins[1]) : null,
        terms_note: ayvens ? "Ayvens Release Basic: 24 months, 1 000 mil/yr, 0 kr down, cancel after 12 months (from the ad text)" :
          exVat ? "Price shown incl. moms; the ad's headline figure is excl. moms — may be aimed at companies. Check terms in the ad." : "Terms not in the search data — open the ad.",
        includes: [], url: d.canonical_url, source_name: "Blocket", source_url: bl.url, fetched_at: NOW });
      n++;
    }
    sources.push(Object.assign(bl, { status: "ok", count: n, fetched_at: NOW }));
  } catch (e) { sources.push(Object.assign(bl, { status: "failed", error: e.message, fetched_at: NOW })); offers.push(...keep(/blocket/)); }

  for (const [name, url] of [["Tesla privatleasing (direct)", "https://www.tesla.com/sv_se/modely/design#overview"], ["Alleasing", "https://www.alleasing.se/tesla/model-y"]]) {
    let st; try { st = get(url).status; } catch (e) { st = 0; }
    sources.push({ name, url, status: st === 200 ? "reachable, not used" : `blocked (HTTP ${st})`, fetched_at: NOW });
  }
  for (const o of offers) if (o.term_months) o.total_over_term = R.leaseTotal(o);
  return { generated_at: NOW, offers, sources };
}

// ---------------------------------------------------------------- main
(async () => {
  const only = args.only;
  if (!only || only === "used") writeJson("used.json", await fetchUsed(readJson("used.json", {})));
  let kostText = null;
  if (!only || only === "new") {
    const prevNew = readJson("new.json", {});
    const n = await fetchNew(prevNew);
    writeJson("new.json", n);
  }
  if (!only || only === "lease") {
    try { kostText = await renderText("https://kostnader.se/bil/tesla-model-y-kostnad"); } catch (e) { kostText = null; }
    writeJson("lease.json", await fetchLease(readJson("lease.json", {}), kostText));
  }
  const all = ["used.json", "new.json", "lease.json"].flatMap((f) => (readJson(f, {}).sources || []).map((s) => `${f.padEnd(10)} ${String(s.status).padEnd(28)} ${s.name}${s.count != null ? ` (${s.count})` : ""}${s.error ? " — " + s.error : ""}`));
  console.log(all.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
