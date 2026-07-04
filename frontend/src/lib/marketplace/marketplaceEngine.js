/**
 * Phase 40 — Creator Marketplace foundation.
 * Local listings, matching, and reviews — no payment processors or external APIs.
 */

import { logMarketplaceDiag } from './marketplaceDiagnostics.js';

export const MARKETPLACE_ENGINE_VERSION = '1.0.0';
export const MARKETPLACE_STORAGE_KEY = 'reelforge_creator_marketplace';

/** @typedef {'editing' | 'voice_over' | 'music' | 'vfx' | 'thumbnail_design' | 'script_writing' | 'marketing'} MarketplaceCategory */

/**
 * @typedef {Object} Creator
 * @property {string} creatorId
 * @property {string} displayName
 * @property {string} bio
 * @property {MarketplaceCategory[]} categories
 * @property {number} rating
 * @property {number} reviewCount
 * @property {boolean} available
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Service
 * @property {string} serviceId
 * @property {string} creatorId
 * @property {MarketplaceCategory} category
 * @property {string} title
 * @property {string} description
 * @property {number} startingPriceCents
 * @property {number} deliveryDays
 * @property {boolean} active
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Gig
 * @property {string} gigId
 * @property {string} serviceId
 * @property {string} creatorId
 * @property {string} buyerId
 * @property {MarketplaceCategory} category
 * @property {string} title
 * @property {'open' | 'in_progress' | 'delivered' | 'completed' | 'cancelled'} status
 * @property {number} budgetCents
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Portfolio
 * @property {string} portfolioId
 * @property {string} creatorId
 * @property {MarketplaceCategory} category
 * @property {string} title
 * @property {string} summary
 * @property {string[]} sampleAssetIds
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Review
 * @property {string} reviewId
 * @property {string} gigId
 * @property {string} creatorId
 * @property {string} reviewerId
 * @property {number} rating
 * @property {string} comment
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} MarketplaceStore
 * @property {string} version
 * @property {Record<string, Creator>} creators
 * @property {Record<string, Service>} services
 * @property {Record<string, Gig>} gigs
 * @property {Record<string, Portfolio>} portfolios
 * @property {Record<string, Review>} reviews
 * @property {number} updatedAt
 */

export const MARKETPLACE_CATEGORIES = /** @type {MarketplaceCategory[]} */ ([
    'editing',
    'voice_over',
    'music',
    'vfx',
    'thumbnail_design',
    'script_writing',
    'marketing'
]);

/** @type {Record<MarketplaceCategory, string>} */
export const MARKETPLACE_CATEGORY_LABELS = {
    editing: 'Editing',
    voice_over: 'Voice Over',
    music: 'Music',
    vfx: 'VFX',
    thumbnail_design: 'Thumbnail Design',
    script_writing: 'Script Writing',
    marketing: 'Marketing'
};

/**
 * @param {Partial<Creator> & Pick<Creator, 'creatorId'>} patch
 * @returns {Creator}
 */
export function buildCreator(patch) {
    return {
        creatorId: patch.creatorId,
        displayName: patch.displayName || 'Creator',
        bio: patch.bio || '',
        categories: patch.categories || [],
        rating: Number.isFinite(patch.rating) ? patch.rating : 0,
        reviewCount: Number.isFinite(patch.reviewCount) ? patch.reviewCount : 0,
        available: patch.available ?? true,
        updatedAt: Date.now()
    };
}

/**
 * @param {Partial<Service> & Pick<Service, 'serviceId' | 'creatorId' | 'category'>} patch
 * @returns {Service}
 */
export function buildService(patch) {
    return {
        serviceId: patch.serviceId,
        creatorId: patch.creatorId,
        category: patch.category,
        title: patch.title || MARKETPLACE_CATEGORY_LABELS[patch.category],
        description: patch.description || '',
        startingPriceCents: patch.startingPriceCents ?? 5000,
        deliveryDays: patch.deliveryDays ?? 5,
        active: patch.active ?? true,
        updatedAt: Date.now()
    };
}

