/* Tesla Radar — UI. Plain JS, no build step. Data comes from data/*.json (made by scripts/fetch-data.mjs). */
(function () {
  "use strict";
  const R = window.Radar;
  const TZ = "Europe/Stockholm";
  const LS_UI = "myradar-ui", LS_TCO = "myradar-tco", LS_THEME = "myradar-theme";
  const app = document.getElementById("app");

  // ---------- formatting ----------
  const nf = (d) => new Intl.NumberFormat("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = nf(0), f1 = nf(1);
  const kr = (v) => (v == null || !isFinite(v) ? "–" : `${f0.format(Math.round(v))} kr`);
  const tkr = (v) => `${f0.format(Math.round(v / 1000))}k`;
  const km = (v) => `${f0.format(Math.round(v))} km`;
  const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${f0.format(Math.abs(v * 100))} %`;
  const dfmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const dtfmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const date = (iso) => (iso ? dfmt.format(new Date(iso)) : "–");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
  const daysOld = (iso) => (Date.now() - Date.parse(iso)) / 86400000;

  // ---------- storage ----------
  const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const UI_DEFAULTS = { tab: "used", variant: "all", gen: "all", regions: [], maxPrice: 0, maxKm: 0, sort: "value", chart: "km",
    budget: 250000, showAll: false, leaseKind: "all", cmpUsed: null, cmpNew: "RWD", cmpLease: null };
  const ui = Object.assign({}, UI_DEFAULTS, load(LS_UI, {}));
  ui.sel = null; ui.showAll = false;
  let tco = Object.assign({}, R.TCO_DEFAULTS, load(LS_TCO, {}));
  const persist = () => { const { sel, showAll, ...rest } = ui; save(LS_UI, rest); };

  const data = { used: null, new: null, lease: null };
  const status = { state: "loading", error: null };
  let scored = [], model = null;

  async function loadData() {
    status.state = "loading"; render();
    try {
      const get = (f) => fetch(`data/${f}.json?t=${Math.floor(Date.now() / 600000)}`, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`); return r.json();
      });
      const [u, n, l] = await Promise.all([get("used"), get("new"), get("lease")]);
      Object.assign(data, { used: u, new: n, lease: l });
      model = R.fitModel(u.listings, (u.model && u.model.refYear) || new Date().getFullYear() + 1);
      scored = R.score(u.listings, model);
      status.state = "ok";
    } catch (e) {
      status.state = "error"; status.error = e.message;
    }
    render();
  }

  // ---------- icons ----------
  const ICON_SUN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z" fill="currentColor"/></svg>';
  const ICON_REFRESH = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>';
  const LOGO = '<img src="icon-rounded.svg?v=1" width="40" height="40" alt="">';

  // ---------- shared bits ----------
  function header() {
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    return `<header class="top">
      <div class="logo">${LOGO}</div>
      <div class="title"><h1>Tesla Radar</h1><p>Tesla Model Y in Sweden · used · new · leasing</p></div>
      <button class="icon-btn" data-action="reload" aria-label="Reload data">${ICON_REFRESH}</button>
      <button class="icon-btn" data-action="theme" aria-label="${dark ? "Switch to light mode" : "Switch to dark mode"}">${dark ? ICON_SUN : ICON_MOON}</button>
    </header>`;
  }
  function tabs() {
    const t = [["used", "Used"], ["new", "New"], ["lease", "Leasing"], ["compare", "Compare"]];
    return `<nav class="tabs" role="tablist">${t.map(([k, l]) =>
      `<button role="tab" data-action="tab" data-val="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join("")}</nav>`;
  }
  function seg(name, opts, value) {
    return `<div class="seg" role="group">${opts.map(([v, label]) =>
      `<button data-action="set" data-key="${name}" data-val="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join("")}</div>`;
  }
  const src = (name, url, at, extra) => `<span class="src">Source: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(name || host(url))}</a> · fetched ${date(at)}${extra ? " · " + extra : ""}</span>`;
  const staleBadge = (o) => (o && o.stale ? ' <span class="badge stale">stale</span>' : "");
  const genLabel = (l) => (l.gen === "juniper" ? "Juniper" : l.gen === "unclear" ? "Gen?" : "");
  const variantShort = (v) => (R.VARIANTS[v] || R.VARIANTS.UNKNOWN).short;

  function banner() {
    if (status.state === "error") return `<div class="banner error" role="alert"><strong>Couldn't load the data snapshot.</strong> ${esc(status.error)}
      <button class="btn small" data-action="reload">Try again</button></div>`;
    if (status.state !== "ok") return "";
    const age = daysOld(data.used.generated_at);
    if (age > 3) return `<div class="banner warn">The snapshot is ${f0.format(age)} days old (${date(data.used.generated_at)}). Prices may have changed — run the fetcher to refresh.</div>`;
    return "";
  }

  // ---------- USED ----------
  function filtered() {
    return R.filterListings(scored, { variant: ui.variant, gen: ui.gen, regions: ui.regions, maxPrice: ui.maxPrice, maxKm: ui.maxKm });
  }
  function usedSummary(list) {
    const prices = list.map((l) => l.price);
    const cheapest = list[0] ? list.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const best = R.sortListings(list.filter((l) => l.dev != null), "value")[0];
    const bsrc = (data.used.sources || []).filter((s) => s.status === "ok").map((s) => s.name).join(" + ");
    return `<section class="card" data-test="used-summary">
      <div class="row between"><h2>Used Model Y · southern Sweden</h2><span class="faint">${date(data.used.generated_at)}</span></div>
      <div class="big"><span data-test="used-count">${list.length}</span> <small>cars match · of ${scored.length}</small></div>
      <div class="stats two">
        <div><span class="faint">Cheapest</span><b>${cheapest ? kr(cheapest.price) : "–"}</b><span class="muted">${cheapest ? cheapest.year + " · " + tkr(cheapest.km) + " km" : ""}</span></div>
        <div><span class="faint">Median</span><b data-test="median">${kr(R.median(prices))}</b><span class="muted">asking price</span></div>
      </div>
      ${best ? `<p class="muted">Best value vs the price model: <a href="${esc(best.url)}" target="_blank" rel="noopener">${esc(best.year)} ${esc(variantShort(best.variant))}, ${tkr(best.km)} km, ${kr(best.price)}</a> <span class="dev-neg">${pct(best.dev)}</span></p>` : ""}
      <p class="faint">${esc(bsrc)} · regions: ${esc((data.used.regions || []).join(", "))}</p>
    </section>`;
  }
  function usedFilters() {
    const regions = data.used.regions || R.REGIONS;
    return `<section class="card" data-test="filters">
      <div class="flabel">Variant</div>
      ${seg("variant", [["all", "All"], ["RWD", "RWD"], ["LR", "Long Range"], ["PERF", "Performance"]], ui.variant)}
      <div class="flabel">Generation</div>
      ${seg("gen", [["all", "All"], ["juniper", "Juniper (2025+)"], ["legacy", "Older"]], ui.gen)}
      <div class="flabel">Region</div>
      <div class="chips">${regions.map((r) => `<button class="chip" data-action="region" data-val="${esc(r)}" aria-pressed="${ui.regions.includes(r)}">${esc(r)}</button>`).join("")}</div>
      <div class="inputs">
        <label>Max price (kr)<input type="number" inputmode="numeric" step="10000" min="0" placeholder="any" value="${ui.maxPrice || ""}" data-ui="maxPrice"></label>
        <label>Max km<input type="number" inputmode="numeric" step="10000" min="0" placeholder="any" value="${ui.maxKm || ""}" data-ui="maxKm"></label>
      </div>
    </section>`;
  }
  const niceStep = (span, target) => { const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw); };

  function usedChart(list) {
    const W = 420, H = 300, L = 40, Rr = 8, T = 12, B = 26;
    if (!list.length) return `<section class="card"><h2>Price map</h2><div class="readout">No cars match the filters.</div></section>`;
    const byKm = ui.chart === "km";
    const prices = list.map((l) => l.price);
    const pmin = Math.min(...prices), pmax = Math.max(...prices);
    const ps = niceStep(pmax - pmin || 1, 5), y0 = Math.floor(pmin / ps) * ps, y1 = Math.ceil(pmax / ps) * ps;
    const y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
    let xmin, xmax, x;
    if (byKm) {
      xmin = 0; const kmax = Math.max(...list.map((l) => l.km)); const xs = niceStep(kmax || 1, 5); xmax = Math.ceil(kmax / xs) * xs || xs;
      x = (l) => L + (W - L - Rr) * (l.km - xmin) / (xmax - xmin);
    } else {
      xmin = Math.min(...list.map((l) => l.year)) - 0.5; xmax = Math.max(...list.map((l) => l.year)) + 0.5;
      const vo = { RWD: -0.27, LR_RWD: -0.09, LR_AWD: 0.09, PERF: 0.27, UNKNOWN: 0 };
      x = (l) => L + (W - L - Rr) * (l.year + (vo[l.variant] || 0) + jitter(l.id) * 0.06 - xmin) / (xmax - xmin);
    }
    let g = "";
    for (let v = y0; v <= y1 + 1; v += ps) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${tkr(v)}</text>`;
    if (byKm) {
      const xs = niceStep(xmax, 5);
      for (let v = 0; v <= xmax; v += xs) g += `<text x="${L + (W - L - Rr) * v / xmax}" y="${H - 9}" class="ax" text-anchor="${v === 0 ? "start" : v + xs > xmax ? "end" : "middle"}">${v ? tkr(v) : "0 km"}</text>`;
    } else {
      for (let yr = Math.ceil(xmin); yr <= xmax; yr++) g += `<text x="${L + (W - L - Rr) * (yr - xmin) / (xmax - xmin)}" y="${H - 9}" class="ax" text-anchor="middle">${yr}</text>`;
    }
    // fitted price lines (km chart): per variant shown, at that group's median model year
    if (byKm && model) {
      const groups = {};
      list.forEach((l) => { if (l.variant !== "UNKNOWN" && l.gen !== "unclear") (groups[l.variant + "|" + l.gen] = groups[l.variant + "|" + l.gen] || []).push(l); });
      Object.entries(groups).filter(([, a]) => a.length >= 4).forEach(([k, a]) => {
        const [variant, gen] = k.split("|"), year = Math.round(R.median(a.map((l) => l.year)));
        const k0 = Math.min(...a.map((l) => l.km)), k1 = Math.max(...a.map((l) => l.km));
        const p0 = R.predict(model, { variant, gen, year, km: k0 }), p1 = R.predict(model, { variant, gen, year, km: k1 });
        g += `<line class="fit c-${variant}" x1="${x({ km: k0 })}" y1="${y(p0)}" x2="${x({ km: k1 })}" y2="${y(p1)}"><title>Fitted price, ${variant} ${gen} ${year}</title></line>`;
      });
    }
    let pts = "";
    const order = list.slice().sort((a, b) => (a.id === ui.sel) - (b.id === ui.sel));
    for (const l of order) {
      const cls = `pt c-${l.variant}${l.gen === "juniper" ? " jun" : ""}${ui.sel === l.id ? " sel" : ""}`;
      const r = l.verdict && (l.verdict.key === "great" || l.verdict.key === "good") ? 5.5 : 3.8;
      pts += `<circle class="${cls}" cx="${x(l).toFixed(1)}" cy="${y(l.price).toFixed(1)}" r="${ui.sel === l.id ? 7 : r}" data-action="pick" data-id="${esc(l.id)}"/>`;
    }
    const sel = list.find((l) => l.id === ui.sel);
    const readout = sel
      ? `<b>${esc(sel.year)} ${esc(variantShort(sel.variant))}${sel.gen === "juniper" ? " · Juniper" : ""}</b> · ${km(sel.km)} · ${esc(sel.location)} · <b>${kr(sel.price)}</b>
         ${sel.dev != null ? ` · model ${kr(sel.fit)} <span class="${sel.dev < 0 ? "dev-neg" : "dev-pos"}">${pct(sel.dev)}</span>` : ""}
         · <a href="${esc(sel.url)}" target="_blank" rel="noopener">Open ad on ${esc(sel.source)} ↗</a>`
      : "Tap a dot for the car. Bigger dots = priced below the fitted model.";
    const vs = [...new Set(list.map((l) => l.variant))];
    return `<section class="card">
      <div class="row between wrap gap"><h2>Price map</h2>${seg("chart", [["km", "vs km"], ["year", "vs model year"]], ui.chart)}</div>
      <p class="readout" data-test="readout">${readout}</p>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Asking price versus ${byKm ? "mileage" : "model year"}" data-test="chart">${g}${pts}</svg>
      <div class="legend">${vs.map((v) => `<span><i class="dot bg-${v}"></i>${esc((R.VARIANTS[v] || R.VARIANTS.UNKNOWN).label)}</span>`).join("")}
        <span><i class="dot ring"></i>Juniper</span>${byKm && model ? `<span>— fitted price</span>` : ""}</div>
      ${model ? `<p class="faint">Price model (least squares on ${model.n} cars, R² ${f1.format(model.r2 * 100)} %): each year older ≈ ${kr(-model.beta[1])}, each 10 000 km ≈ ${kr(-model.beta[2])},
        Juniper ≈ +${kr(model.beta[6])}, Performance ≈ +${kr(model.beta[5])}, LR AWD ≈ +${kr(model.beta[3])} vs RWD. "Good value" = 7 %+ below the model, "Great" = 15 %+ (check why: damage, import, high km…).</p>` : ""}
    </section>`;
  }
  let jit = {};
  function jitter(id) { if (!(id in jit)) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; jit[id] = ((h >>> 0) % 1000) / 500 - 1; } return jit[id]; }

  function usedList(list) {
    const sorted = R.sortListings(list, ui.sort);
    const shown = ui.showAll ? sorted : sorted.slice(0, 25);
    return `<section class="card">
      <div class="row between wrap gap"><h2>Listings</h2>${seg("sort", [["value", "Best value"], ["price", "Price"], ["km", "Km"], ["year", "Newest"]], ui.sort)}</div>
      <ul class="list" data-test="listings">${shown.map((l) => `<li><a class="item" href="${esc(l.url)}" target="_blank" rel="noopener" data-test="listing">
        <span class="t">${esc(l.year)} ${esc(variantShort(l.variant))} ${l.gen === "juniper" ? '<span class="badge jun">Juniper</span>' : l.gen === "unclear" ? '<span class="badge" title="Model year 2025: old or new generation">Gen?</span>' : ""}${staleBadge(l)}</span>
        <span class="p">${kr(l.price)}</span>
        <span class="m">${km(l.km)} · ${esc(l.location)}, ${esc(l.region)} · ${esc(l.seller)}${l.also ? " · also on " + l.also.map((a) => esc(a.source)).join(", ") : ""}<br><span class="faint">${esc(l.spec).slice(0, 70)} · ${esc(l.source)}</span></span>
        <span class="d">${l.verdict ? `<span class="badge ${l.verdict.key}">${l.verdict.label}</span><br><span class="${l.dev < 0 ? "dev-neg" : "dev-pos"}">${pct(l.dev)}</span>` : ""}</span>
      </a></li>`).join("")}</ul>
      ${sorted.length > shown.length ? `<button class="btn small mt" data-action="show-all">Show all ${sorted.length}</button>` : ""}
      ${(data.used.excluded || []).length ? `<p class="faint">${data.used.excluded.length} ad(s) left out: ${data.used.excluded.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener">${kr(e.price)}</a> (${esc(e.reason)})`).join("; ")}.</p>` : ""}
    </section>`;
  }
  function usedTab() {
    const list = filtered();
    return `<div class="cols"><div class="col">${usedSummary(list)}${usedFilters()}${usedChart(list)}</div><div class="col">${usedList(list)}</div></div>`;
  }

  // ---------- NEW ----------
  function newTab() {
    const n = data.new;
    const vrows = n.variants.map((v) => `<div class="vrow" data-test="new-variant">
      <div><h3>${esc(v.name)}</h3><span class="muted">${v.range_km ? f0.format(v.range_km) + " km WLTP" : ""}${v.agree && v.prices.length > 1 ? ` · <span class="badge">${v.prices.length} sources agree</span>` : ""}</span></div>
      <div class="p">${kr(v.price)}</div>
      ${v.prices.map((p) => src(p.source_name, p.source_url, p.fetched_at, (p.source_updated ? "page dated " + esc(p.source_updated) : "") + (p.stale ? " · stale" : "") + (p.price !== v.price ? " · says " + kr(p.price) : ""))).join("")}
    </div>`).join("");
    const fin = (n.financing || []).map((f) => `<div class="vrow"><div><h3>${esc(f.name)}</h3><span class="muted">${kr(f.cash)} (${f.cash_pct} %) down · ${f.months} months · ${f1.format(f.rate_pct)} % · ${f0.format(f.mil_per_year)} mil/yr</span>
      <p class="faint">${esc(f.note)}</p></div><div class="p">${kr(f.monthly)}<small class="muted">/mo</small></div>${src(f.source_name, f.source_url, f.fetched_at)}</div>`).join("");
    const inc = (n.incentives || []).map((i) => `<div class="vrow"><div><h3>${esc(i.title)}</h3><p class="muted">${esc(i.text)}</p></div><div></div>
      <span class="src">Source: <a href="${esc(i.source_url)}" target="_blank" rel="noopener">${esc(i.source_name)}</a>${i.published ? " · published " + esc(i.published) : ""} · ${i.verified ? "re-checked " + date(i.checked_at) : "<b>could not re-check " + date(i.checked_at) + "</b>"}</span></div>`).join("");
    const blocked = (n.sources || []).filter((s) => /blocked/.test(s.status));
    return `<div class="cols"><div class="col">
      <section class="card" data-test="new-card"><div class="row between"><h2>New from Tesla Sverige</h2><span class="faint">cash price incl. moms</span></div>
        ${vrows}
        <p class="faint">Base price without options (tow bar, wheels, paint). ${blocked.length ? "tesla.com blocks automated requests, so prices are read from sites that track Tesla's price list." : ""}
          <a href="https://www.tesla.com/sv_se/modely/design" target="_blank" rel="noopener">Configure on tesla.com ↗</a></p>
      </section>
      <section class="card"><h2>Delivery estimate</h2><p class="muted">${esc(n.delivery.note)}</p><p><a class="btn small" href="${esc(n.delivery.url)}" target="_blank" rel="noopener">Open the design studio ↗</a></p></section>
    </div><div class="col">
      <section class="card"><h2>Incentives &amp; campaigns</h2>${inc || '<p class="muted">None found.</p>'}</section>
      <section class="card"><h2>Tesla financing</h2>${fin || '<p class="muted">No financing offer in the snapshot.</p>'}</section>
    </div></div>`;
  }

  // ---------- LEASE ----------
  const INC = { insurance: "Insurance", service: "Service", tyres: "Tyres" };
  function leaseRow(o) {
    const total = o.total_over_term;
    return `<div class="vrow" data-test="lease-offer">
      <div><h3>${esc(o.provider)} · ${esc(o.name.replace(/^Tesla /, ""))}${staleBadge(o)}</h3>
        <span class="muted">${o.condition === "used" ? `Used${o.year ? " " + o.year : ""}${o.km ? ", " + km(o.km) : ""}` : "New"}${o.term_months ? ` · ${o.term_note || o.term_months + " mo"}` : ""}${o.km_per_year ? ` · ${f0.format(o.km_per_year / 10)} mil/yr` : ""}
        · ${o.down_payment == null ? "down payment: see offer" : o.down_payment ? kr(o.down_payment) + " down" : "0 kr down"}${o.setup_fee ? ` · fees ${kr(o.setup_fee)} + ${kr(o.monthly_fee)}/mo` : ""}${o.location ? " · " + esc(o.location) : ""}</span>
        <div class="incl">${(o.includes || []).map((i) => `<span class="badge good">${INC[i] || esc(i)} incl.</span>`).join("")}</div>
        ${o.terms_note ? `<p class="faint">${esc(o.terms_note)}</p>` : ""}</div>
      <div class="p">${kr(o.monthly)}<small class="muted">/mo</small><br><span class="faint">${total ? "total " + kr(total) : "total: n/a"}</span></div>
      <span class="src"><a href="${esc(o.url)}" target="_blank" rel="noopener">Open offer ↗</a> · Source: <a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.source_name)}</a> · fetched ${date(o.fetched_at)}${o.confirmed_by ? " · confirmed by " + o.confirmed_by.map((c) => `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.source_name)}</a> (${kr(c.monthly)})`).join(", ") : ""}</span>
    </div>`;
  }
  function leaseTab() {
    const all = data.lease.offers.slice().sort((a, b) => a.monthly - b.monthly);
    const list = all.filter((o) => ui.leaseKind === "all" || (ui.leaseKind === "tesla" ? o.provider === "Tesla" : o.condition === ui.leaseKind));
    const teslas = all.filter((o) => o.provider === "Tesla");
    return `<div class="cols"><div class="col">
      <section class="card" data-test="lease-summary"><div class="row between"><h2>Private leasing</h2><span class="faint">${date(data.lease.generated_at)}</span></div>
        <div class="big">${teslas.length ? kr(Math.min(...teslas.map((o) => o.monthly))) : "–"} <small>/mo from Tesla</small></div>
        <p class="muted">${all.length} offers · ${all.filter((o) => o.condition === "new").length} new, ${all.filter((o) => o.condition === "used").length} used. "Total" = down payment + monthly × term + fees, before insurance, charging and excess km.</p>
        <div class="mt">${seg("leaseKind", [["all", "All"], ["tesla", "Tesla"], ["new", "New"], ["used", "Used"]], ui.leaseKind)}</div>
      </section>
      <section class="card">${list.slice(0, Math.ceil(list.length / 2)).map(leaseRow).join("")}</section>
    </div><div class="col"><section class="card">${list.slice(Math.ceil(list.length / 2)).map(leaseRow).join("") || '<p class="muted">—</p>'}</section></div></div>`;
  }

  // ---------- COMPARE ----------
  const ASSUME = [
    ["years", "Ownership period", "years", 1], ["kmPerYear", "Driving", "km/year", 1000],
    ["usedDepPct", "Used car value loss", "%/year", 0.5], ["newDepY1Pct", "New car value loss, year 1", "%", 0.5],
    ["newDepPct", "New car value loss, later years", "%/year", 0.5], ["interestPct", "Interest / lost return", "%/year", 0.1],
    ["kwhPer100", "Consumption incl. losses", "kWh/100 km", 0.5], ["elPrice", "Home charging price", "kr/kWh", 0.05],
    ["insuranceUsed", "Insurance, used", "kr/month", 50], ["insuranceNew", "Insurance, new", "kr/month", 50],
    ["serviceTyresUsed", "Tyres & service, used", "kr/year", 250], ["serviceTyresNew", "Tyres & service, new", "kr/year", 250],
    ["excessKmFee", "Lease excess km fee", "kr/km", 0.1], ["vehicleTax", "Fordonsskatt", "kr/year", 10],
  ];
  function compareTab() {
    const pool = R.sortListings(filtered().filter((l) => l.dev != null), "value").slice(0, 40);
    const used = scored.find((l) => l.id === ui.cmpUsed) || pool[0] || scored[0];
    const nv = data.new.variants.find((v) => v.id === ui.cmpNew) || data.new.variants[0];
    const offers = data.lease.offers.filter((o) => o.term_months).sort((a, b) => a.monthly - b.monthly);
    const lo = offers.find((o) => o.id === ui.cmpLease) || offers.find((o) => o.provider === "Tesla" && o.variant === nv.id) || offers[0];
    const a = tco, age = used ? Math.max(0, new Date().getFullYear() - used.year) : 0;
    const res = [];
    if (used) res.push(["used", "Used", `${used.year} ${variantShort(used.variant)}, ${tkr(used.km)} km`, R.tcoUsed(used.price, age, a)]);
    if (nv) res.push(["new", "New", nv.name.replace("Model Y ", ""), R.tcoNew(nv.price, a)]);
    if (lo) res.push(["lease", "Leasing", `${lo.provider} ${lo.name.replace(/^Tesla |Model Y /g, "")}`, R.tcoLease(lo, a)]);
    const max = Math.max(...res.map((r) => r[3].total));
    const LN = [["depreciation", "Value loss (depreciation)"], ["interest", "Interest / lost return"], ["leasing", "Lease payments + down + fees"], ["excessKm", "Excess km"],
      ["energy", "Charging"], ["insurance", "Insurance"], ["service", "Tyres & service"], ["tax", "Fordonsskatt"]];
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
    return `<div class="cols"><div class="col">
      <section class="card" data-test="tco">
        <div class="row between"><h2>${a.years}-year cost</h2><span class="faint">${f0.format(a.kmPerYear)} km/yr</span></div>
        <div class="cmp">${res.map(([k, l, d, t]) => `<div class="cmp-row"><span>${l}</span><div class="cmp-bar"><i class="k-${k}" style="width:${(t.total / max) * 100}%"></i></div><b data-test="tco-${k}">${kr(t.total)}</b></div>
          <p class="faint" style="margin:-4px 0 6px 84px">${esc(d)} · ≈ ${kr(t.perMonth)}/mo${t.resale ? ` · resale ≈ ${kr(t.resale)}` : ""}${t.contracts > 1 ? ` · ${t.contracts} contracts` : ""}</p>`).join("")}</div>
        <table class="lines"><tr><th></th>${res.map((r) => `<th>${r[1]}</th>`).join("")}</tr>
          ${LN.filter(([k]) => res.some((r) => r[3].lines[k])).map(([k, l]) => `<tr><td>${l}</td>${res.map((r) => `<td>${r[3].lines[k] ? kr(r[3].lines[k]) : "–"}</td>`).join("")}</tr>`).join("")}
          <tr class="sum"><td>Total</td>${res.map((r) => `<td>${kr(r[3].total)}</td>`).join("")}</tr></table>
        <p class="faint">Prices are from the snapshot (sources on the other tabs). Value loss, interest, insurance, charging and service are <b>assumptions</b> — edit them below. Purchase price minus estimated resale counts as cost; the purchase itself is not.</p>
      </section>
      <section class="card"><h2>Pick the three options</h2><div class="pick">
        <label>Used car (best value under your filters first)<select data-cmp="cmpUsed">${pool.concat(used && !pool.includes(used) ? [used] : []).map((l) => opt(l.id, used && used.id, `${kr(l.price)} · ${l.year} ${variantShort(l.variant)} · ${tkr(l.km)} km · ${l.location}${l.dev != null ? " · " + pct(l.dev) : ""}`)).join("")}</select></label>
        <label>New car<select data-cmp="cmpNew">${data.new.variants.map((v) => opt(v.id, nv.id, `${v.name} · ${kr(v.price)}`)).join("")}</select></label>
        <label>Lease offer<select data-cmp="cmpLease">${offers.map((o) => opt(o.id, lo && lo.id, `${kr(o.monthly)}/mo · ${o.provider} · ${o.name.replace(/^Tesla /, "")} · ${o.term_months} mo`)).join("")}</select></label>
      </div></section>
    </div><div class="col">
      <section class="card" data-test="assumptions"><div class="row between"><h2>Assumptions</h2><span class="tag">Assumption · not sourced</span></div>
        <div class="assume">${ASSUME.map(([k, l, u, st]) => `<label>${l}<input type="number" inputmode="decimal" step="${st}" min="0" value="${a[k]}" data-tco="${k}"><em>${u}${k === "vehicleTax" ? " · 360 kr per jamforbilar.se" : ""}</em></label>`).join("")}</div>
        <p class="faint">Lease contracts shorter than the period are assumed renewed at the same price. Insurance/service/tyres are dropped where the lease includes them. Charging: try your Elpris average.</p>
        <div class="row gap mt"><button class="btn small" data-action="tco-reset">Reset assumptions</button></div>
      </section>
    </div></div>`;
  }

  function footer() {
    if (status.state !== "ok") return "";
    const srcs = [].concat(data.used.sources, data.new.sources, data.lease.sources);
    const ok = srcs.filter((s) => s.status === "ok"), bad = srcs.filter((s) => s.status !== "ok");
    return `<footer data-test="footer">Snapshot ${dtfmt.format(new Date(data.used.generated_at))} · data from ${[...new Set(ok.map((s) => host(s.url)))].map((h) => esc(h)).join(", ")}
      ${bad.length ? `<br>Not used: ${bad.map((s) => `${esc(s.name)} (${esc(s.status)})`).join(", ")}` : ""}<br>Asking prices, not sale prices. Not affiliated with Tesla.</footer>`;
  }

  function render() {
    const y = window.scrollY;
    let body = "";
    if (status.state === "loading") body = `<section class="card"><div class="big">…</div><p class="muted">Loading the price snapshot…</p></section>`;
    else if (status.state === "ok") body = { used: usedTab, new: newTab, lease: leaseTab, compare: compareTab }[ui.tab]();
    app.innerHTML = header() + tabs() + banner() + body + footer();
    window.scrollTo(0, y);
  }

  // ---------- events ----------
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(LS_THEME, t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f7f7f5" : "#0b0b0c");
  }
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "theme") setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
    else if (a === "reload") { loadData(); return; }
    else if (a === "tab") { ui.tab = el.dataset.val; persist(); render(); window.scrollTo(0, 0); return; }
    else if (a === "set") { ui[el.dataset.key] = el.dataset.val; ui.sel = null; }
    else if (a === "region") { const r = el.dataset.val; ui.regions = ui.regions.includes(r) ? ui.regions.filter((x) => x !== r) : ui.regions.concat([r]); ui.sel = null; }
    else if (a === "pick") { ui.sel = ui.sel === el.dataset.id ? null : el.dataset.id; if (ui.sel) ui.cmpUsed = ui.sel; }
    else if (a === "show-all") ui.showAll = true;
    else if (a === "tco-reset") { tco = Object.assign({}, R.TCO_DEFAULTS); save(LS_TCO, tco); }
    persist(); render();
  });
  app.addEventListener("change", (e) => {
    const el = e.target;
    const v = parseFloat(String(el.value).replace(",", "."));
    if (el.dataset.ui) ui[el.dataset.ui] = isFinite(v) && v > 0 ? v : (el.dataset.ui === "budget" ? UI_DEFAULTS.budget : 0);
    else if (el.dataset.tco) { if (isFinite(v) && v >= 0) tco[el.dataset.tco] = el.dataset.tco === "years" ? Math.max(1, Math.round(v)) : v; save(LS_TCO, tco); }
    else if (el.dataset.cmp) ui[el.dataset.cmp] = el.value;
    else return;
    persist(); render();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  render();
  loadData();
})();
