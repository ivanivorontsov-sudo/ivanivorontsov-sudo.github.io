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
  if (request.url().startsWith(BASE)) {
    localAssetErrors.push("failed " + request.url() + " (" + (request.failure()?.errorText || "unknown") + ")");
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
          fail(relative + ": converter " + (i + 1) + " did not produce a result ("" + value + ""; "" + message + "")");
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

// Mobile overflow checks for important tool entry points.
const mobilePages = [
  "index.html",
  "tools-audit/workbench.html",
  "tools-audit/local-plus.html",
  "tools-audit/local-suite.html",
  "tools-audit/search.html",
  "daily-tools/index.html",
  "pdf-master/index.html"
];
await page.setViewportSize({ width: 390, height: 844 });
for (const relative of mobilePages) {
  try {
    await page.goto(BASE + "/" + relative, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    if (overflow.scroll > overflow.width + 2) {
      warnings.push(relative + ": horizontal overflow at 390px (" + overflow.width + "px viewport, " + overflow.scroll + "px content)");
    }
  } catch (error) {
    fail(relative + ": mobile check failed: " + error.message);
  }
}

await browser.close();
console.log("Browser smoke: " + checked + "/" + htmlFiles.length + " HTML pages loaded.");
console.log("Converter runtime: " + converterPages + " pages, " + converterForms + " individual conversions tested.");
console.log("Mobile layout warnings: " + warnings.length);
for (const warning of warnings) console.warn("WARN:", warning);
console.log("Runtime/link errors: " + errors.length);
for (const error of errors) console.error("ERROR:", error);
if (errors.length) process.exitCode = 1;
