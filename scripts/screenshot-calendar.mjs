import { chromium } from "@playwright/test";

const URL = process.env.SCREENSHOT_URL ?? "http://localhost:3001/calendar";
const OUT = process.env.SCREENSHOT_OUT ?? "tmp/calendar.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForTimeout(2_000);
const fcCount = await page.locator(".fc").count();
const eventCount = await page.locator(".fc-event").count();
const headerText = await page.locator(".fc-toolbar-title").first().textContent().catch(() => null);
const bodyText = (await page.locator("body").innerText()).slice(0, 400);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();

console.log(JSON.stringify({ url: URL, out: OUT, fcCount, eventCount, headerText, bodyText, consoleErrors }, null, 2));
