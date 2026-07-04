#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'hero-vault-ui-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
    phase: 'REELFORGE PHASE 66 — HERO VISUAL VAULT IMPLEMENTATION',
    generatedAt: new Date().toISOString(),
    checks: {
        acceptImageCardAppears: false,
        acceptVideoCardAppears: false,
        reloadCardRemains: false,
        activeAssetHighlighted: false,
        deleteRemovesCard: false
    },
    evidence: {},
    diagnostics: [],
    completeToken: 'HERO_VAULT_UI_COMPLETE=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[HERO_VAULT_CARD_RENDER]') ||
        text.includes('[HERO_VAULT_SELECT]') ||
        text.includes('[HERO_VAULT_DELETE]')
    ) {
        report.diagnostics.push({ at: Date.now(), text });
    }
});

async function clickIf(selector, timeout = 2000) {
    const target = page.locator(selector).first();
    if (!(await target.count())) return false;
    try {
        await target.click({ timeout });
        return true;
    } catch {
        return false;
    }
}

async function openSystemTab() {
    const panelNow = page.locator('[data-hero-manager-panel]').first();
    if (await panelNow.count()) return;

    await page.evaluate(() => {
        localStorage.setItem('admin_mode', 'true');
        localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
        localStorage.setItem('reelforge_studio_workspace_tab', 'system');
    });
    await page.evaluate(() => {
        window.dispatchEvent(
            new CustomEvent('reelforge:search-navigate', {
                detail: { workspaceTab: 'system' }
            })
        );
    });
    await clickIf('.ghost-trigger', 2000);
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.count()) {
        await passwordInput.fill('Gaff1505!');
        await clickIf('button:has-text("UNLOCK STUDIO")', 3000);
        await page.waitForTimeout(700);
    }
    await clickIf('button[role="tab"]:has-text("System")', 3000);
    if (!(await panelNow.count())) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            localStorage.setItem('admin_mode', 'true');
            localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
            localStorage.setItem('reelforge_studio_workspace_tab', 'system');
            window.dispatchEvent(
                new CustomEvent('reelforge:search-navigate', {
                    detail: { workspaceTab: 'system' }
                })
            );
        });
        await clickIf('.ghost-trigger', 2000);
        await clickIf('button[role="tab"]:has-text("System")', 3000);
    }
    await page.waitForSelector('[data-hero-manager-panel]', { timeout: 15000 });
}

async function applyAcceptedAsset({ kind, id, payload }) {
    await page.evaluate(async ({ kind, id, payload }) => {
        const hero = await import('/src/lib/hero/heroIntelligence.js');
        if (kind === 'image') {
            localStorage.setItem('reelforge_hero_image', payload);
            hero.saveHeroManagerConfig({
                backgroundSource: 'custom_image',
                backgroundStyle: 'image',
                heroAssetId: id
            });
            return;
        }
        localStorage.setItem('reelforge_hero_video', payload);
        hero.saveHeroManagerConfig({
            backgroundSource: 'custom_video',
            backgroundStyle: 'video',
            heroAssetId: id
        });
    }, { kind, id, payload });
}

async function readVaultState(label) {
    return page.evaluate(({ label }) => {
        const cards = Array.from(document.querySelectorAll('[data-hero-vault-card]'));
        const activeCards = cards.filter((card) => card.classList.contains('hero-vault__card--active'));
        const cardState = cards.map((card) => ({
            assetId: card.getAttribute('data-asset-id') || '',
            hasActiveBadge: Boolean(card.querySelector('.hero-vault__active')),
            classes: card.className
        }));
        return {
            label,
            cardCount: cards.length,
            activeCount: activeCards.length,
            cardState
        };
    }, { label });
}

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await openSystemTab();

await page.evaluate(() => {
    localStorage.removeItem('reelforge_hero_image');
    localStorage.removeItem('reelforge_hero_video');
    localStorage.removeItem('reelforge_hero_manager_config');
});
await page.waitForTimeout(300);

const imageAssetId = `hero-image-ui-${Date.now()}`;
await applyAcceptedAsset({
    kind: 'image',
    id: imageAssetId,
    payload: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6WQAAAAASUVORK5CYII='
});
await page.waitForTimeout(800);
const afterImage = await readVaultState('after-image-accept');
report.evidence.afterImage = afterImage;
report.checks.acceptImageCardAppears = afterImage.cardCount === 1 && afterImage.cardState[0]?.assetId === imageAssetId;
report.checks.activeAssetHighlighted = afterImage.activeCount === 1 && Boolean(afterImage.cardState[0]?.hasActiveBadge);

await page.reload({ waitUntil: 'domcontentloaded' });
await openSystemTab();
await page.waitForTimeout(600);
const afterReload = await readVaultState('after-reload');
report.evidence.afterReload = afterReload;
report.checks.reloadCardRemains = afterReload.cardCount === 1 && afterReload.cardState[0]?.assetId === imageAssetId;

const videoAssetId = `hero-video-ui-${Date.now()}`;
await applyAcceptedAsset({
    kind: 'video',
    id: videoAssetId,
    payload: 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t'
});
await page.waitForTimeout(1000);
const afterVideo = await readVaultState('after-video-accept');
report.evidence.afterVideo = afterVideo;
report.checks.acceptVideoCardAppears = afterVideo.cardCount === 1 && afterVideo.cardState[0]?.assetId === videoAssetId;

const deleteButton = page.locator(`[data-hero-vault-card][data-asset-id="${videoAssetId}"] .hero-vault__actions button:has-text("Delete")`).first();
if (await deleteButton.count()) {
    await deleteButton.click({ timeout: 3000 });
    await page.waitForTimeout(600);
}
const afterDelete = await readVaultState('after-delete');
report.evidence.afterDelete = afterDelete;
report.checks.deleteRemovesCard = afterDelete.cardCount === 0;

const success = Object.values(report.checks).every(Boolean);
report.completeToken = success ? 'HERO_VAULT_UI_COMPLETE=true' : 'HERO_VAULT_UI_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completeToken);