/**
 * @param {Partial<Gig> & Pick<Gig, 'gigId' | 'serviceId' | 'creatorId' | 'category'>} patch
 * @returns {Gig}
 */
export function buildGig(patch) {
    return {
        gigId: patch.gigId,
        serviceId: patch.serviceId,
        creatorId: patch.creatorId,
        buyerId: patch.buyerId || 'buyer-local',
        category: patch.category,
        title: patch.title || 'Marketplace Gig',
        status: patch.status || 'open',
        budgetCents: patch.budgetCents ?? 7500,
        updatedAt: Date.now()
    };
}

/**
 * @param {Partial<Portfolio> & Pick<Portfolio, 'portfolioId' | 'creatorId' | 'category'>} patch
 * @returns {Portfolio}
 */
export function buildPortfolio(patch) {
    return {
        portfolioId: patch.portfolioId,
        creatorId: patch.creatorId,
        category: patch.category,
        title: patch.title || 'Portfolio Sample',
        summary: patch.summary || '',
        sampleAssetIds: patch.sampleAssetIds || [],
        updatedAt: Date.now()
    };
}

/**
 * @param {Partial<Review> & Pick<Review, 'reviewId' | 'gigId' | 'creatorId' | 'reviewerId'>} patch
 * @returns {Review}
 */
export function buildReview(patch) {
    const rating = Number.isFinite(patch.rating) ? patch.rating : 5;
    return {
        reviewId: patch.reviewId,
        gigId: patch.gigId,
        creatorId: patch.creatorId,
        reviewerId: patch.reviewerId,
        rating: Math.min(5, Math.max(1, rating)),
        comment: patch.comment || '',
        updatedAt: Date.now()
    };
}

/** @returns {MarketplaceStore} */
export function getDefaultMarketplaceStore() {
    return {
        version: MARKETPLACE_ENGINE_VERSION,
        creators: {},
        services: {},
        gigs: {},
        portfolios: {},
        reviews: {},
        updatedAt: Date.now()
    };
}

/** @returns {MarketplaceStore} */
export function loadMarketplaceStore() {
    if (typeof window === 'undefined') return getDefaultMarketplaceStore();
    try {
        const raw = localStorage.getItem(MARKETPLACE_STORAGE_KEY);
        if (!raw) return getDefaultMarketplaceStore();
        const parsed = JSON.parse(raw);
        return {
            ...getDefaultMarketplaceStore(),
            ...parsed,
            creators: parsed.creators || {},
            services: parsed.services || {},
            gigs: parsed.gigs || {},
            portfolios: parsed.portfolios || {},
            reviews: parsed.reviews || {}
        };
    } catch {
        return getDefaultMarketplaceStore();
    }
}

/** @param {MarketplaceStore} store */
export function saveMarketplaceStore(store) {
    const payload = {
        ...store,
        version: MARKETPLACE_ENGINE_VERSION,
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(MARKETPLACE_STORAGE_KEY, JSON.stringify(payload));
    }
    return payload;
}

/**
 * @param {Partial<Creator> & Pick<Creator, 'creatorId'>} patch
 */
export function saveCreator(patch) {
    const store = loadMarketplaceStore();
    store.creators[patch.creatorId] = buildCreator({
        ...store.creators[patch.creatorId],
        ...patch
    });
    return saveMarketplaceStore(store).creators[patch.creatorId];
}

/**
 * @param {Partial<Service> & Pick<Service, 'serviceId' | 'creatorId' | 'category'>} patch
 */
export function saveService(patch) {
    const store = loadMarketplaceStore();
    store.services[patch.serviceId] = buildService({
        ...store.services[patch.serviceId],
        ...patch
    });
    return saveMarketplaceStore(store).services[patch.serviceId];
}

/**
 * @param {Partial<Gig> & Pick<Gig, 'gigId' | 'serviceId' | 'creatorId' | 'category'>} patch
 */
