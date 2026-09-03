#!/usr/bin/env node
/**
 * Video Vault Edit scroll-port repair — focused regression only.
 *
 * Static wiring for scroll-aware Edit handler + live vault items 1, 17–20.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { unlockStudioWithHeroSection } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const vaultSrc = fs.readFileSync(path.join(root, 'src/components/experiences/VaultExperience.svelte'), 'utf8');
const creatorSrc = fs.readFileSync(
    path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
    'utf8'
);

console.log('\n[1] video vault edit scroll wiring');
assert(vaultSrc.includes('function requestVaultVideoEdit'), 'requestVaultVideoEdit defined');
assert(vaultSrc.includes('scrollVaultEditControlIntoView'), 'scrollVaultEditControlIntoView defined');
assert(
    vaultSrc.includes("scrollIntoView({ block: 'nearest', inline: 'nearest' })"),
    'edit scrollIntoView uses nearest block/inline'
);
assert(vaultSrc.includes('handleVaultVideoEditClick'), 'Edit click routes through scroll-aware handler');
assert(vaultSrc.includes('data-vault-edit'), 'video vault exposes data-vault-edit');
assert(vaultSrc.includes('editSignal={vaultEditSignals'), 'editSignal wired to VaultEpisodeCreatorStatus');
assert(creatorSrc.includes('editSignal') && creatorSrc.includes('openPackage()'), 'editSignal opens package editor');
const thumbGridBlock = vaultSrc.split('class="thumbnail-grid vault-grid vault-grid--images"')[1]?.split(
    '<div class="thumbnail-grid vault-grid vault-grid--videos'
)[0] || '';
assert(!thumbGridBlock.includes('data-vault-edit'), 'video vault (not thumbnail grid) owns data-vault-edit');
assert(
    vaultSrc.includes('class="thumbnail-grid vault-grid vault-grid--videos') &&
        vaultSrc.includes('data-vault-edit'),
    'video vault grid exposes data-vault-edit'
);

console.log('\n[2] browser — scroll-port Edit (items 1, 17–20) on live vault');
const playwrightShellPath =
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
/** @type {import('playwright').LaunchOptions} */
const browserLaunchOptions = { headless: true };
if (existsSync(playwrightShellPath)) {
    browserLaunchOptions.executablePath = playwrightShellPath;
}

let browser;
try {
    browser = await chromium.launch(browserLaunchOptions);
    const livePage = await browser.newPage();
    await livePage.setViewportSize({ width: 390, height: 844 });
    await livePage.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await unlockStudioWithHeroSection(livePage, FRONTEND);

    const vaultCardCount = await livePage.evaluate(() => {
        return document.querySelectorAll('.video-vault-grid [data-vault-edit]').length;
    });
    assert(vaultCardCount >= 17, `live vault has at least 17 video cards (found ${vaultCardCount})`);

    /** @param {number} index 0-based card index */
    async function exerciseScrollPortEdit(index) {
        const itemLabel = index + 1;
        const pre = await livePage.evaluate((idx) => {
            const scrollBody = document.querySelector('[data-control-center-scroll-body]');
            const edits = [...document.querySelectorAll('.video-vault-grid [data-vault-edit]')];
            const edit = edits[idx];
            if (!edit) return { missing: true, index: idx };

            if (scrollBody) {
                scrollBody.scrollTop = 0;
            }
            if (idx >= 16 && scrollBody) {
                for (let step = 0; step < 80; step += 1) {
                    const bodyRect = scrollBody.getBoundingClientRect();
                    const editRect = edit.getBoundingClientRect();
                    if (editRect.top >= bodyRect.bottom - 4) break;
                    scrollBody.scrollTop += 56;
                }
            } else if (scrollBody) {
                edit.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }

            const bodyRect = scrollBody?.getBoundingClientRect();
            const editRect = edit.getBoundingClientRect();
            const cx = editRect.left + editRect.width / 2;
            const cy = editRect.top + editRect.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            const card = edit.closest('[data-vault-asset-id]');
            return {
                index: idx,
                assetId: card?.getAttribute('data-vault-asset-id') || null,
                editBelowScrollport: Boolean(bodyRect && editRect.top >= bodyRect.bottom - 4),
                elementFromPointIsEdit: hit === edit || Boolean(hit && edit.contains(hit)),
                elementFromPointTag: hit?.tagName || null
            };
        }, index);

        assert(!pre.missing, `item ${itemLabel} Edit control present`);
        assert(pre.assetId, `item ${itemLabel} retains data-vault-asset-id (${pre.assetId || 'missing'})`);

        if (index >= 16) {
            assert(
                pre.editBelowScrollport,
                `item ${itemLabel} Edit starts below inner scrollport (scroll-port defect repro)`
            );
            assert(
                !pre.elementFromPointIsEdit,
                `item ${itemLabel} Edit not hittable before handler scroll (elementFromPoint ≠ edit)`
            );
        }

        await livePage.evaluate((idx) => {
            const edits = [...document.querySelectorAll('.video-vault-grid [data-vault-edit]')];
            edits[idx]?.click();
        }, index);
        await livePage.waitForTimeout(500);

        const post = await livePage.evaluate(({ assetId }) => {
            const card = document.querySelector(`[data-vault-asset-id="${assetId}"]`);
            const scrollBody = document.querySelector('[data-control-center-scroll-body]');
            const edit = card?.querySelector('[data-vault-edit]');
            const bodyRect = scrollBody?.getBoundingClientRect();
            const editRect = edit?.getBoundingClientRect();
            return {
                cardEditing: card?.classList.contains('vault-card--editing') ?? false,
                creatorEditing: Boolean(card?.querySelector('.vault-creator-card--editing')),
                saveBtn: Boolean(document.querySelector('[data-creator-save-package]')),
                editInScrollport: Boolean(
                    bodyRect &&
                        editRect &&
                        editRect.top < bodyRect.bottom &&
                        editRect.bottom > bodyRect.top
                )
            };
        }, { assetId: pre.assetId });

        assert(
            post.cardEditing || post.creatorEditing,
            `item ${itemLabel} Edit opens editor after scroll adjustment`
        );
        assert(post.saveBtn, `item ${itemLabel} package Save visible after Edit`);
        if (index >= 16) {
            assert(post.editInScrollport, `item ${itemLabel} Edit brought into scrollport after handler`);
        }

        await livePage.evaluate(() => {
            document.querySelector('.vault-creator-card__btn--ghost')?.click();
        });
        await livePage.waitForTimeout(350);
    }

    await exerciseScrollPortEdit(0);
    for (const idx of [16, 17, 18, 19]) {
        if (idx < vaultCardCount) {
            await exerciseScrollPortEdit(idx);
        }
    }
    await livePage.close();
} catch (err) {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(msg)) {
        console.log(`  skip: frontend unavailable at ${FRONTEND}`);
    } else {
        assert(false, `browser vault edit test failed: ${msg}`);
    }
} finally {
    await browser?.close();
}

if (failures.length) {
    console.error('\nFAIL validate-studio-vault-edit');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-studio-vault-edit');
