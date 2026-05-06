import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../docs/screenshots");
const BASE = "http://localhost:3000";
const EMAIL = "admin@taskforge.dev";
const PASS = "password123";
const PROJECT = "WR";
const ISSUE = "WR-7"; // IN_PROGRESS issue with assignee — looks good in screenshots

async function shot(page, name) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`✓ ${name}.png`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Sign in ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  // ── Dashboard ─────────────────────────────────────────────────────────────
  await page.goto(BASE);
  await shot(page, "dashboard");

  // ── Issue list ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/projects/${PROJECT}/issues`);
  await shot(page, "issue-list");

  // ── Kanban board ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/projects/${PROJECT}/board`);
  await shot(page, "board");

  // ── Issue detail — navigate directly to a known issue ────────────────────
  await page.goto(`${BASE}/projects/${PROJECT}/issues/${ISSUE}`);
  await shot(page, "issue-detail");

  // ── Search — type query, press Escape to close autocomplete, then shoot ───
  await page.goto(`${BASE}/search`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const queryInput = page.locator("input").first();
  if (await queryInput.isVisible()) {
    await queryInput.fill('status = "IN_PROGRESS"');
    await queryInput.press("Enter");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    // Close any autocomplete dropdown
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await shot(page, "search");

  await browser.close();
  console.log("\nAll screenshots saved to docs/screenshots/");
})();
