// node test/radar.test.js — unit checks for radar.js (pure logic) + sanity of the data snapshot.
const assert = require("assert");
const R = require("../radar.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("variant classification", () => {
  const c = R.classifyVariant;
  assert.strictEqual(c("Long Range AWD 514hk Drag"), "LR_AWD");
  assert.strictEqual(c("Standard Range 299hk RWD"), "RWD");
  assert.strictEqual(c("RWD Pano Drag"), "RWD");
  assert.strictEqual(c("Performance 534hk Drag MOMS"), "PERF");
  assert.strictEqual(c("AWD Performance MOMS Värmepump"), "PERF");
  assert.strictEqual(c("Premium Long Range RWD"), "LR_RWD");
  assert.strictEqual(c("Premium LR AWD fr. 9995kr/mån"), "LR_AWD");
  assert.strictEqual(c("Long Range Pano Värmepump"), "LR_AWD");
  assert.strictEqual(c("Dual Motor"), "LR_AWD");
  assert.strictEqual(c("1-Ägare Panorama Helskinn"), "UNKNOWN");
});

t("generation classification", () => {
  const g = R.classifyGeneration;
  assert.deepStrictEqual(g(2023, "Long Range"), { gen: "legacy", sure: true });
  assert.deepStrictEqual(g(2026, ""), { gen: "juniper", sure: true });
  assert.strictEqual(g(2025, "LR AWD Ultra Röd").gen, "juniper");
  assert.strictEqual(g(2025, "Long Range", "XP7YGCEL8RB459003").gen, "legacy"); // VIN year R = 2024
  assert.strictEqual(g(2025, "Long Range", null).gen, "unclear");
  assert.strictEqual(g(2025, "nya Model Y Premium").gen, "juniper");
});

