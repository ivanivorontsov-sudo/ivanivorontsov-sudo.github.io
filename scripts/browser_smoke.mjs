#!/usr/bin/env node
/**
 * Browser smoke audit for the published static site.
 * Checks every HTML page for runtime exceptions and missing same-origin assets,
 * then runs every generated converter form with a known input.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.SITE_URL || "http://127.0.0.1:8765";
const errors = [];
const warnings = [];
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) htmlFiles.push(file);
  }
}
function rel(file) { return path.relative(ROOT, file).split(path.sep).join("/"); }
function fail(message) { errors.push(message); }

walk(ROOT);
htmlFiles.sort();
if (!htmlFiles.length) throw new Error("No HTML pages found.");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  serviceWorkers: "block"
});
const page = await context.newPage();
page.setDefaultTimeout(7000);
let pageErrors = [];
let localAssetErrors = [];
let checked = 0;

page.on("pageerror", error => pageErrors.push(error.message));
page.on("response", response => {
  if (response.url().startsWith(BASE) && response.status() >= 400) {
    localAssetErrors.push(response.status() + " " + response.url());
  }
});
page.on("requestfailed", request => {
  const reason = request.failure()?.errorText || "unknown";
  // Chromium reports intentional navigation cancellation as ERR_ABORTED.
  if (request.url().startsWith(BASE) && reason !== "net::ERR_ABORTED") {
    localAssetErrors.push("failed " + request.url() + " (" + reason + ")");
  }
});

for (const file of htmlFiles) {
  const relative = rel(file);
  pageErrors = [];
  localAssetErrors = [];
  try {
    const response = await page.goto(BASE + "/" + relative, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response || response.status() >= 400) fail(relative + ": navigation status " + (response?.status() ?? "no response"));
    await page.waitForTimeout(80);
    const title = await page.title();
    if (!title.trim()) fail(relative + ": empty document title");
    for (const message of pageErrors) fail(relative + ": runtime exception: " + message);
    for (const item of [...new Set(localAssetErrors)]) fail(relative + ": local resource " + item);
    checked++;
  } catch (error) {
    fail(relative + ": navigation/test failed: " + error.message);
  }
}

let converterPages = 0;
let converterForms = 0;
for (const file of htmlFiles.filter(x => rel(x).includes("/converters/") && rel(x).endsWith("/index.html"))) {
  const relative = rel(file);
  try {
    pageErrors = [];
    localAssetErrors = [];
    const response = await page.goto(BASE + "/" + relative, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response || response.status() >= 400) { fail(relative + ": converter page failed to load"); continue; }
    await page.waitForFunction(() => {
      const form = document.querySelector(".convert-tool");
      return !form || form.tagName === "DIV";
    }, null, { timeout: 7000 });
    const forms = page.locator(".convert-tool");
    const count = await forms.count();
    if (!count) fail(relative + ": no converter widgets found");
    for (let i = 0; i < count; i++) {
      const form = forms.nth(i);
      const input = form.locator('input[type="number"]');
      const result = form.locator("[data-result]");
      const status = form.locator("[data-status]");
      const button = form.locator("button").first();
      try {
        await input.fill("1");
        await button.click();
        const value = (await result.textContent())?.trim() || "";
        const message = (await status.textContent())?.trim() || "";
        if (!value || value === "Результат появится здесь" || !message.includes("Готово")) {
          fail(relative + ": converter " + (i + 1) + " did not produce a result (" + JSON.stringify(value) + "; " + JSON.stringify(message) + ")");
        }
      } catch (error) {
        fail(relative + ": converter " + (i + 1) + " interaction failed: " + error.message);
      }
      converterForms++;
    }
    for (const message of pageErrors) fail(relative + ": runtime exception: " + message);
    for (const item of [...new Set(localAssetErrors)]) fail(relative + ": local resource " + item);
    converterPages++;
  } catch (error) {
    fail(relative + ": converter smoke test failed: " + error.message);
  }
}

// PDF Master: load, preview, combine and export real generated PDF documents.
try {
  pageErrors = [];
  localAssetErrors = [];
  await page.goto(BASE + "/pdf-master/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => window.PDFLib?.PDFDocument && window.pdfjsLib?.getDocument, null, { timeout: 25000 });
  const pdfBytes = await page.evaluate(async () => {
    const make = async (text) => {
      const doc = await window.PDFLib.PDFDocument.create();
      const sheet = doc.addPage([300, 400]);
      sheet.drawText(text, { x: 40, y: 350, size: 16 });
      return [...await doc.save()];
    };
    return [await make("Audit document one"), await make("Audit document two")];
  });
  await page.locator("#files").setInputFiles([
    { name: "audit-one.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfBytes[0]) },
    { name: "audit-two.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfBytes[1]) }
  ]);
  await page.waitForFunction(() => document.querySelector("#page-count")?.textContent.includes("2 стр."), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("#pages .page-card").length === 2, null, { timeout: 15000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.locator("#export-selected").click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().toLowerCase().endsWith(".pdf")) fail("PDF Master: exported file does not have a PDF extension");
  await page.locator("#range").fill("1-9");
  await page.locator("#export-range").click();
  const statusText = await page.locator("#status").innerText();
  if (!statusText.toLowerCase().includes("диапазон") && !statusText.toLowerCase().includes("предел")) {
    fail("PDF Master: invalid page range was not rejected");
  }
  for (const message of pageErrors) fail("PDF Master: runtime exception: " + message);
  for (const item of [...new Set(localAssetErrors)]) fail("PDF Master: local resource " + item);
} catch (error) {
  fail("PDF Master interaction test failed: " + error.message);
}

// Daily Tools: exercise all eleven local operations with synthetic inputs.
let dailyStage = "page load";
try {
  pageErrors = [];
  localAssetErrors = [];
  await page.goto(BASE + "/daily-tools/", { waitUntil: "domcontentloaded", timeout: 20000 });
  dailyStage = "line diff";
  await page.locator("#diff-a").fill("alpha\\nold");
  await page.locator("#diff-b").fill("alpha\\nnew");
  await page.locator("#diff-run").click();
  const diffText = await page.locator("#diff-output").innerText();
  if (!diffText.includes("old") || !diffText.includes("new")) fail("daily-tools: line comparison did not show changed lines");

  dailyStage = "SHA-256";
  const hello = Buffer.from("hello");
  await page.locator("#hash-files").setInputFiles({ name: "hello.txt", mimeType: "text/plain", buffer: hello });
  await page.locator("#hash-run").click();
  await page.waitForFunction(() => document.querySelector("#hash-output")?.innerText.includes("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"));
  dailyStage = "duplicate detection";
  await page.locator("#dup-files").setInputFiles([
    { name: "same-a.txt", mimeType: "text/plain", buffer: Buffer.from("duplicate") },
    { name: "same-b.txt", mimeType: "text/plain", buffer: Buffer.from("duplicate") },
    { name: "other.txt", mimeType: "text/plain", buffer: Buffer.from("different") }
  ]);
  await page.locator("#dup-run").click();
  await page.waitForFunction(() => document.querySelector("#dup-output")?.innerText.includes("same-a.txt") && document.querySelector("#dup-output")?.innerText.includes("same-b.txt"));

  dailyStage = "image fixture generation";
  const pngBytes = await page.evaluate(async () => { const canvas=document.createElement("canvas"); canvas.width=16; canvas.height=16; const ctx=canvas.getContext("2d"); ctx.fillStyle="#e07828"; ctx.fillRect(0,0,16,16); const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png")); return [...new Uint8Array(await blob.arrayBuffer())]; });
  const pngFixture = Buffer.from(pngBytes);
  dailyStage = "image compression";
  await page.locator("#compress-file").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: pngFixture });
  await page.locator("#compress-target").fill("5");
  await page.locator("#compress-run").click();
  await page.waitForSelector("#compress-output a[download]", { timeout: 10000 });
  dailyStage = "EXIF stripping";
  await page.locator("#exif-file").setInputFiles({ name: "metadata.png", mimeType: "image/png", buffer: pngFixture });
  await page.locator("#exif-run").click();
  await page.waitForSelector("#exif-output a[download]", { timeout: 10000 });
  dailyStage = "image resize";
  await page.locator("#resize-file").setInputFiles({ name: "resize.png", mimeType: "image/png", buffer: pngFixture });
  await page.locator("#resize-width").fill("16");
  await page.locator("#resize-height").fill("16");
  await page.locator("#resize-run").click();
  await page.waitForSelector("#resize-output a[download]", { timeout: 10000 });

  dailyStage = "CSV conversion";
  dailyStage = "EXIF metadata";
  await page.locator("#exif-meta-file").setInputFiles({ name: "exif-audit.png", mimeType: "image/png", buffer: pngFixture });
  await page.locator("#exif-meta-run").click();
  await page.waitForFunction(() => document.querySelector("#exif-meta-output")?.innerText.includes("exif-audit.png"), null, { timeout: 10000 });
  if (pageErrors.length) fail("daily-tools EXIF: " + pageErrors.join("; "));
  await page.locator("#csv-mode").selectOption("csv-json");
  await page.locator("#csv-input").fill('name,age\n"Alice, A.",30\nBob,40');
  await page.locator("#csv-run").click();
  const csvOutput = await page.locator("#csv-output").inputValue();
  if (!csvOutput.includes("Alice, A.")) fail("daily-tools: quoted CSV field was not parsed correctly; mode=" + await page.locator("#csv-mode").inputValue() + "; output=" + JSON.stringify(csvOutput));
  dailyStage = "Markdown preview";
  await page.locator("#md-input").fill("# Safe\\n<script>alert(1)</script>\\n**bold**");
  const previewHtml = await page.locator("#md-preview").innerHTML();
  if (await page.locator("#md-preview script").count()) fail("daily-tools: Markdown preview created an executable script element");
  if (!previewHtml.includes("&lt;script&gt;")) fail("daily-tools: Markdown raw HTML was not escaped");
  dailyStage = "URL parsing";
  await page.locator("#url-input").fill("https://example.com/path?a=1&a=2#part");
  await page.locator("#url-run").click();
  if (!(await page.locator("#url-output").innerText()).includes("example.com")) fail("daily-tools: URL parser missed host");
  dailyStage = "text cleaning";
  await page.locator("#clean-dedupe").check();
  await page.locator("#clean-input").fill("a  \na  \nb  ");
  await page.locator("#clean-run").click();
  if ((await page.locator("#clean-output").inputValue()) !== "a\nb") fail("daily-tools: text cleanup failed");
  dailyStage = "WCAG contrast";
  await page.locator("#fg-hex").fill("#000000");
  await page.locator("#bg-hex").fill("#FFFFFF");
  await page.locator("#bg-hex").dispatchEvent("change");
  if (!(await page.locator("#contrast-output").innerText()).includes("21.00:1")) fail("daily-tools: WCAG black-on-white contrast should be 21:1");
  for (const message of pageErrors) fail("daily-tools: runtime exception: " + message);
  for (const item of [...new Set(localAssetErrors)]) fail("daily-tools: local resource " + item);
} catch (error) {
  fail("daily-tools " + dailyStage + " test failed: " + error.message);
}

// Funny Tools: run all 100 independent formulas with non-zero, finite sample values.
try {
  pageErrors = [];
  localAssetErrors = [];
  await page.goto(BASE + "/tools-audit/funny-tools.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  const cards = page.locator("#grid .card");
  await page.waitForFunction(() => document.querySelectorAll("#grid .card").length === 100, null, { timeout: 10000 });
  if (await cards.count() !== 100) fail("funny-tools: expected 100 calculator cards");
  for (let i = 0; i < await cards.count(); i++) {
    const card = cards.nth(i);
    await card.locator("[data-a]").fill(String((i % 7) + 1));
    await card.locator("[data-b]").fill(String((i % 5) + 2));
    await card.locator(".calc").click();
    const result = await card.locator(".result").innerText();
    if (!result.trim() || result.startsWith("Ошибка:") || !(await card.locator(".result strong").count())) {
      fail("funny-tools: calculator " + (i + 1) + " failed: " + result);
    }
  }
  const firstCalculatorName = await cards.first().locator("h2").innerText();
  await page.locator("#search").fill(firstCalculatorName);
  if (await cards.filter({ visible: true }).count() === 0) fail("funny-tools: search filter returned no results for an existing calculator title");
  for (const message of pageErrors) fail("funny-tools: runtime exception: " + message);
  for (const item of [...new Set(localAssetErrors)]) fail("funny-tools: local resource " + item);
} catch (error) {
  fail("funny-tools interaction test failed: " + error.message);
}

// Shared support banner: verify canonical destination and unique top placement.
try {
  pageErrors = [];
  localAssetErrors = [];
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!(await page.locator("#donate").count())) fail("support: main page has no canonical #donate section");

  const supportPages = [
    "tools-audit/index.html",
    "tools-audit/open-tools.html",
    "tools-audit/workbench.html",
    "tools-audit/local-plus.html",
    "tools-audit/local-suite.html",
    "tools-audit/search.html",
    "tools-audit/web-tools.html",
    "tools-audit/extra-500.html",
    "tools-audit/funny-tools.html",
    "tools-audit/categories/file-converters/index.html",
    "daily-tools/index.html",
    "pdf-master/index.html",
    "tools-audit/workshop/converters/pressure/psi/index.html"
  ];
  for (const relative of supportPages) {
    pageErrors = [];
    localAssetErrors = [];
    await page.goto(BASE + "/" + relative, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector(".site-support", { timeout: 7000 }).catch(() => fail("support: banner missing on " + relative));
    const banner = page.locator(".site-support");
    if (await banner.count()) {
      const href = await banner.locator("a.site-support-link").getAttribute("href");
      if (href !== "https://ivanivorontsov-sudo.github.io/#donate") fail("support: incorrect destination on " + relative + ": " + href);
      const first = await page.locator("body").evaluate(el => el.firstElementChild?.classList.contains("site-support") || false);
      if (!first) fail("support: banner is not at the top of body on " + relative);
      if (await page.locator(".site-support").count() !== 1) fail("support: duplicate banner on " + relative);
    }
    for (const message of pageErrors) fail("support: runtime exception on " + relative + ": " + message);
  }
} catch (error) {
  fail("shared support banner test failed: " + error.message);
}

// Mobile overflow checks for important tool entry points.
const mobilePages = [
  "index.html",
  "legal.html",
  "privacy.html",
  "tools-audit/workbench.html",
  "tools-audit/local-plus.html",
  "tools-audit/local-suite.html",
  "tools-audit/search.html",
  "daily-tools/index.html",
  "daily-tools/privacy.html",
  "pdf-master/index.html",
  "pdf-master/privacy.html"
];
for (const width of [320, 360, 390, 430]) {
  await page.setViewportSize({ width, height: 844 });
  for (const relative of mobilePages) {
    try {
      await page.goto(BASE + "/" + relative, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(60);
      const overflow = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll("body *")].map(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || "",
            className: typeof el.className === "string" ? el.className.slice(0, 100) : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            overflowX: style.overflowX
          };
        }).filter(item => item.width > 0 && (item.right > viewport + 2 || item.left < -2))
          .sort((a, b) => b.right - a.right)
          .slice(0, 8);
        return { width: viewport, scroll: document.documentElement.scrollWidth, offenders };
      });
      if (overflow.scroll > overflow.width + 2) {
        const message = relative + ": horizontal overflow at " + width + "px (" + overflow.width + "px viewport, " + overflow.scroll + "px content); offenders=" + JSON.stringify(overflow.offenders);
        if (relative === "daily-tools/index.html" || relative === "index.html" || relative === "legal.html" || relative === "aefh/v7/index.html") fail(message);
        else warnings.push(message);
      }
    } catch (error) {
      fail(relative + ": mobile check at " + width + "px failed: " + error.message);
    }
  }
}

// AEFH v7.0: verify the interactive manuscript, controls, and responsive header.
try {
  pageErrors = [];
  localAssetErrors = [];
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(BASE + "/aefh/v7/", { waitUntil: "domcontentloaded", timeout: 20000 });
  if (await page.locator("h1").count() !== 1) fail("AEFH v7: expected exactly one H1");
  if (!(await page.title()).includes("AEFH v7.0")) fail("AEFH v7: unexpected document title");
  await page.locator("#btn-theme").click();
  if (await page.locator("html").getAttribute("data-theme") !== "dark") fail("AEFH v7: dark-theme button did not switch theme");
  await page.locator("#btn-theme").click();
  await page.locator("#btn-proofs").click();
  const proofCount = await page.locator("details.proof").count();
  const openedProofs = await page.locator("details.proof[open]").count();
  if (!proofCount || openedProofs !== proofCount) fail("AEFH v7: expand-all did not open every proof");
  await page.locator("#btn-proofs").click();
  const collapsedProofs = await page.locator("details.proof[open]").count();
  if (collapsedProofs !== 0) fail("AEFH v7: collapse-all did not close every proof");
  await page.locator("#gamma-slider").evaluate(el => { el.value = "4"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  if (!(await page.locator("#st-loc").innerText()).includes("Квартичный")) fail("AEFH v7: phase slider did not update the critical state");
  await page.locator("#rg-scale").evaluate(el => { el.value = "13"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  if (!(await page.locator("#rg-canvas").evaluate(el => el.width > 0 && el.height > 0))) fail("AEFH v7: RG canvas was not drawn");
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(50);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      topbar: document.querySelector(".topbar")?.getBoundingClientRect(),
      controls: document.querySelector(".controls")?.getBoundingClientRect()
    }));
    if (dimensions.content > dimensions.viewport + 2) fail("AEFH v7: horizontal overflow at " + width + "px (" + dimensions.viewport + " viewport / " + dimensions.content + " content)");
    if (dimensions.topbar && dimensions.controls && dimensions.controls.right > dimensions.viewport + 2) fail("AEFH v7: control buttons exceed viewport at " + width + "px");
  }
  for (const message of pageErrors) fail("AEFH v7: runtime exception: " + message);
  for (const item of [...new Set(localAssetErrors)]) fail("AEFH v7: local resource " + item);
} catch (error) {
  fail("AEFH v7 interaction test failed: " + error.message);
}

// Legal owner details must be rendered once, not duplicated in the page body.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + "/legal.html", { waitUntil: "domcontentloaded" });
const ownerCards = await page.locator("main .note").filter({ hasText: "Владелец сайта:" }).filter({ hasText: "заявления правообладателей" }).count();
if (ownerCards !== 1) fail("legal.html: expected one owner/contact block, found " + ownerCards);
const addressMentions = await page.locator("main").innerText();
if ((addressMentions.match(/690089/g) || []).length !== 1) fail("legal.html: address should appear exactly once in the legal disclosure");

await browser.close();
console.log("Browser smoke: " + checked + "/" + htmlFiles.length + " HTML pages loaded.");
console.log("Converter runtime: " + converterPages + " pages, " + converterForms + " individual conversions tested.");
console.log("Mobile layout warnings: " + warnings.length);
for (const warning of warnings) console.warn("WARN:", warning);
console.log("Runtime/link errors: " + errors.length);
for (const error of errors) console.error("ERROR:", error);
if (errors.length) process.exitCode = 1;
