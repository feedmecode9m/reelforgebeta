#!/usr/bin/env node
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});
const page = await browser.newPage();

await page.addInitScript(() => {
  window.__batchLogs = [];
  const original = console.info.bind(console);
  console.info = (...args) => {
    if (String(args[0] || '').startsWith('[BATCH_')) {
      window.__batchLogs.push({ tag: String(args[0]), payload: args[1] || null });
    }
    original(...args);
  };
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.click('.ghost-trigger');

const password = page.locator('.admin-login-panel input[type="password"]').first();
if (await password.count()) {
  await password.fill('admin123');
  await page.locator('.admin-login-panel .submit-btn').first().click();
}
await page.waitForTimeout(900);
await page.locator('button[role="tab"]').filter({ hasText: 'System' }).first().click();
await page.waitForTimeout(500);
await page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first().click();
await page.waitForTimeout(1200);

const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
const checkboxes = thumbSection.locator('input[type="checkbox"]');
const deleteBtn = thumbSection.locator('button:has-text("DELETE SELECTED")').first();

console.log('checkbox_count_before', await checkboxes.count());
console.log('button_before', await deleteBtn.textContent());
await checkboxes.nth(0).click({ force: true });
await page.waitForTimeout(250);
console.log('button_after_1', await deleteBtn.textContent());
await checkboxes.nth(1).click({ force: true });
await page.waitForTimeout(250);
console.log('button_after_2', await deleteBtn.textContent());
console.log('batch_logs', JSON.stringify(await page.evaluate(() => window.__batchLogs || []), null, 2));

await browser.close();