// synthetic market with a known price law → fit must recover it
function market() {
  const out = []; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const V = { RWD: 0, LR_AWD: 50000, LR_RWD: 25000, PERF: 80000 };
  for (let i = 0; i < 300; i++) {
    const variant = Object.keys(V)[i % 4], year = 2021 + (i % 5), kmv = Math.round(rnd() * 180000);
    const gen = year >= 2025 && i % 2 ? "juniper" : "legacy";
    const price = 520000 - 15000 * (2027 - year) - 12000 * (kmv / 10000) + V[variant] + (gen === "juniper" ? 60000 : 0) + (rnd() - 0.5) * 10000;
    out.push({ id: "s" + i, variant, year, km: kmv, gen, price });
  }
  return out;
}
t("price model recovers known coefficients", () => {
  const m = R.fitModel(market(), 2027);
  assert.ok(m && m.n === 300);
  const [b0, age, km10, lr, lrr, perf, jun] = m.beta;
  assert.ok(Math.abs(age + 15000) < 1500, "age " + age);
  assert.ok(Math.abs(km10 + 12000) < 800, "km " + km10);
  assert.ok(Math.abs(lr - 50000) < 4000 && Math.abs(lrr - 25000) < 4000 && Math.abs(perf - 80000) < 4000, "variant dummies");
  assert.ok(Math.abs(jun - 60000) < 5000, "juniper " + jun);
  assert.ok(m.r2 > 0.97, "r2 " + m.r2);
});
t("fit skips unknown/unclear and needs enough rows", () => {
  assert.strictEqual(R.fitModel(market().slice(0, 5), 2027), null);
  const m = R.fitModel(market().concat([{ id: "u", variant: "UNKNOWN", year: 2023, km: 1, gen: "legacy", price: 1 }, { id: "c", variant: "RWD", year: 2025, km: 1, gen: "unclear", price: 1 }]), 2027);
  assert.strictEqual(m.n, 300);
});
t("value scoring and verdicts", () => {
  const mk = market(); const m = R.fitModel(mk, 2027);
  const cheap = { id: "x", variant: "LR_AWD", year: 2023, km: 80000, gen: "legacy" };
  const fair = R.predict(m, cheap);
  const s = R.score([Object.assign({}, cheap, { price: fair * 0.8 }), Object.assign({}, cheap, { id: "y", price: fair * 0.92 }), Object.assign({}, cheap, { id: "z", price: fair * 1.12 }), Object.assign({}, cheap, { id: "w", price: fair })], m);
  assert.deepStrictEqual(s.map((l) => l.verdict.key), ["great", "good", "pricey", "fair"]);
  assert.ok(Math.abs(s[0].dev + 0.2) < 1e-9);
  assert.deepStrictEqual(R.sortListings(s, "value").map((l) => l.id), ["x", "y", "w", "z"]);
  assert.strictEqual(R.verdict(-0.07).key, "good"); assert.strictEqual(R.verdict(-0.069).key, "fair");
});
t("filters", () => {
  const L = [{ id: 1, variant: "RWD", gen: "legacy", region: "Skåne", price: 300000, km: 50000, year: 2022 },
    { id: 2, variant: "LR_AWD", gen: "juniper", region: "Halland", price: 600000, km: 20000, year: 2025 },
    { id: 3, variant: "LR_RWD", gen: "legacy", region: "Skåne", price: 400000, km: 150000, year: 2023 }];
  const ids = (f) => R.filterListings(L, f).map((l) => l.id);
  assert.deepStrictEqual(ids({ variant: "LR" }), [2, 3]);
  assert.deepStrictEqual(ids({ gen: "juniper" }), [2]);
  assert.deepStrictEqual(ids({ regions: ["Skåne"] }), [1, 3]);
  assert.deepStrictEqual(ids({ maxPrice: 400000, maxKm: 100000 }), [1]);
  assert.deepStrictEqual(ids({ variant: "all", gen: "all", regions: [] }), [1, 2, 3]);
  assert.strictEqual(R.median([3, 1, 2]), 2); assert.strictEqual(R.median([4, 1, 2, 3]), 2.5);
});
t("lease total over term", () => {
  assert.strictEqual(R.leaseTotal({ monthly: 4595, term_months: 36, down_payment: 30000, setup_fee: 695, monthly_fee: 60 }), 30000 + 4595 * 36 + 695 + 60 * 36);
  assert.strictEqual(R.leaseTotal({ monthly: 7190, term_months: 36, down_payment: 0 }), 258840);
});
t("TCO: new car", () => {
  const a = Object.assign({}, R.TCO_DEFAULTS, { years: 3, kmPerYear: 15000 });
  const r = R.tcoNew(500000, a);
  const resale = 500000 * 0.8 * 0.89 * 0.89;
  assert.ok(Math.abs(r.resale - resale) < 1e-6);
  assert.ok(Math.abs(r.lines.depreciation - (500000 - resale)) < 1e-6);
  assert.ok(Math.abs(r.lines.interest - ((500000 + resale) / 2) * 0.05 * 3) < 1e-6);
  assert.ok(Math.abs(r.lines.energy - 150 * 17 * 1.6 * 3) < 1e-6);
  assert.strictEqual(r.lines.insurance, 750 * 36); assert.strictEqual(r.lines.tax, 1080);
  assert.ok(Math.abs(r.total - Object.values(r.lines).reduce((s, v) => s + v, 0)) < 1e-6);
  assert.ok(Math.abs(r.perMonth - r.total / 36) < 1e-6);
});
t("TCO: used car depreciates per year", () => {
  const a = Object.assign({}, R.TCO_DEFAULTS, { years: 2 });
  const r = R.tcoUsed(300000, 3, a);
  assert.ok(Math.abs(r.resale - 300000 * 0.89 * 0.89) < 1e-6);
  assert.strictEqual(r.lines.insurance, 650 * 24); assert.strictEqual(r.lines.service, 5000 * 2);
});
t("TCO: lease — excess km, included items, renewal", () => {
  const a = Object.assign({}, R.TCO_DEFAULTS, { years: 3, kmPerYear: 15000 });
  const tesla = { monthly: 4595, term_months: 36, km_per_year: 10000, down_payment: 30000, setup_fee: 695, monthly_fee: 60, includes: ["service"], condition: "new" };
  const r = R.tcoLease(tesla, a);
  assert.strictEqual(r.lines.leasing, 30000 + 695 + (4595 + 60) * 36);
  assert.strictEqual(r.lines.excessKm, 5000 * 3 * 2.5);
  assert.strictEqual(r.lines.insurance, 750 * 36);
  assert.strictEqual(r.lines.service, 1500 * 3); // service included, tyres not
  const gm = R.tcoLease({ monthly: 7590, term_months: 24, km_per_year: 10000, down_payment: 0, includes: ["insurance", "service", "tyres"] }, a);
  assert.strictEqual(gm.contracts, 2);
  assert.strictEqual(gm.lines.leasing, 7590 * 36);
  assert.strictEqual(gm.lines.insurance, 0); assert.strictEqual(gm.lines.service, 0);
  const noExcess = R.tcoLease(tesla, Object.assign({}, a, { kmPerYear: 8000 }));
  assert.strictEqual(noExcess.lines.excessKm, 0);
});

// ---- snapshot sanity: every price has a source URL + fetch date
t("data snapshot is complete and sourced", () => {
  const fs = require("fs"), path = require("path");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", f), "utf8"));
  const u = rd("used.json"), nw = rd("new.json"), l = rd("lease.json");
  for (const d of [u, nw, l]) assert.ok(!isNaN(Date.parse(d.generated_at)), "generated_at");
  assert.ok(u.listings.length >= 20, "listings " + u.listings.length);
  for (const x of u.listings) {
    assert.ok(/^https:\/\/(www\.)?(blocket|wayke)\.se\//.test(x.url), "listing url " + x.url);
    assert.ok(x.price >= 100000 && x.price < 2e6 && x.km >= 0 && x.year >= 2020, "listing values " + x.id);
    assert.ok(R.REGIONS.includes(x.region), "region " + x.region);
  }
  assert.strictEqual(new Set(u.listings.map((x) => x.id)).size, u.listings.length, "unique ids");
  assert.ok(nw.variants.length >= 3);
  for (const v of nw.variants) for (const p of v.prices) assert.ok(p.source_url && p.fetched_at && p.price > 300000, "new price sourced");
  assert.ok(l.offers.length >= 3);
  for (const o of l.offers) assert.ok(o.source_url && o.fetched_at && o.url && o.monthly > 1000, "lease sourced " + o.id);
  for (const s of [].concat(u.sources, nw.sources, l.sources)) assert.ok(s.name && s.url && s.status, "source entry");
});
console.log(`all ${n} radar tests passed`);
