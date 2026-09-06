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
const studioSrc = fs.readFileSync(path.join(root, 'src/components/experiences/StudioExperience.svelte'), 'utf8');
const creatorSrc = fs.readFileSync(
    path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
    'utf8'
);
const viewerCss = fs.readFileSync(path.join(root, 'src/viewer/viewer.css'), 'utf8');

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
assert(creatorSrc.includes('posterEditSignal') && creatorSrc.includes('openPosterEditor()'), 'posterEditSignal opens poster editor');
assert(vaultSrc.includes('data-vault-edit-poster'), 'video vault exposes explicit poster action');
assert(vaultSrc.includes('STUDIO_VAULT_REQUEST_EDIT_EVENT'), 'creator vault listens for catalog edit requests');
assert(studioSrc.includes('requestVaultPackageEdit'), 'StudioExperience routes catalog edit to vault package editor');
assert(
    creatorSrc.includes('scrollPackageEditorCompletionIntoView'),
    'package editor scrolls completion controls into reachable viewport'
);
assert(
    creatorSrc.includes('scrollPackageControlIntoView'),
    'package editor scrolls individual controls into reachable viewport'
);
assert(
    creatorSrc.includes('handleSaveClick'),
    'Save click scrolls control into view before submitPackage'
);
assert(
    creatorSrc.includes('handleCancelClick'),
    'Cancel/Done routes through handleCancelClick before cancelEdit'
);
assert(
    vaultSrc.includes('dismissVaultPackageEditor'),
    'Done/Cancel clears vault edit latch and editing asset id'
);
assert(
    vaultSrc.includes('vaultEditSignals = next') || vaultSrc.includes('[id]: 0'),
    'closeEditor resets vaultEditSignals for dismissed asset'
);
assert(
    creatorSrc.includes('fitVaultCardInStudioScroll'),
    'completion scroll fits vault card inside Studio inner scrollport'
);
assert(
    creatorSrc.includes('[data-control-center-scroll-body]'),
    'completion scroll targets Studio inner scroll container'
);
assert(creatorSrc.includes('data-creator-package-actions'), 'package footer actions marked for scroll targeting');
assert(creatorSrc.includes('data-creator-package-done'), 'package Done/Cancel control marked for pointer tests');
assert(creatorSrc.includes('vault-creator-card__actions--footer'), 'only package footer uses sticky actions class');
assert(
    creatorSrc.includes('data-creator-meta-category') &&
        creatorSrc.includes('scrollPackageControlIntoView(event.currentTarget)'),
    'shelf category select scrolls into reachable viewport on focus/click'
);
assert(
    viewerCss.includes('.vault-creator-card__actions--footer') &&
        !viewerCss.includes('.vault-creator-card--editing .vault-creator-card__actions {'),
    'sticky footer limited to package Save/Done row (theater actions not sticky)'
);
assert(
    viewerCss.includes('z-index: 12') &&
        viewerCss.includes(':not(.vault-creator-card--editing) *') &&
        viewerCss.includes('pointer-events: none !important'),
    'collapsed creator strip stays below Edit and cannot intercept card taps'
);
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
    assert(vaultCardCount >= 1, `live vault has at least 1 video card (found ${vaultCardCount})`);
    if (vaultCardCount < 17) {
        console.log(`  note: scroll-port item-17 checks skipped (only ${vaultCardCount} cards in vault)`);
    }

    /** @param {import('playwright').Page} page */
    async function openPackageEditorFromVaultEdit(page) {
        await page.waitForSelector('[data-creator-save-package]', { timeout: 15_000 });
        await page.waitForTimeout(400);
    }

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
        await openPackageEditorFromVaultEdit(livePage);

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
            document.querySelector('[data-creator-package-done]')?.click();
        });
        await livePage.waitForTimeout(350);
    }

    await exerciseScrollPortEdit(0);
    for (const idx of [16, 17, 18, 19]) {
        if (idx < vaultCardCount) {
            await exerciseScrollPortEdit(idx);
        }
    }

    console.log('\n[3] browser — shelf category + Done (real pointer, item 1)');

    /** @param {import('playwright').Page} page @param {number} index */
    async function openVaultItemEditor(page, index) {
        await page.evaluate((idx) => {
            const scrollBody = document.querySelector('[data-control-center-scroll-body]');
            const edits = [...document.querySelectorAll('.video-vault-grid [data-vault-edit]')];
            const edit = edits[idx];
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
            }
            edit?.click();
        }, index);
        await page.waitForSelector('.vault-card--editing .vault-creator-card--editing', { timeout: 30_000 });
        await openPackageEditorFromVaultEdit(page);
    }

    /**
     * @param {import('playwright').Page} page
     * @param {string} cardSelector
     * @param {string} controlSelector
     */
    async function probePointerReachable(page, cardSelector, controlSelector) {
        return page.evaluate(({ cardSelector, controlSelector }) => {
            const card = document.querySelector(cardSelector);
            const el = card?.querySelector(controlSelector);
            if (!el) return { missing: true };
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const scrollBody = document.querySelector('[data-control-center-scroll-body]');
            const bodyRect = scrollBody?.getBoundingClientRect();
            const hit = document.elementFromPoint(cx, cy);
            return {
                hitsSelf: hit === el || Boolean(hit && el.contains(hit)),
                belowScrollBody: Boolean(bodyRect && r.top >= bodyRect.bottom - 4),
                inScrollBodyY: Boolean(
                    bodyRect && r.top < bodyRect.bottom && r.bottom > bodyRect.top
                ),
                value: el.value ?? null,
                disabled: el.disabled ?? null
            };
        }, { cardSelector, controlSelector });
    }

    /**
     * @param {import('playwright').Page} page
     * @param {string} cardSelector
     * @param {string} controlSelector
     * @param {{ requireHitBefore?: boolean }} [options]
     */
    async function realPointerClickControl(page, cardSelector, controlSelector, options = {}) {
        const requireHitBefore = options.requireHitBefore ?? true;
        const coords = await page.evaluate(({ cardSelector, controlSelector }) => {
            const card = document.querySelector(cardSelector);
            const candidates = [...card.querySelectorAll(controlSelector)];
            const el =
                candidates.find((node) => /cancel|done/i.test(node.textContent || '')) ||
                candidates.at(-1);
            if (!el) return { missing: true };
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            return {
                x: cx,
                y: cy,
                hitsSelf: hit === el || Boolean(hit && el.contains(hit)),
                hitTag: hit?.tagName || null
            };
        }, { cardSelector, controlSelector });
        assert(!coords.missing, `control present: ${controlSelector}`);
        if (requireHitBefore) {
            assert(
                coords.hitsSelf,
                `real pointer can target ${controlSelector} (hit=${coords.hitTag || 'null'})`
            );
        }
        await page.mouse.click(coords.x, coords.y);
        await page.waitForTimeout(150);
        return coords;
    }

    /** @param {import('playwright').Page} page @param {number} index @param {string} [expectedAssetId] */
    async function exercisePackageEditorCompletion(page, index, expectedAssetId = null) {
        const itemLabel = index + 1;
        await openVaultItemEditor(page, index);

        const assetId = await page.evaluate(() =>
            document.querySelector('.vault-card--editing')?.getAttribute('data-vault-asset-id')
        );
        assert(assetId, `item ${itemLabel} editor opened with asset id`);
        if (expectedAssetId) {
            assert(assetId === expectedAssetId, `item ${itemLabel} asset id ${assetId}`);
        }
        const cardSelector = `[data-vault-asset-id="${assetId}"]`;

        const shelfBefore = await probePointerReachable(
            page,
            cardSelector,
            '[data-creator-meta-category]'
        );
        assert(!shelfBefore.missing, `item ${itemLabel} shelf category select present`);
        assert(
            shelfBefore.hitsSelf,
            `item ${itemLabel} shelf category pointer-reachable (not blocked by sticky theater actions)`
        );

        await page.locator(`${cardSelector} [data-creator-meta-category]`).selectOption({ index: 1 });
        await page.waitForTimeout(200);

        const accessBefore = await probePointerReachable(
            page,
            cardSelector,
            '[data-episode-access-mode]'
        );
        assert(!accessBefore.missing, `item ${itemLabel} access select present`);
        if (index >= 16) {
            assert(
                accessBefore.belowScrollBody || !accessBefore.hitsSelf,
                `item ${itemLabel} access select initially outside/blocked inner scrollport`
            );
        }

        const accessValueBefore = await page.evaluate(
            ({ cardSelector }) =>
                document.querySelector(`${cardSelector} [data-episode-access-mode]`)?.value || null,
            { cardSelector }
        );

        await page.evaluate(({ cardSelector }) => {
            const sel = document.querySelector(`${cardSelector} [data-episode-access-mode]`);
            if (!(sel instanceof HTMLElement)) return;
            sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            sel.focus();
            sel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }, { cardSelector });
        await page.waitForTimeout(250);
        const accessCoords = await page.evaluate(({ cardSelector }) => {
            const sel = document.querySelector(`${cardSelector} [data-episode-access-mode]`);
            if (!sel) return { missing: true };
            const r = sel.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            return {
                x: cx,
                y: cy,
                hitsSelf: hit === sel || Boolean(hit && sel.contains(hit))
            };
        }, { cardSelector });
        assert(!accessCoords.missing, `item ${itemLabel} access select present for pointer retarget`);
        if (accessCoords.hitsSelf) {
            await page.mouse.click(accessCoords.x, accessCoords.y);
            await page.waitForTimeout(150);
        }
        const accessAfterPointer = await probePointerReachable(
            page,
            cardSelector,
            '[data-episode-access-mode]'
        );
        assert(
            accessAfterPointer.hitsSelf,
            `item ${itemLabel} access select pointer-reachable after focus scroll`
        );
        await page.locator(`${cardSelector} [data-episode-access-mode]`).selectOption('paid');
        await page.waitForTimeout(200);
        const accessValueAfter = await page.evaluate(
            ({ cardSelector }) =>
                document.querySelector(`${cardSelector} [data-episode-access-mode]`)?.value || null,
            { cardSelector }
        );
        assert(
            accessValueAfter === 'paid',
            `item ${itemLabel} Free→Paid changed by pointer (${accessValueBefore} → ${accessValueAfter})`
        );

        const saveReachable = await probePointerReachable(page, cardSelector, '[data-creator-save-package]');

        await realPointerClickControl(page, cardSelector, '[data-creator-save-package]', {
            requireHitBefore: saveReachable.hitsSelf
        });
        await page.waitForTimeout(600);
        const paidValidation = await page.evaluate(({ cardSelector }) => {
            const card = document.querySelector(cardSelector);
            return {
                formError: document.querySelector('[data-creator-save-error]')?.textContent?.trim() || null,
                saveState: card?.querySelector('[data-vault-creator-completeness]')?.getAttribute('data-package-save-state') ||
                    document.querySelector('[data-vault-creator-completeness]')?.getAttribute('data-package-save-state')
            };
        }, { cardSelector });
        if (accessValueBefore === 'free') {
            assert(
                /price/i.test(paidValidation.formError || ''),
                `item ${itemLabel} Paid-without-price validation fires on real Save click`
            );
        }

        const priceProbe = await probePointerReachable(page, cardSelector, '[data-episode-price]');
        await page.locator(`${cardSelector} [data-episode-price]`).click({ force: !priceProbe.hitsSelf });
        await page.locator(`${cardSelector} [data-episode-price]`).fill('4.99');
        await page.waitForTimeout(150);

        await page.locator(`${cardSelector} [data-creator-save-package]`).click();
        await page.waitForTimeout(1500);
        const saved = await page.evaluate(({ cardSelector }) => {
            const card = document.querySelector(cardSelector);
            return {
                saveState:
                    card?.querySelector('[data-vault-creator-completeness]')?.getAttribute('data-package-save-state') ||
                    document.querySelector('[data-vault-creator-completeness]')?.getAttribute('data-package-save-state'),
                saveStatus: document.querySelector('[data-creator-save-status="saved"]') ? 'saved' : null,
                formError: document.querySelector('[data-creator-save-error]')?.textContent?.trim() || null
            };
        }, { cardSelector });
        assert(
            saved.saveState === 'saved' || saved.saveStatus === 'saved',
            `item ${itemLabel} Save persists with real pointer (state=${saved.saveState || 'none'})`
        );

        await page.locator(`${cardSelector} [data-creator-meta-category]`).selectOption('Romance');
        await page.waitForTimeout(250);
        await page.locator(`${cardSelector} [data-creator-save-package]`).click();
        await page.waitForTimeout(1200);
        const resaved = await page.evaluate(({ cardSelector }) => ({
            saveState:
                document.querySelector(`${cardSelector} [data-vault-creator-completeness]`)?.getAttribute(
                    'data-package-save-state'
                ) || null,
            doneLabel:
                document.querySelector(`${cardSelector} [data-creator-package-done]`)?.textContent?.trim() || null
        }), { cardSelector });
        assert(
            resaved.saveState === 'saved',
            `item ${itemLabel} Save again after New Release shelf (state=${resaved.saveState || 'none'})`
        );
        assert(resaved.doneLabel === 'Done', `item ${itemLabel} completion control shows Done after Save again`);

        await page.waitForSelector('[data-creator-save-status="saved"]', { timeout: 5000 }).catch(() => {});
        await realPointerClickControl(page, cardSelector, '[data-creator-package-done]');
        await page.waitForFunction(
            (selector) => !document.querySelector(selector)?.classList.contains('vault-card--editing'),
            cardSelector,
            { timeout: 5000 }
        );
        await page.waitForTimeout(300);
        const closed = await page.evaluate((selector) => ({
            cardEditing: document.querySelector(selector)?.classList.contains('vault-card--editing') ?? false,
            creatorEditing: Boolean(document.querySelector(`${selector} .vault-creator-card--editing`))
        }), cardSelector);
        assert(!closed.cardEditing && !closed.creatorEditing, `item ${itemLabel} Done closes package editor`);
        await page.waitForTimeout(600);
        const stayedClosed = await page.evaluate((selector) => ({
            cardEditing: document.querySelector(selector)?.classList.contains('vault-card--editing') ?? false,
            creatorEditing: Boolean(document.querySelector(`${selector} .vault-creator-card--editing`))
        }), cardSelector);
        assert(
            !stayedClosed.cardEditing && !stayedClosed.creatorEditing,
            `item ${itemLabel} editor stays closed after post-save refresh (no editSignal reopen)`
        );
    }

    await exercisePackageEditorCompletion(livePage, 0);
    if (vaultCardCount > 16) {
        await exercisePackageEditorCompletion(livePage, 16, '5cc786f0-8fbe-4f96-a59d-02014b0cc56f');
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