export function saveGig(patch) {
    const store = loadMarketplaceStore();
    store.gigs[patch.gigId] = buildGig({
        ...store.gigs[patch.gigId],
        ...patch
    });
    return saveMarketplaceStore(store).gigs[patch.gigId];
}

/**
 * @param {Partial<Portfolio> & Pick<Portfolio, 'portfolioId' | 'creatorId' | 'category'>} patch
 */
export function savePortfolio(patch) {
    const store = loadMarketplaceStore();
    store.portfolios[patch.portfolioId] = buildPortfolio({
        ...store.portfolios[patch.portfolioId],
        ...patch
    });
    return saveMarketplaceStore(store).portfolios[patch.portfolioId];
}

/**
 * @param {Partial<Review> & Pick<Review, 'reviewId' | 'gigId' | 'creatorId' | 'reviewerId'>} patch
 */
export function saveReview(patch) {
    const store = loadMarketplaceStore();
    const review = buildReview({
        ...store.reviews[patch.reviewId],
        ...patch
    });
    store.reviews[patch.reviewId] = review;

    const creatorReviews = Object.values(store.reviews).filter((item) => item.creatorId === review.creatorId);
    const ratingTotal = creatorReviews.reduce((sum, item) => sum + item.rating, 0);
    if (store.creators[review.creatorId]) {
        store.creators[review.creatorId] = {
            ...store.creators[review.creatorId],
            rating: Math.round((ratingTotal / creatorReviews.length) * 10) / 10,
            reviewCount: creatorReviews.length,
            updatedAt: Date.now()
        };
    }

    saveMarketplaceStore(store);

    logMarketplaceDiag('MARKETPLACE_REVIEW', {
        reviewId: review.reviewId,
        gigId: review.gigId,
        creatorId: review.creatorId,
        rating: review.rating,
        commentLength: review.comment.length
    });

    return review;
}

/**
 * @param {{ category?: MarketplaceCategory; creatorId?: string; activeOnly?: boolean }} [options]
 */
export function listMarketplaceListings(options = {}) {
    const store = loadMarketplaceStore();
    const activeOnly = options.activeOnly ?? true;

    const services = Object.values(store.services).filter((service) => {
        if (options.category && service.category !== options.category) return false;
        if (options.creatorId && service.creatorId !== options.creatorId) return false;
        if (activeOnly && !service.active) return false;
        return true;
    });

    const listings = services.map((service) => {
        const creator = store.creators[service.creatorId];
        const portfolios = Object.values(store.portfolios).filter(
            (portfolio) => portfolio.creatorId === service.creatorId && portfolio.category === service.category
        );
        return {
            listingId: service.serviceId,
            service,
            creator: creator || null,
            portfolios,
            categoryLabel: MARKETPLACE_CATEGORY_LABELS[service.category]
        };
    });

    logMarketplaceDiag('MARKETPLACE_LISTING', {
        count: listings.length,
        category: options.category || 'all',
        creatorId: options.creatorId || null,
        listingIds: listings.map((listing) => listing.listingId)
    });

    return listings;
}

/**
 * @param {{ category?: MarketplaceCategory; budgetCents?: number; keywords?: string; deliveryDaysMax?: number; limit?: number }} request
 */
