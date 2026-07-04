#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const REPORT_PATH = join(ROOT, 'creator-marketplace-report.json');

const MARKETPLACE_CATEGORIES = [
    'editing',
    'voice_over',
    'music',
    'vfx',
    'thumbnail_design',
    'script_writing',
    'marketing'
];

const CATEGORY_LABELS = [
    'Editing',
    'Voice Over',
    'Music',
    'VFX',
    'Thumbnail Design',
    'Script Writing',
    'Marketing'
];

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

const enginePath = join(SRC, 'lib/marketplace/marketplaceEngine.js');
const diagnosticsPath = join(SRC, 'lib/marketplace/marketplaceDiagnostics.js');

assert('marketplaceEngine.js exists', existsSync(enginePath));
assert('marketplaceDiagnostics.js exists', existsSync(diagnosticsPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const diagnosticsSrc = readFileSync(diagnosticsPath, 'utf8');

assert('MARKETPLACE_STORAGE_KEY is reelforge_creator_marketplace', engineSrc.includes("export const MARKETPLACE_STORAGE_KEY = 'reelforge_creator_marketplace'"));
assert('Creator builder exported', engineSrc.includes('export function buildCreator'));
assert('Service builder exported', engineSrc.includes('export function buildService'));
assert('Gig builder exported', engineSrc.includes('export function buildGig'));
assert('Portfolio builder exported', engineSrc.includes('export function buildPortfolio'));
assert('Review builder exported', engineSrc.includes('export function buildReview'));
assert('Editing category supported', engineSrc.includes("'editing'") && engineSrc.includes("'Editing'"));
assert('Voice Over category supported', engineSrc.includes("'voice_over'") && engineSrc.includes("'Voice Over'"));
assert('Music category supported', engineSrc.includes("'music'") && engineSrc.includes("'Music'"));
assert('VFX category supported', engineSrc.includes("'vfx'") && engineSrc.includes("'VFX'"));
assert('Thumbnail Design category supported', engineSrc.includes("'thumbnail_design'") && engineSrc.includes("'Thumbnail Design'"));
assert('Script Writing category supported', engineSrc.includes("'script_writing'") && engineSrc.includes("'Script Writing'"));
assert('Marketing category supported', engineSrc.includes("'marketing'") && engineSrc.includes("'Marketing'"));
assert('listMarketplaceListings exported', engineSrc.includes('export function listMarketplaceListings'));
assert('matchMarketplaceServices exported', engineSrc.includes('export function matchMarketplaceServices'));
assert('saveReview exported', engineSrc.includes('export function saveReview'));
assert('initMarketplaceEngine exported', engineSrc.includes('export function initMarketplaceEngine'));
assert('MARKETPLACE_LISTING diagnostics', diagnosticsSrc.includes("'MARKETPLACE_LISTING'"));
assert('MARKETPLACE_MATCH diagnostics', diagnosticsSrc.includes("'MARKETPLACE_MATCH'"));
assert('MARKETPLACE_REVIEW diagnostics', diagnosticsSrc.includes("'MARKETPLACE_REVIEW'"));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[MARKETPLACE_LISTING]') ||
        text.includes('[MARKETPLACE_MATCH]') ||
        text.includes('[MARKETPLACE_REVIEW]')
    ) {
        logs.push(text);
    }
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(800);

assert('marketplace hook initialized', await page.evaluate(() => Boolean(window.__reelforgeMarketplace)));

const unit = await page.evaluate(() => {
    const marketplace = window.__reelforgeMarketplace;
    marketplace.seedDefaultMarketplace();

    const listings = marketplace.listMarketplaceListings({ category: 'editing' });
    const matches = marketplace.matchMarketplaceServices({
        category: 'editing',
        budgetCents: 15000,
        keywords: 'edit',
        deliveryDaysMax: 7,
        limit: 3
    });

    const review = marketplace.saveReview({
        reviewId: 'review-editing-neon',
        gigId: 'gig-editing-neon',
        creatorId: 'creator-edit-nova',
        reviewerId: 'buyer-local',
        rating: 5,
        comment: 'Clean episodic edit with fast turnaround.'
    });

    const stored = JSON.parse(localStorage.getItem('reelforge_creator_marketplace') || '{}');

    return {
        creatorCount: Object.keys(stored.creators || {}).length,
        serviceCount: Object.keys(stored.services || {}).length,
        gigCount: Object.keys(stored.gigs || {}).length,
        portfolioCount: Object.keys(stored.portfolios || {}).length,
        reviewCount: Object.keys(stored.reviews || {}).length,
        categories: marketplace.MARKETPLACE_CATEGORIES,
        listingCount: listings.length,
        matchCount: matches.length,
        topMatchScore: matches[0]?.score || 0,
        reviewRating: review.rating,
        creatorRating: stored.creators?.['creator-edit-nova']?.rating || 0
    };
});

assert('marketplace data persists locally', unit.creatorCount >= 3 && unit.serviceCount >= 7);
assert('all entity types stored', unit.gigCount >= 1 && unit.portfolioCount >= 7 && unit.reviewCount >= 1);
assert('all marketplace categories modeled', MARKETPLACE_CATEGORIES.every((category) => unit.categories.includes(category)));
assert('category labels defined', CATEGORY_LABELS.every((label) => engineSrc.includes(`'${label}'`)));
assert('listings returned for category', unit.listingCount >= 1);
assert('matches returned for request', unit.matchCount >= 1);
assert('match scoring produces ranked results', unit.topMatchScore > 0);
assert('review saved with rating', unit.reviewRating === 5);
assert('creator rating updated from review', unit.creatorRating >= 5);

const listingLogs = parseLogs(logs, 'MARKETPLACE_LISTING');
const matchLogs = parseLogs(logs, 'MARKETPLACE_MATCH');
const reviewLogs = parseLogs(logs, 'MARKETPLACE_REVIEW');

assert('MARKETPLACE_LISTING emitted', listingLogs.length >= 1);
assert('MARKETPLACE_MATCH emitted', matchLogs.length >= 1);
assert('MARKETPLACE_REVIEW emitted', reviewLogs.length >= 1);

writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
        {
            storageKey: 'reelforge_creator_marketplace',
            categories: MARKETPLACE_CATEGORIES,
            unit,
            diagnostics: {
                listing: listingLogs.length,
                match: matchLogs.length,
                review: reviewLogs.length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Creator Marketplace Validation ===\n');
if (failed) {
    console.log('CREATOR_MARKETPLACE_COMPLETE=false');
    process.exit(1);
}

console.log('CREATOR_MARKETPLACE_COMPLETE=true');
