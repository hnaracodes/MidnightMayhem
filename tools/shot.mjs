#!/usr/bin/env node
// Headless Chrome driver for screenshots and scripted play-throughs.
//
//   node tools/shot.mjs --url http://localhost:5181/rig.html --out .shots/rig.png [--wait 1500] [--selector canvas]
//   node tools/shot.mjs steps.json
//
// steps.json: { "viewport": {"width":960,"height":540}, "fakeCamera": true, "steps": [ ... ] }
// step kinds (one key each, "page": n switches the active page, pages are created on demand):
//   {"goto": "url"}  {"wait": ms}  {"waitFor": "selector"}  {"click": "selector"}  {"fill": ["selector","text"]}
//   {"press": "KeyA"}  {"down": "KeyA"}  {"up": "KeyA"}  {"hold": ["KeyA", ms]}
//   {"shot": "path.png", "selector": "canvas"?}  {"eval": "js expression"}  {"text": "selector"}
// Prints a JSON report: console errors/warnings and page errors per page, plus eval/text results in order.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
let plan;
if (argv.length && !argv[0].startsWith("--")) {
  plan = JSON.parse(await readFile(argv[0], "utf8"));
} else {
  const url = flag("url");
  if (!url) { console.error("usage: shot.mjs --url URL --out FILE [--wait ms] [--selector css] | shot.mjs steps.json"); process.exit(2); }
  plan = { steps: [{ goto: url }, { wait: Number(flag("wait") ?? 1500) }, { shot: flag("out") ?? "shot.png", selector: flag("selector") }] };
}

const args = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"];
if (plan.fakeCamera) args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true, args });
} catch {
  browser = await chromium.launch({ headless: true, args });
}
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: plan.viewport ?? { width: 960, height: 540 },
  permissions: plan.fakeCamera ? ["camera"] : [],
});
const pages = [];
const report = { pages: [], results: [] };
async function pageAt(i) {
  while (pages.length <= i) {
    const p = await context.newPage();
    const entry = { console: [], errors: [] };
    report.pages.push(entry);
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") entry.console.push(`${m.type()}: ${m.text()}`); });
    p.on("pageerror", (e) => entry.errors.push(String(e)));
    pages.push(p);
  }
  return pages[i];
}
let current = 0;
try {
  for (const step of plan.steps ?? []) {
    if ("page" in step) { current = step.page; await pageAt(current); continue; }
    const page = await pageAt(current);
    if ("goto" in step) await page.goto(step.goto, { waitUntil: "load" });
    else if ("wait" in step) await page.waitForTimeout(step.wait);
    else if ("waitFor" in step) await page.waitForSelector(step.waitFor, { timeout: step.timeout ?? 15000 });
    else if ("click" in step) await page.click(step.click);
    else if ("fill" in step) await page.fill(step.fill[0], step.fill[1]);
    else if ("press" in step) await page.keyboard.press(step.press);
    else if ("down" in step) await page.keyboard.down(step.down);
    else if ("up" in step) await page.keyboard.up(step.up);
    else if ("hold" in step) { await page.keyboard.down(step.hold[0]); await page.waitForTimeout(step.hold[1]); await page.keyboard.up(step.hold[0]); }
    else if ("shot" in step) {
      mkdirSync(dirname(step.shot), { recursive: true });
      if (step.selector) await page.locator(step.selector).first().screenshot({ path: step.shot });
      else await page.screenshot({ path: step.shot });
      report.results.push({ shot: step.shot });
    }
    else if ("eval" in step) report.results.push({ eval: step.eval, value: await page.evaluate(step.eval) });
    else if ("text" in step) report.results.push({ text: step.text, value: await page.locator(step.text).first().innerText() });
    else throw new Error(`unknown step ${JSON.stringify(step)}`);
  }
} catch (err) {
  report.driverError = String(err);
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
process.exit(report.driverError ? 1 : 0);
