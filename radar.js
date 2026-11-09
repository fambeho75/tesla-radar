/* Model Y Radar — pure logic (browser global `Radar`, Node module). No DOM here.
   Used by app.js, scripts/fetch-data.mjs and test/radar.test.js. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Radar = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VARIANTS = {
    RWD: { label: "RWD / Standard", short: "RWD" },
    LR_RWD: { label: "Long Range RWD", short: "LR RWD" },
    LR_AWD: { label: "Long Range AWD", short: "LR AWD" },
    PERF: { label: "Performance", short: "Perf" },
    UNKNOWN: { label: "Unknown variant", short: "?" },
  };
  const REGIONS = ["Skåne", "Halland", "Blekinge", "Kronoberg", "Jönköping", "Kalmar", "Västra Götaland", "Östergötland"];

  /** Variant from free text (Blocket "model_specification", Wayke title...). */
  function classifyVariant(text) {
    const t = " " + String(text || "").toLowerCase().replace(/[-_/]/g, " ") + " ";
    if (/perf|\bp\d{2}d\b|534 ?hk|460 ?hk/.test(t)) return "PERF";
    const lr = /long ?range|\blr\b|premium|dual ?motor|\bawd\b|\b4wd\b|fyrhjul|514 ?hk|lång räckvidd|\bawd|\b4x4\b/.test(t);
    const rwdWord = /\brwd\b|bakhjul|rear ?wheel/.test(t);
    if (lr) {
      const awd = /\bawd\b|\b4wd\b|fyrhjul|dual ?motor|514 ?hk|\b4x4\b/.test(t);
      if (rwdWord && !awd) return "LR_RWD";
      if (awd) return "LR_AWD";
      // "Long Range" alone: before 2025 every LR Model Y in Sweden was AWD
      return "LR_AWD";
    }
    if (/standard|\bsr\+?\b|\bstd\b|299 ?hk|347 ?hk/.test(t) || rwdWord) return "RWD";
    return "UNKNOWN";
  }

  /** Juniper (2025 refresh, "nya Model Y") vs legacy vs unclear. Model year 2025 is ambiguous:
      many MY2025 cars were the old model, registered Oct 2024–Feb 2025. The fetcher refines
      these from the first-registration date on the ad page. Returns {gen, sure}. */
  function classifyGeneration(year, text, vin) {
    const t = String(text || "").toLowerCase();
    const vinYear = vin && vin.length === 17 ? vin[9].toUpperCase() : null; // R=2024 S=2025 T=2026
    if (/juniper|highland|nya model y|new model y|facelift|ultra röd|ultra red/.test(t)) return { gen: "juniper", sure: true };
    if (year >= 2026 || vinYear === "T") return { gen: "juniper", sure: true };
    if (year === 2025) {
      if (vinYear === "R" || /gamla|old model|pre.?facelift/.test(t)) return { gen: "legacy", sure: true };
      return { gen: "unclear", sure: false };
    }
    return { gen: "legacy", sure: true };
  }

  // ---------- price model: OLS price ~ age + km + variant + generation ----------
  function featurize(l, refYear) {
    const age = Math.max(0, refYear - l.year);
    return [1, age, l.km / 10000, l.variant === "LR_AWD" ? 1 : 0, l.variant === "LR_RWD" ? 1 : 0,
      l.variant === "PERF" ? 1 : 0, l.gen === "juniper" ? 1 : 0];
  }
  const FEATURES = ["intercept", "age (yr)", "per 10 000 km", "LR AWD", "LR RWD", "Performance", "Juniper"];

  function solve(A, b) { // Gaussian elimination with partial pivoting
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  /** Fit on listings with a known variant. ridge keeps empty dummies (e.g. no Perf in data) solvable. */
  function fitModel(listings, refYear, ridge = 1e-3) {
    const rows = listings.filter((l) => l.variant !== "UNKNOWN" && l.gen !== "unclear" && l.price > 0 && isFinite(l.km) && l.year);
    const k = FEATURES.length;
    if (rows.length < k + 3) return null;
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
    for (const l of rows) {
      const x = featurize(l, refYear);
      for (let i = 0; i < k; i++) { Xty[i] += x[i] * l.price; for (let j = 0; j < k; j++) XtX[i][j] += x[i] * x[j]; }
    }
    for (let i = 1; i < k; i++) XtX[i][i] += ridge * rows.length;
    const beta = solve(XtX, Xty);
    if (!beta) return null;
    const res = rows.map((l) => l.price - dot(beta, featurize(l, refYear)));
    const sd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, rows.length - k));
    const mean = rows.reduce((s, l) => s + l.price, 0) / rows.length;
    const ssTot = rows.reduce((s, l) => s + (l.price - mean) ** 2, 0);
    const r2 = 1 - res.reduce((s, r) => s + r * r, 0) / (ssTot || 1);
    return { beta, refYear, n: rows.length, sd, r2, features: FEATURES };
  }
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  function predict(model, l) {
    const v = l.variant === "UNKNOWN" ? "RWD" : l.variant;
    return dot(model.beta, featurize(Object.assign({}, l, { variant: v }), model.refYear));
  }

  /** Value verdict from % deviation from the fitted price. */
  function verdict(pct) {
    if (pct <= -0.15) return { key: "great", label: "Great value" };
    if (pct <= -0.07) return { key: "good", label: "Good value" };
    if (pct >= 0.10) return { key: "pricey", label: "Pricey" };
    return { key: "fair", label: "Fair" };
  }
  function score(listings, model) {
    return listings.map((l) => {
      if (!model) return Object.assign({}, l, { fit: null, dev: null, verdict: null });
      const fit = predict(model, l), dev = (l.price - fit) / fit;
      return Object.assign({}, l, { fit, dev, verdict: verdict(dev) });
    });
  }

  function filterListings(listings, f) {
    return listings.filter((l) =>
      (!f.variant || f.variant === "all" || (f.variant === "LR" ? /^LR_/.test(l.variant) : l.variant === f.variant)) &&
      (!f.gen || f.gen === "all" || l.gen === f.gen) &&
      (!f.regions || !f.regions.length || f.regions.includes(l.region)) &&
      (!f.maxPrice || l.price <= f.maxPrice) &&
      (!f.maxKm || l.km <= f.maxKm) &&
      (!f.minYear || l.year >= f.minYear));
  }
  function sortListings(list, by) {
    const s = list.slice();
    const k = { value: (l) => (l.dev == null ? 9 : l.dev), price: (l) => l.price, km: (l) => l.km, year: (l) => -l.year }[by] || ((l) => l.price);
    return s.sort((a, b) => k(a) - k(b) || a.price - b.price);
  }
  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }

  // ---------- leasing ----------
  /** Total paid over the contract: down payment + monthly × term + one-off fees + monthly fees × term. */
  function leaseTotal(o) {
    return (o.down_payment || 0) + o.monthly * o.term_months + (o.setup_fee || 0) + (o.monthly_fee || 0) * o.term_months;
  }

  // ---------- total cost of ownership ----------
  const TCO_DEFAULTS = {
    years: 3,
    kmPerYear: 15000,
    interestPct: 5.0,          // loan rate / lost return on the money tied up in the car
    usedDepPct: 11,            // per year, used Model Y
    newDepY1Pct: 20,           // first year, new car
    newDepPct: 11,             // following years
    kwhPer100: 17,             // incl. charging losses
    elPrice: 1.60,             // kr/kWh home charging, all-in
    insuranceUsed: 650,        // kr/month helförsäkring
    insuranceNew: 750,
    serviceTyresUsed: 5000,    // kr/yr: tyres, wipers, service, MOT
    serviceTyresNew: 2500,
    vehicleTax: 360,           // kr/yr fordonsskatt (sourced: jamforbilar.se)
    excessKmFee: 2.5,          // kr/km above lease allowance
  };

  function ownCost(price, residualFrac, a) {
    const resale = price * residualFrac;
    const interest = ((price + resale) / 2) * (a.interestPct / 100) * a.years;
    return { depreciation: price - resale, resale, interest };
  }
  function running(a, isNew, inc) {
    inc = inc || {};
    const energy = (a.kmPerYear / 100) * a.kwhPer100 * a.elPrice * a.years;
    const insurance = inc.insurance ? 0 : (isNew ? a.insuranceNew : a.insuranceUsed) * 12 * a.years;
    const service = inc.service ? (inc.tyres ? 0 : 1500 * a.years) : (isNew ? a.serviceTyresNew : a.serviceTyresUsed) * a.years;
    const tax = a.vehicleTax * a.years;
    return { energy, insurance, service, tax };
  }
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

  function tcoUsed(price, ageYears, a) {
    const r = Math.pow(1 - a.usedDepPct / 100, a.years);
    const own = ownCost(price, r, a);
    const lines = Object.assign({ depreciation: own.depreciation, interest: own.interest }, running(a, ageYears < 1));
    return { kind: "used", lines, total: sum(lines), resale: own.resale, perMonth: sum(lines) / (a.years * 12) };
  }
  function tcoNew(price, a) {
    const r = (1 - a.newDepY1Pct / 100) * Math.pow(1 - a.newDepPct / 100, Math.max(0, a.years - 1));
    const own = ownCost(price, r, a);
    const lines = Object.assign({ depreciation: own.depreciation, interest: own.interest }, running(a, true));
    return { kind: "new", lines, total: sum(lines), resale: own.resale, perMonth: sum(lines) / (a.years * 12) };
  }
  /** Lease over a.years: contracts shorter than the period are assumed renewed at the same price. */
  function tcoLease(o, a) {
    const months = a.years * 12;
    const contracts = Math.ceil(months / o.term_months);
    const down = (o.down_payment || 0) * contracts + (o.setup_fee || 0) * contracts;
    const monthly = (o.monthly + (o.monthly_fee || 0)) * months;
    const allowance = o.km_per_year || 0;
    const excess = allowance ? Math.max(0, a.kmPerYear - allowance) * a.years * a.excessKmFee : 0;
    const inc = { insurance: (o.includes || []).includes("insurance"), service: (o.includes || []).includes("service"), tyres: (o.includes || []).includes("tyres") };
    const run = running(a, o.condition !== "used", inc);
    const lines = Object.assign({ leasing: down + monthly, excessKm: excess }, run);
    return { kind: "lease", lines, total: sum(lines), perMonth: sum(lines) / months, contracts };
  }

  return { VARIANTS, REGIONS, classifyVariant, classifyGeneration, fitModel, predict, score, verdict, filterListings,
    sortListings, median, leaseTotal, TCO_DEFAULTS, tcoUsed, tcoNew, tcoLease };
});