export function matchMarketplaceServices(request = {}) {
    const store = loadMarketplaceStore();
    const keywords = (request.keywords || '').toLowerCase().trim();
    const budgetCents = request.budgetCents ?? Number.POSITIVE_INFINITY;
    const deliveryDaysMax = request.deliveryDaysMax ?? Number.POSITIVE_INFINITY;
    const limit = request.limit ?? 5;

    const scored = Object.values(store.services)
        .filter((service) => service.active)
        .filter((service) => !request.category || service.category === request.category)
        .filter((service) => service.startingPriceCents <= budgetCents)
        .filter((service) => service.deliveryDays <= deliveryDaysMax)
        .map((service) => {
            const creator = store.creators[service.creatorId];
            let score = 0;

            if (request.category && service.category === request.category) score += 40;
            if (creator?.available) score += 10;
            score += (creator?.rating || 0) * 8;
            score += Math.max(0, 20 - service.deliveryDays);

            const priceFit = budgetCents === Number.POSITIVE_INFINITY ? 10 : Math.max(0, 15 - Math.floor(service.startingPriceCents / Math.max(budgetCents, 1) * 15));
            score += priceFit;

            if (keywords) {
                const haystack = `${service.title} ${service.description} ${creator?.displayName || ''} ${creator?.bio || ''}`.toLowerCase();
                if (haystack.includes(keywords)) score += 25;
            }

            const portfolioCount = Object.values(store.portfolios).filter(
                (portfolio) => portfolio.creatorId === service.creatorId && portfolio.category === service.category
            ).length;
            score += Math.min(portfolioCount * 5, 15);

            return {
                service,
                creator: creator || null,
                score,
                categoryLabel: MARKETPLACE_CATEGORY_LABELS[service.category]
            };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    logMarketplaceDiag('MARKETPLACE_MATCH', {
        request: {
            category: request.category || null,
            budgetCents: Number.isFinite(request.budgetCents) ? request.budgetCents : null,
            keywords: request.keywords || null,
            deliveryDaysMax: Number.isFinite(request.deliveryDaysMax) ? request.deliveryDaysMax : null
        },
        matchCount: scored.length,
        topMatches: scored.map((match) => ({
            serviceId: match.service.serviceId,
            creatorId: match.service.creatorId,
            score: match.score
        }))
    });

    return scored;
}

/** @returns {string} */
export function getStudioCreatorId() {
    if (typeof window === 'undefined') return 'creator-user-owner-1';
    const userId = localStorage.getItem('reelforge_current_team_user') || 'user-owner-1';
    return `creator-${userId}`;
}

/**
 * @param {string} [displayName]
 * @returns {Creator}
 */
export function ensureStudioCreator(displayName = 'Studio Creator') {
    const creatorId = getStudioCreatorId();
    return saveCreator({
        creatorId,
        displayName,
        bio: 'ReelForge studio marketplace profile.',
        categories: [...MARKETPLACE_CATEGORIES],
        available: true
    });
}

/**
 * @param {Partial<Service> & { creatorDisplayName?: string; serviceId?: string; category: MarketplaceCategory }} patch
 * @returns {Service}
 */
export function createMarketplaceListing(patch) {
    const creatorId = patch.creatorId || getStudioCreatorId();
    ensureStudioCreator(patch.creatorDisplayName);
    const serviceId = patch.serviceId || `service-${Date.now()}`;
    const service = saveService({
        ...patch,
        serviceId,
        creatorId,
        active: patch.active ?? true
    });

    logMarketplaceDiag('MARKETPLACE_CREATE', {
        serviceId: service.serviceId,
        creatorId: service.creatorId,
        category: service.category,
        title: service.title
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated', { detail: { serviceId } }));
    }

    return service;
}

/**
 * @param {string} serviceId
 * @param {Partial<Service>} patch
 * @returns {Service | null}
 */
export function updateMarketplaceListing(serviceId, patch = {}) {
    const store = loadMarketplaceStore();
    const existing = store.services[serviceId];
    if (!existing) return null;

    const service = saveService({
        ...existing,
        ...patch,
        serviceId,
        creatorId: existing.creatorId,
        category: patch.category || existing.category
    });

    logMarketplaceDiag('MARKETPLACE_UPDATE', {
        serviceId,
        category: service.category,
        title: service.title,
        active: service.active
    });
    logMarketplaceDiag('MARKETPLACE_EDIT', {
        serviceId,
        category: service.category,
        title: service.title,
        active: service.active
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated', { detail: { serviceId } }));
    }

    return service;
}

/**
 * @param {string} serviceId
 * @returns {boolean}
 */
export function deleteMarketplaceListing(serviceId) {
    const store = loadMarketplaceStore();
    if (!store.services[serviceId]) return false;

    delete store.services[serviceId];
    saveMarketplaceStore(store);

    logMarketplaceDiag('MARKETPLACE_DELETE', { serviceId });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated', { detail: { serviceId, deleted: true } }));
    }

    return true;
}

/**
 * @param {{ query?: string; category?: MarketplaceCategory; activeOnly?: boolean }} [options]
 */
export function searchMarketplaceListings(options = {}) {
    const query = String(options.query || '').trim();
    const category = options.category;
    const activeOnly = options.activeOnly ?? true;

    if (query) {
        const matches = matchMarketplaceServices({
            category,
            keywords: query,
            limit: 50
        }).map((match) => ({
            listingId: match.service.serviceId,
            service: match.service,
            creator: match.creator,
            categoryLabel: match.categoryLabel,
            matchScore: match.score,
            portfolios: []
        }));
        logMarketplaceDiag('MARKETPLACE_SEARCH', {
            query,
            category: category || 'all',
            activeOnly,
            resultCount: matches.length
        });
        return matches;
    }
    const listings = listMarketplaceListings({ category, activeOnly });
    logMarketplaceDiag('MARKETPLACE_SEARCH', {
        query: null,
        category: category || 'all',
        activeOnly,
        resultCount: listings.length
    });
    return listings;
}

/** @returns {Gig[]} */
export function listOpenMarketplaceGigs() {
    const store = loadMarketplaceStore();
    return Object.values(store.gigs).filter((gig) => gig.status === 'open');
}

/**
 * @param {string} gigId
 * @param {string} [applicantCreatorId]
 * @returns {Gig | null}
 */
export function applyToMarketplaceGig(gigId, applicantCreatorId = getStudioCreatorId()) {
    const store = loadMarketplaceStore();
    const gig = store.gigs[gigId];
    if (!gig || gig.status !== 'open') return null;

    ensureStudioCreator();
    store.gigs[gigId] = {
        ...gig,
        status: 'in_progress',
        buyerId: applicantCreatorId,
        updatedAt: Date.now()
    };
    saveMarketplaceStore(store);

    logMarketplaceDiag('MARKETPLACE_APPLY', {
        gigId,
        applicantCreatorId,
        serviceId: gig.serviceId,
        category: gig.category
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated', { detail: { gigId } }));
    }

    return store.gigs[gigId];
}

/**
 * @param {number} [limit]
 * @returns {Array<{ type: string; id: string; title: string; at: number; status?: string; category?: string }>}
 */
export function getMarketplaceActivity(limit = 20) {
    const store = loadMarketplaceStore();
    /** @type {Array<{ type: string; id: string; title: string; at: number; status?: string; category?: string }>} */
    const entries = [];

    Object.values(store.services).forEach((service) => {
        entries.push({
            type: 'service',
            id: service.serviceId,
            title: service.title,
            at: service.updatedAt,
            category: service.category
        });
    });
    Object.values(store.gigs).forEach((gig) => {
        entries.push({
            type: 'gig',
            id: gig.gigId,
            title: gig.title,
            at: gig.updatedAt,
            status: gig.status,
            category: gig.category
        });
    });
    Object.values(store.reviews).forEach((review) => {
        entries.push({
            type: 'review',
            id: review.reviewId,
            title: `Review · ${review.rating}/5`,
            at: review.updatedAt
        });
    });

    return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** @returns {MarketplaceStore} */
export function seedDefaultMarketplace() {
    const store = getDefaultMarketplaceStore();

    const seedCreators = [
        {
            creatorId: 'creator-edit-nova',
            displayName: 'Nova Cut Lab',
            bio: 'Fast-turn episodic editing for creator series.',
            categories: ['editing', 'marketing'],
            rating: 4.8,
            reviewCount: 12
        },
        {
            creatorId: 'creator-voice-echo',
            displayName: 'Echo Lane VO',
            bio: 'Character voice over and narration packs.',
            categories: ['voice_over', 'script_writing'],
            rating: 4.9,
            reviewCount: 18
        },
        {
            creatorId: 'creator-vfx-pulse',
            displayName: 'Pulse Frame VFX',
            bio: 'Stylized compositing and motion graphics.',
            categories: ['vfx', 'thumbnail_design'],
            rating: 4.7,
            reviewCount: 9
        }
    ];

    seedCreators.forEach((creator) => {
        store.creators[creator.creatorId] = buildCreator(creator);
    });

    MARKETPLACE_CATEGORIES.forEach((category, index) => {
        const creator = seedCreators[index % seedCreators.length];
        const serviceId = `service-${category}-001`;
        store.services[serviceId] = buildService({
            serviceId,
            creatorId: creator.creatorId,
            category,
            title: `${MARKETPLACE_CATEGORY_LABELS[category]} Package`,
            description: `Local marketplace ${MARKETPLACE_CATEGORY_LABELS[category].toLowerCase()} offering for ReelForge creators.`,
            startingPriceCents: 4500 + index * 750,
            deliveryDays: 3 + (index % 4)
        });
        store.portfolios[`portfolio-${category}-001`] = buildPortfolio({
            portfolioId: `portfolio-${category}-001`,
            creatorId: creator.creatorId,
            category,
            title: `${MARKETPLACE_CATEGORY_LABELS[category]} Showcase`,
            summary: `Sample ${MARKETPLACE_CATEGORY_LABELS[category].toLowerCase()} work.`,
            sampleAssetIds: [`asset-${category}-demo`]
        });
    });

    const featuredService = store.services['service-editing-001'];
    store.gigs['gig-editing-neon'] = buildGig({
        gigId: 'gig-editing-neon',
        serviceId: featuredService.serviceId,
        creatorId: featuredService.creatorId,
        category: 'editing',
        title: 'Neon Vengeance Episodic Edit',
        status: 'completed',
        budgetCents: 12000
    });

    const openService = store.services['service-vfx-001'];
    store.gigs['gig-vfx-open'] = buildGig({
        gigId: 'gig-vfx-open',
        serviceId: openService.serviceId,
        creatorId: openService.creatorId,
        category: 'vfx',
        title: 'Open VFX Composite Gig',
        status: 'open',
        budgetCents: 8500
    });

    return saveMarketplaceStore(store);
}

let marketplaceEngineInitialized = false;

export function initMarketplaceEngine() {
    if (typeof window === 'undefined' || marketplaceEngineInitialized) return;
    marketplaceEngineInitialized = true;

    const store = loadMarketplaceStore();
    if (!Object.keys(store.services).length) {
        seedDefaultMarketplace();
    }

    window.__reelforgeMarketplace = {
        MARKETPLACE_ENGINE_VERSION,
        MARKETPLACE_STORAGE_KEY,
        MARKETPLACE_CATEGORIES,
        MARKETPLACE_CATEGORY_LABELS,
        loadMarketplaceStore,
        saveMarketplaceStore,
        buildCreator,
        buildService,
        buildGig,
        buildPortfolio,
        buildReview,
        saveCreator,
        saveService,
        saveGig,
        savePortfolio,
        saveReview,
        listMarketplaceListings,
        matchMarketplaceServices,
        searchMarketplaceListings,
        createMarketplaceListing,
        updateMarketplaceListing,
        deleteMarketplaceListing,
        listOpenMarketplaceGigs,
        applyToMarketplaceGig,
        getMarketplaceActivity,
        getStudioCreatorId,
        ensureStudioCreator,
        seedDefaultMarketplace,
        logMarketplaceDiag
    };

    logMarketplaceDiag('MARKETPLACE_LISTING', {
        phase: 'engine_initialized',
        version: MARKETPLACE_ENGINE_VERSION,
        storageKey: MARKETPLACE_STORAGE_KEY,
        categories: MARKETPLACE_CATEGORIES
    });
}
