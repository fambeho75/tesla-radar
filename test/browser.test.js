// Headless Chromium smoke test + screenshots.  BASE=http://127.0.0.1:8795/ node test/browser.test.js
const path = require("path");
let pw;
try { pw = require("playwright-core"); } catch (e) { pw = require(process.env.PW_CORE || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core"); }
const BASE = process.env.BASE || "http://127.0.0.1:8795/";
const OUT = path.join(__dirname, "..", "screenshots");
const exe = process.env.CHROME || "/usr/bin/google-chrome";
const results = [];
const ok = (name, cond, info = "") => { results.push([cond ? "PASS" : "FAIL", name, info]); };
const num = (s) => +String(s).replace(/[^\d]/g, "");

async function open(browser, opts, theme, routeFn) {
  const ctx = await browser.newContext(Object.assign({ locale: "sv-SE", timezoneId: "Europe/Stockholm", serviceWorkers: "block" }, opts));
  await ctx.addInitScript((t) => { localStorage.removeItem("myradar-ui"); if (t) localStorage.setItem("myradar-theme", t); }, theme || null);
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push(String(e)));
  if (routeFn) await routeFn(p);
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  return { p, ctx, errors };
}
const tab = async (p, t) => { await p.click(`button[data-action=tab][data-val=${t}]`); await p.waitForTimeout(200); };

(async () => {
  const browser = await pw.chromium.launch({ executablePath: exe, headless: true });
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const desktop = { viewport: { width: 1360, height: 1000 } };

  // 1. iPhone dark: used tab
  let { p, ctx, errors } = await open(browser, iphone, "dark");
  const total = num(await p.locator("[data-test=used-count]").textContent());
  const dots = await p.locator("[data-test=chart] circle.pt").count();
  ok("used: listings loaded and plotted", total >= 20 && dots === total, `count=${total} dots=${dots}`);
  const rows = await p.locator("[data-test=listing]").count();
  ok("used: list shows up to 25 rows", rows === Math.min(25, total), `rows=${rows}`);
  const href = await p.locator("[data-test=listing]").first().getAttribute("href");
  ok("used: each listing links to its ad", /^https:\/\/(www\.)?(blocket|wayke)\.se\//.test(href), href);
  ok("used: value badges shown", (await p.locator("[data-test=listings] .badge.good, [data-test=listings] .badge.great").count()) > 0);
  await p.screenshot({ path: `${OUT}/iphone-dark-used.png` });
  await p.screenshot({ path: `${OUT}/iphone-dark-used-full.png`, fullPage: true });
  // tap a dot → readout with link
  await p.locator("[data-test=chart] circle.pt").last().click({ force: true });
  const ro = await p.locator("[data-test=readout]").innerText();
  ok("used: tapping a dot shows price + ad link", /kr/.test(ro) && /Open ad/.test(ro), ro.replace(/\s+/g, " ").slice(0, 120));
  // filters
  await p.click("button[data-key=variant][data-val=PERF]");
  const perf = num(await p.locator("[data-test=used-count]").textContent());
  ok("filter: Performance narrows the list", perf > 0 && perf < total, `perf=${perf}`);
  await p.click("button[data-key=variant][data-val=all]");
  await p.click("button[data-key=gen][data-val=juniper]");
  const jun = num(await p.locator("[data-test=used-count]").textContent());
  ok("filter: Juniper narrows the list", jun < total, `juniper=${jun}`);
  await p.click("button[data-key=gen][data-val=all]");
  await p.click("button[data-action=region][data-val=Skåne]");
  const sk = num(await p.locator("[data-test=used-count]").textContent());
  const regs = await p.locator("[data-test=listing] .m").allInnerTexts();
  ok("filter: region Skåne only", sk > 0 && sk < total && regs.every((t) => /Skåne/.test(t)), `skane=${sk}`);
  await p.click("button[data-action=region][data-val=Skåne]");
  await p.fill("input[data-ui=maxPrice]", "350000"); await p.press("input[data-ui=maxPrice]", "Enter"); await p.locator("body").click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(150);
  const prices = (await p.locator("[data-test=listing] .p").allInnerTexts()).map(num);
  ok("filter: max price respected", prices.length > 0 && prices.every((v) => v <= 350000), `n=${prices.length} max=${Math.max(...prices)}`);
  await p.fill("input[data-ui=maxPrice]", ""); await p.locator("body").click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(150);
  await p.click("button[data-key=chart][data-val=year]");
  ok("chart: vs model year renders", (await p.locator("[data-test=chart] circle.pt").count()) === total);
  await p.click("button[data-key=sort][data-val=price]");
  const sorted = (await p.locator("[data-test=listing] .p").allInnerTexts()).map(num);
  ok("sort by price ascending", sorted.every((v, i) => !i || v >= sorted[i - 1]));

  // new tab
  await tab(p, "new");
  const nv = await p.locator("[data-test=new-variant]").count();
  const nsrc = await p.locator("[data-test=new-card] .src a").count();
  ok("new: variants with sources", nv >= 3 && nsrc >= nv, `variants=${nv} sourceLinks=${nsrc}`);
  await p.screenshot({ path: `${OUT}/iphone-dark-new.png`, fullPage: true });
  // lease tab
  await tab(p, "lease");
  const lo = await p.locator("[data-test=lease-offer]").count();
  ok("lease: offers listed", lo >= 3, `offers=${lo}`);
  await p.click("button[data-key=leaseKind][data-val=tesla]");
  const tl = await p.locator("[data-test=lease-offer]").allInnerTexts();
  ok("lease: Tesla filter", tl.length >= 1 && tl.every((t) => /^Tesla/.test(t.trim())), `tesla=${tl.length}`);
  await p.screenshot({ path: `${OUT}/iphone-dark-lease.png`, fullPage: true });
  // compare tab
  await tab(p, "compare");
  const tu = num(await p.locator("[data-test=tco-used]").textContent()), tn = num(await p.locator("[data-test=tco-new]").textContent()), tle = num(await p.locator("[data-test=tco-lease]").textContent());
  ok("compare: three totals", tu > 0 && tn > 0 && tle > 0, `used=${tu} new=${tn} lease=${tle}`);
  await p.screenshot({ path: `${OUT}/iphone-dark-compare.png`, fullPage: true });
  await p.fill("input[data-tco=years]", "5"); await p.locator("input[data-tco=years]").dispatchEvent("change"); await p.waitForTimeout(150);
  const tn5 = num(await p.locator("[data-test=tco-new]").textContent());
  ok("compare: editing an assumption recalculates", tn5 > tn, `${tn} → ${tn5}`);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("myradar-tco")).years);
  ok("compare: assumptions persist", saved === 5, String(saved));
  await p.click("button[data-action=tco-reset]");
  // theme
  await p.click("button[data-action=theme]");
  const th = await p.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("myradar-theme")]);
  ok("theme toggle switches + persists", th[0] === "light" && th[1] === "light", th.join("/"));
  ok("no console errors (iPhone dark)", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // 2. iPhone light screenshots
  ({ p, ctx, errors } = await open(browser, iphone, "light"));
  await p.screenshot({ path: `${OUT}/iphone-light-used.png` });
  await p.screenshot({ path: `${OUT}/iphone-light-used-full.png`, fullPage: true });
  for (const t of ["new", "lease", "compare"]) { await tab(p, t); await p.screenshot({ path: `${OUT}/iphone-light-${t}.png`, fullPage: t !== "lease" }); }
  ok("no console errors (iPhone light)", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // 3. desktop
  for (const t of ["dark", "light"]) {
    ({ p, ctx, errors } = await open(browser, desktop, t));
    await p.screenshot({ path: `${OUT}/desktop-${t}.png`, fullPage: true });
    ok(`no console errors (desktop ${t})`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // 4. snapshot missing → error banner, no crash
  ({ p, ctx, errors } = await open(browser, iphone, "dark", (pg) => pg.route(/\/data\/used\.json/, (r) => r.fulfill({ status: 404, body: "nope" }))));
  const ban = await p.locator(".banner.error").innerText().catch(() => "");
  ok("missing data → error banner with retry", /Try again/.test(ban), ban.replace(/\s+/g, " "));
  ok("missing data → no uncaught JS errors", errors.filter((e) => !/Failed to load resource|404/.test(e)).length === 0, errors.join(" | "));
  await ctx.close();

  // 5. stale snapshot → warning
  ({ p, ctx, errors } = await open(browser, iphone, "dark", (pg) => pg.route(/\/data\/used\.json/, async (r) => {
    const res = await r.fetch(); const j = await res.json(); j.generated_at = new Date(Date.now() - 9 * 86400000).toISOString();
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  })));
  ok("old snapshot → stale warning", /days old/.test(await p.locator(".banner.warn").innerText().catch(() => "")));
  await ctx.close();

  await browser.close();
  for (const r of results) console.log(r.join("  "));
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
