<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        MARKETPLACE_CATEGORIES,
        MARKETPLACE_CATEGORY_LABELS,
        applyToMarketplaceGig,
        createMarketplaceListing,
        deleteMarketplaceListing,
        getMarketplaceActivity,
        loadMarketplaceStore,
        saveGig,
        getStudioCreatorId,
        initMarketplaceEngine,
        listOpenMarketplaceGigs,
        searchMarketplaceListings,
        updateMarketplaceListing
    } from '../../lib/marketplace/marketplaceEngine.js';
    import { buildRevenueDashboardBrief } from '../../lib/revenue/revenueCore.js';
    import { createNotification, getUnreadCount } from '../../lib/notifications/notificationCenter.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';
    import {
        assignTaskToMember,
        ensureTeamForSeries,
        getCurrentTeamUserId,
        getOpenTasksForAssignment
    } from '../../lib/teams/creatorTeams.js';

    /** @type {'browse' | 'create' | 'my-listings' | 'opportunities' | 'transactions' | 'analytics'} */
    let activeSection = 'browse';
    const FAVORITES_KEY = 'reelforge_marketplace_favorites';
    const HUB_SECTIONS = [
        { id: 'editing', label: 'Editors' },
        { id: 'thumbnail_design', label: 'Thumbnail Artists' },
        { id: 'voice_over', label: 'Voice Talent' },
        { id: 'script_writing', label: 'Producers' },
        { id: 'marketing', label: 'Marketing' }
    ];
    /** @type {Set<string>} */
    let favoriteCreatorIds = new Set();
    let hiringMessage = '';
    let integrationSnapshot = {
        unreadNotifications: 0,
        openTeamTasks: 0,
        revenueSeries: '$0.00'
    };

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';
    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    let searchQuery = '';

    /** @type {string} */
    let filterCategory = '';

    /** @type {ReturnType<typeof searchMarketplaceListings>} */
    let browseResults = [];

    /** @type {ReturnType<typeof searchMarketplaceListings>} */
    let myListings = [];

    /** @type {ReturnType<typeof listOpenMarketplaceGigs>} */
    let openGigs = [];

    /** @type {ReturnType<typeof getMarketplaceActivity>} */
    let activity = [];

    /** @type {ReturnType<typeof getMarketplaceActivity>} */
    let transactionEntries = [];

    let analyticsSummary = {
        activeListings: 0,
        openApplications: 0,
        transactions: 0,
        completedTransactions: 0,
        inProgressTransactions: 0,
        averageListingPriceCents: 0
    };

    /** @type {string | null} */
    let editingServiceId = null;

    /** @type {string} */
    let createTitle = '';

    /** @type {import('../../lib/marketplace/marketplaceEngine.js').MarketplaceCategory} */
    let createCategory = 'editing';

    /** @type {string} */
    let createDescription = '';

    /** @type {number} */
    let createPriceCents = 5000;

    /** @type {number} */
    let createDeliveryDays = 5;

    /** @type {string} */
    let createMessage = '';

    /** @type {string} */
    let editTitle = '';

    /** @type {string} */
    let editDescription = '';

    /** @type {number} */
    let editPriceCents = 5000;

    /** @type {number} */
    let editDeliveryDays = 5;

    const studioCreatorId = getStudioCreatorId();

    function refresh() {
        initMarketplaceEngine();
        browseResults = searchMarketplaceListings({
            query: searchQuery,
            category: filterCategory || undefined,
            activeOnly: true
        });
        myListings = searchMarketplaceListings({ activeOnly: true }).filter((listing) => {
            const service = listing.service || listing;
            return service.creatorId === studioCreatorId;
        });
        openGigs = listOpenMarketplaceGigs();
        activity = getMarketplaceActivity(25);
        integrationSnapshot = {
            unreadNotifications: getUnreadCount(),
            openTeamTasks: getOpenTasksForAssignment(seriesId).length,
            revenueSeries: buildRevenueDashboardBrief(seriesId, feedReels).kpis.seriesRevenue.formatted
        };
    }

    function emitHub(event, detail = {}) {
        console.log(`[MARKETPLACE_HUB] ${JSON.stringify({ event, ...detail, timestamp: Date.now() })}`);
    }

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            const ids = raw ? JSON.parse(raw) : [];
            favoriteCreatorIds = new Set(Array.isArray(ids) ? ids.map(String) : []);
        } catch {
            favoriteCreatorIds = new Set();
        }
    }

    function persistFavorites() {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteCreatorIds]));
    }

    function handleCreateListing() {
        const title = createTitle.trim();
        if (!title) {
            createMessage = 'Title is required.';
            return;
        }

        createMarketplaceListing({
            serviceId: `service-${Date.now()}`,
            category: createCategory,
            title,
            description: createDescription.trim() || `${title} — studio marketplace listing.`,
            startingPriceCents: Math.max(0, Number(createPriceCents) || 0),
            deliveryDays: Math.max(1, Number(createDeliveryDays) || 1),
            creatorDisplayName: 'Studio Creator'
        });

        createTitle = '';
        createDescription = '';
        createPriceCents = 5000;
        createDeliveryDays = 5;
        createMessage = 'Listing created.';
        activeSection = 'my-listings';
        emitHub('create_listing', {
            category: createCategory,
            title,
            creatorId: studioCreatorId
        });
        refresh();
    }

    /**
     * @param {string} creatorId
     */
    async function handleFavoriteCreator(creatorId) {
        if (!creatorId) return;
        if (favoriteCreatorIds.has(creatorId)) favoriteCreatorIds.delete(creatorId);
        else favoriteCreatorIds.add(creatorId);
        persistFavorites();
        await createNotification(
            'workflow_assigned',
            favoriteCreatorIds.has(creatorId)
                ? `Creator ${creatorId} added to marketplace favorites.`
                : `Creator ${creatorId} removed from marketplace favorites.`,
            { creatorId, favorited: favoriteCreatorIds.has(creatorId) }
        );
        emitHub('favorite_creator', {
            creatorId,
            favorited: favoriteCreatorIds.has(creatorId)
        });
        refresh();
    }

    /**
     * @param {string} listingId
     */
    async function handleHireCreator(listingId) {
        const listing = browseResults.find((item) => (item.listingId || item.service?.serviceId) === listingId);
        const service = listing?.service;
        if (!service) return;
        const gigId = `gig-hire-${Date.now()}`;
        const gig = saveGig({
            gigId,
            serviceId: service.serviceId,
            creatorId: service.creatorId,
            category: service.category,
            title: `Hire ${service.title}`,
            buyerId: studioCreatorId,
            status: 'open',
            budgetCents: service.startingPriceCents
        });
        await applyToMarketplaceGig(gigId, studioCreatorId);
        const team = await ensureTeamForSeries(seriesId);
        if (team?.id) {
            await assignTaskToMember(team.id, `marketplace-hire-${gigId}`, getCurrentTeamUserId(), seriesId);
        }
        await createNotification(
            'workflow_assigned',
            `Marketplace hire started for ${service.title}.`,
            { listingId, gigId, creatorId: service.creatorId, serviceId: service.serviceId, seriesId }
        );
        window.dispatchEvent(new CustomEvent('reelforge:revenue-updated', { detail: { source: 'marketplace_hire', gig } }));
        hiringMessage = `Hired ${listing?.creator?.displayName || service.creatorId} for ${service.title}.`;
        emitHub('hire_creator', {
            listingId,
            creatorId: service.creatorId,
            gigId
        });
        refresh();
    }

    /**
     * @param {string} serviceId
     */
    function startEditListing(serviceId) {
        const listing = myListings.find((item) => (item.service?.serviceId || item.listingId) === serviceId);
        const service = listing?.service;
        if (!service) return;

        editingServiceId = serviceId;
        editTitle = service.title;
        editDescription = service.description;
        editPriceCents = service.startingPriceCents;
        editDeliveryDays = service.deliveryDays;
    }

    function saveEditListing() {
        if (!editingServiceId) return;

        updateMarketplaceListing(editingServiceId, {
            title: editTitle.trim() || editTitle,
            description: editDescription.trim(),
            startingPriceCents: Math.max(0, Number(editPriceCents) || 0),
            deliveryDays: Math.max(1, Number(editDeliveryDays) || 1)
        });

        editingServiceId = null;
        refresh();
    }

    /**
     * @param {string} serviceId
     */
    function handleDeleteListing(serviceId) {
        deleteMarketplaceListing(serviceId);
        if (editingServiceId === serviceId) editingServiceId = null;
        refresh();
    }

    /**
     * @param {string} gigId
     */
    function handleApplyToGig(gigId) {
        applyToMarketplaceGig(gigId);
        refresh();
    }

    /**
     * @param {'browse' | 'create' | 'my-listings' | 'opportunities' | 'transactions' | 'analytics'} section
     */
    function selectSection(section) {
        activeSection = section;
        emitHub('section_open', { section });
        emitAccessibilityAudit('MarketplaceDashboard', {
            action: 'section_change',
            section
        });
    }

    /** @param {KeyboardEvent} event @param {number} index */
    function handleSectionKeydown(event, index) {
        const key = event.key;
        const sections = ['browse', 'create', 'my-listings', 'opportunities', 'transactions', 'analytics'];
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const direction = key === 'ArrowLeft' ? -1 : 1;
        const nextIndex =
            key === 'Home'
                ? 0
                : key === 'End'
                    ? sections.length - 1
                    : (index + direction + sections.length) % sections.length;
        const nextSection = /** @type {'browse' | 'create' | 'my-listings' | 'opportunities' | 'transactions' | 'analytics'} */ (sections[nextIndex]);
        selectSection(nextSection);
        /** @type {HTMLButtonElement | null} */
        const nextButton = document.querySelector(`[data-marketplace-section="${nextSection}"]`);
        nextButton?.focus();
    }

    /**
     * @param {number} cents
     */
    function formatPrice(cents) {
        return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
    }

    onMount(() => {
        loadFavorites();
        refresh();
        emitAccessibilityAudit('MarketplaceDashboard', {
            action: 'mount',
            section: activeSection
        });
        emitHub('hub_mount', {
            seriesId,
            sectionCount: HUB_SECTIONS.length
        });
        const onUpdate = () => refresh();
        window.addEventListener('reelforge:marketplace-updated', onUpdate);
        return () => window.removeEventListener('reelforge:marketplace-updated', onUpdate);
    });

    onDestroy(() => {});

    $: transactionEntries = activity.filter((entry) => entry.type === 'gig');
    $: analyticsSummary = {
        activeListings: browseResults.length,
        openApplications: openGigs.length,
        transactions: transactionEntries.length,
        completedTransactions: transactionEntries.filter((entry) => entry.status === 'completed').length,
        inProgressTransactions: transactionEntries.filter((entry) => entry.status === 'in_progress').length,
        averageListingPriceCents: browseResults.length
            ? Math.round(
                  browseResults.reduce((sum, listing) => sum + (listing.service?.startingPriceCents || 0), 0) /
                      browseResults.length
              )
            : 0
    };
    $: searchQuery, filterCategory, refresh();
</script>

<section class="marketplace-dashboard" data-marketplace-dashboard aria-label="Marketplace Hub">
    <div class="marketplace-dashboard__header">
        <h5>Marketplace Hub</h5>
        <span>{studioCreatorId} · {HUB_SECTIONS.length} hub sections</span>
    </div>
    <div class="marketplace-dashboard__hub-sections" data-marketplace-hub-sections>
        {#each HUB_SECTIONS as hub (hub.id)}
            <button
                type="button"
                class:active={filterCategory === hub.id}
                aria-pressed={filterCategory === hub.id}
                data-marketplace-hub-section={hub.id}
                on:click={() => {
                    filterCategory = filterCategory === hub.id ? '' : hub.id;
                    activeSection = 'browse';
                    emitHub('hub_filter', { section: hub.id, active: filterCategory === hub.id });
                }}
            >
                {hub.label}
            </button>
        {/each}
    </div>

    <div class="marketplace-dashboard__integration" data-marketplace-hub-integrations>
        <article data-marketplace-hub-revenue>
            <span>Revenue Dashboard</span>
            <strong>{integrationSnapshot.revenueSeries}</strong>
        </article>
        <article data-marketplace-hub-notifications>
            <span>Notifications</span>
            <strong>{integrationSnapshot.unreadNotifications} unread</strong>
        </article>
        <article data-marketplace-hub-teams>
            <span>Teams</span>
            <strong>{integrationSnapshot.openTeamTasks} open tasks</strong>
        </article>
    </div>

    <div class="marketplace-dashboard__nav" aria-label="Marketplace sections" role="tablist">
        <button
            type="button"
            id="marketplace-section-tab-browse"
            class:active={activeSection === 'browse'}
            role="tab"
            aria-selected={activeSection === 'browse'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'browse' ? 'page' : undefined}
            tabindex={activeSection === 'browse' ? 0 : -1}
            data-marketplace-section="browse"
            on:click={() => selectSection('browse')}
            on:keydown={(event) => handleSectionKeydown(event, 0)}
        >
            Browse Marketplace
        </button>
        <button
            type="button"
            id="marketplace-section-tab-create"
            class:active={activeSection === 'create'}
            role="tab"
            aria-selected={activeSection === 'create'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'create' ? 'page' : undefined}
            tabindex={activeSection === 'create' ? 0 : -1}
            data-marketplace-section="create"
            on:click={() => selectSection('create')}
            on:keydown={(event) => handleSectionKeydown(event, 1)}
        >
            Create Listing
        </button>
        <button
            type="button"
            id="marketplace-section-tab-my-listings"
            class:active={activeSection === 'my-listings'}
            role="tab"
            aria-selected={activeSection === 'my-listings'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'my-listings' ? 'page' : undefined}
            tabindex={activeSection === 'my-listings' ? 0 : -1}
            data-marketplace-section="my-listings"
            on:click={() => selectSection('my-listings')}
            on:keydown={(event) => handleSectionKeydown(event, 2)}
        >
            My Listings
        </button>
        <button
            type="button"
            id="marketplace-section-tab-opportunities"
            class:active={activeSection === 'opportunities'}
            role="tab"
            aria-selected={activeSection === 'opportunities'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'opportunities' ? 'page' : undefined}
            tabindex={activeSection === 'opportunities' ? 0 : -1}
            data-marketplace-section="opportunities"
            on:click={() => selectSection('opportunities')}
            on:keydown={(event) => handleSectionKeydown(event, 3)}
        >
            Applications
        </button>
        <button
            type="button"
            id="marketplace-section-tab-transactions"
            class:active={activeSection === 'transactions'}
            role="tab"
            aria-selected={activeSection === 'transactions'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'transactions' ? 'page' : undefined}
            tabindex={activeSection === 'transactions' ? 0 : -1}
            data-marketplace-section="transactions"
            on:click={() => selectSection('transactions')}
            on:keydown={(event) => handleSectionKeydown(event, 4)}
        >
            Transactions
        </button>
        <button
            type="button"
            id="marketplace-section-tab-analytics"
            class:active={activeSection === 'analytics'}
            role="tab"
            aria-selected={activeSection === 'analytics'}
            aria-controls="marketplace-section-panel"
            aria-current={activeSection === 'analytics' ? 'page' : undefined}
            tabindex={activeSection === 'analytics' ? 0 : -1}
            data-marketplace-section="analytics"
            on:click={() => selectSection('analytics')}
            on:keydown={(event) => handleSectionKeydown(event, 5)}
        >
            Marketplace Analytics
        </button>
    </div>

    {#if activeSection === 'browse'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel"
            data-marketplace-browse
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-browse"
            aria-live="polite"
        >
            <div class="marketplace-dashboard__toolbar">
                <input
                    type="search"
                    placeholder="Search listings…"
                    bind:value={searchQuery}
                    data-marketplace-search
                />
                <select bind:value={filterCategory} data-marketplace-category-filter>
                    <option value="">All categories</option>
                    {#each MARKETPLACE_CATEGORIES as category}
                        <option value={category}>{MARKETPLACE_CATEGORY_LABELS[category]}</option>
                    {/each}
                </select>
            </div>
            <ul class="marketplace-dashboard__list" data-marketplace-browse-results>
                {#each browseResults as listing (listing.listingId || listing.service?.serviceId)}
                    {@const service = listing.service || listing}
                    <li
                        class="marketplace-dashboard__item"
                        data-marketplace-listing={service.serviceId}
                    >
                        <strong>{service.title}</strong>
                        <span>{MARKETPLACE_CATEGORY_LABELS[service.category] || service.category}</span>
                        <span>{listing?.creator?.displayName || service.creatorId}</span>
                        <em>{formatPrice(service.startingPriceCents)} · {service.deliveryDays}d</em>
                        {#if listing.matchScore}
                            <small>Match {listing.matchScore}</small>
                        {/if}
                        <div class="marketplace-dashboard__actions">
                            <button
                                type="button"
                                data-marketplace-hire={service.serviceId}
                                on:click={() => handleHireCreator(service.serviceId)}
                            >
                                Hire Creator
                            </button>
                            <button
                                type="button"
                                data-marketplace-favorite={service.creatorId}
                                on:click={() => handleFavoriteCreator(service.creatorId)}
                            >
                                {favoriteCreatorIds.has(service.creatorId) ? 'Favorited' : 'Favorite Creator'}
                            </button>
                        </div>
                    </li>
                {:else}
                    <li class="marketplace-dashboard__empty">No listings match your search.</li>
                {/each}
            </ul>
            {#if hiringMessage}
                <p class="marketplace-dashboard__message" data-marketplace-hire-message>{hiringMessage}</p>
            {/if}
        </div>
    {/if}

    {#if activeSection === 'create'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel"
            data-marketplace-create-panel
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-create"
        >
            <form
                class="marketplace-dashboard__form"
                data-marketplace-create-form
                on:submit|preventDefault={handleCreateListing}
            >
                <label>
                    Title
                    <input type="text" bind:value={createTitle} data-marketplace-create-title required />
                </label>
                <label>
                    Category
                    <select bind:value={createCategory} data-marketplace-create-category>
                        {#each MARKETPLACE_CATEGORIES as category}
                            <option value={category}>{MARKETPLACE_CATEGORY_LABELS[category]}</option>
                        {/each}
                    </select>
                </label>
                <label>
                    Description
                    <textarea bind:value={createDescription} rows="3" data-marketplace-create-description />
                </label>
                <div class="marketplace-dashboard__row">
                    <label>
                        Starting price (¢)
                        <input type="number" min="0" bind:value={createPriceCents} data-marketplace-create-price />
                    </label>
                    <label>
                        Delivery days
                        <input type="number" min="1" bind:value={createDeliveryDays} data-marketplace-create-delivery />
                    </label>
                </div>
                <button type="submit" data-marketplace-create-btn>Create Listing</button>
                {#if createMessage}
                    <p class="marketplace-dashboard__message" data-marketplace-create-message>{createMessage}</p>
                {/if}
            </form>
        </div>
    {/if}

    {#if activeSection === 'my-listings'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel"
            data-marketplace-my-listings
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-my-listings"
        >
            <ul class="marketplace-dashboard__list">
                {#each myListings as listing (listing.listingId || listing.service?.serviceId)}
                    {@const service = listing.service || listing}
                    <li
                        class="marketplace-dashboard__item marketplace-dashboard__item--owned"
                        data-marketplace-my-listing={service.serviceId}
                    >
                        <div>
                            <strong data-marketplace-listing-title={service.serviceId}>{service.title}</strong>
                            <span>{MARKETPLACE_CATEGORY_LABELS[service.category]}</span>
                            <em>{formatPrice(service.startingPriceCents)}</em>
                        </div>
                        <div class="marketplace-dashboard__actions">
                            <button
                                type="button"
                                data-marketplace-edit={service.serviceId}
                                on:click={() => startEditListing(service.serviceId)}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                data-marketplace-delete={service.serviceId}
                                on:click={() => handleDeleteListing(service.serviceId)}
                            >
                                Delete
                            </button>
                        </div>
                    </li>
                {:else}
                    <li class="marketplace-dashboard__empty">You have no listings yet. Create one to get started.</li>
                {/each}
            </ul>

            {#if editingServiceId}
                <form
                    class="marketplace-dashboard__form marketplace-dashboard__edit"
                    data-marketplace-edit-form={editingServiceId}
                    on:submit|preventDefault={saveEditListing}
                >
                    <h6>Edit listing</h6>
                    <label>
                        Title
                        <input type="text" bind:value={editTitle} data-marketplace-edit-title required />
                    </label>
                    <label>
                        Description
                        <textarea bind:value={editDescription} rows="3" data-marketplace-edit-description />
                    </label>
                    <div class="marketplace-dashboard__row">
                        <label>
                            Price (¢)
                            <input type="number" min="0" bind:value={editPriceCents} data-marketplace-edit-price />
                        </label>
                        <label>
                            Delivery days
                            <input type="number" min="1" bind:value={editDeliveryDays} data-marketplace-edit-delivery />
                        </label>
                    </div>
                    <button type="submit" data-marketplace-save-edit>Save Changes</button>
                </form>
            {/if}
        </div>
    {/if}

    {#if activeSection === 'opportunities'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel"
            data-marketplace-opportunities
            data-marketplace-applications
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-opportunities"
        >
            <ul class="marketplace-dashboard__list">
                {#each openGigs as gig (gig.gigId)}
                    <li class="marketplace-dashboard__item" data-marketplace-opportunity={gig.gigId}>
                        <strong>{gig.title}</strong>
                        <span>{MARKETPLACE_CATEGORY_LABELS[gig.category]}</span>
                        <em>Budget {formatPrice(gig.budgetCents)}</em>
                        <button
                            type="button"
                            data-marketplace-apply={gig.gigId}
                            on:click={() => handleApplyToGig(gig.gigId)}
                        >
                            Apply
                        </button>
                    </li>
                {:else}
                    <li class="marketplace-dashboard__empty">No open gigs right now.</li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if activeSection === 'transactions'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel"
            data-marketplace-transactions-panel
            data-marketplace-activity-panel
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-transactions"
        >
            <ul class="marketplace-dashboard__list" data-marketplace-transactions data-marketplace-activity>
                {#each transactionEntries as entry (entry.type + entry.id)}
                    <li class="marketplace-dashboard__item marketplace-dashboard__item--activity">
                        <strong>{entry.title}</strong>
                        <span>{entry.type}</span>
                        {#if entry.status}
                            <em>{entry.status}</em>
                        {/if}
                        {#if entry.category}
                            <small>{MARKETPLACE_CATEGORY_LABELS[entry.category] || entry.category}</small>
                        {/if}
                    </li>
                {:else}
                    <li class="marketplace-dashboard__empty">No transactions yet.</li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if activeSection === 'analytics'}
        <div
            id="marketplace-section-panel"
            class="marketplace-dashboard__panel marketplace-dashboard__analytics"
            data-marketplace-analytics
            role="tabpanel"
            aria-labelledby="marketplace-section-tab-analytics"
            aria-live="polite"
        >
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="active-listings">
                <span>Active Listings</span>
                <strong>{analyticsSummary.activeListings}</strong>
            </article>
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="open-applications">
                <span>Open Applications</span>
                <strong>{analyticsSummary.openApplications}</strong>
            </article>
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="transactions">
                <span>Transactions</span>
                <strong>{analyticsSummary.transactions}</strong>
            </article>
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="in-progress">
                <span>In Progress</span>
                <strong>{analyticsSummary.inProgressTransactions}</strong>
            </article>
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="completed">
                <span>Completed</span>
                <strong>{analyticsSummary.completedTransactions}</strong>
            </article>
            <article class="marketplace-dashboard__analytics-card" data-marketplace-metric="avg-price">
                <span>Avg Listing Price</span>
                <strong>{formatPrice(analyticsSummary.averageListingPriceCents)}</strong>
            </article>
        </div>
    {/if}
</section>

<style>
    .marketplace-dashboard {
        margin-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .marketplace-dashboard__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }
    .marketplace-dashboard__header h5 {
        margin: 0;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.72);
    }
    .marketplace-dashboard__header span {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.42);
    }
    .marketplace-dashboard__nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .marketplace-dashboard__hub-sections {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .marketplace-dashboard__hub-sections button {
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.75);
        font-size: 0.58rem;
        padding: 0.28rem 0.5rem;
        border-radius: 999px;
        cursor: pointer;
    }
    .marketplace-dashboard__hub-sections button.active {
        border-color: rgba(120, 220, 255, 0.45);
        background: rgba(120, 220, 255, 0.12);
        color: rgba(220, 245, 255, 0.95);
    }
    .marketplace-dashboard__integration {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.45rem;
    }
    .marketplace-dashboard__integration article {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.4rem;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.03);
    }
    .marketplace-dashboard__integration span {
        display: block;
        font-size: 0.54rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .marketplace-dashboard__integration strong {
        font-size: 0.78rem;
        color: rgba(220, 245, 255, 0.95);
    }
    .marketplace-dashboard__nav button {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.58rem;
        padding: 0.35rem 0.55rem;
        border-radius: 999px;
        cursor: pointer;
    }
    .marketplace-dashboard__nav button.active {
        border-color: rgba(120, 220, 255, 0.45);
        background: rgba(120, 220, 255, 0.12);
        color: rgba(220, 245, 255, 0.95);
    }
    .marketplace-dashboard__panel {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.55rem;
        padding: 0.65rem;
        background: rgba(0, 0, 0, 0.22);
    }
    .marketplace-dashboard__toolbar {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
    }
    .marketplace-dashboard__toolbar input,
    .marketplace-dashboard__toolbar select,
    .marketplace-dashboard__form input,
    .marketplace-dashboard__form select,
    .marketplace-dashboard__form textarea {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.88);
        border-radius: 0.35rem;
        padding: 0.35rem 0.45rem;
        font-size: 0.62rem;
    }
    .marketplace-dashboard__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }
    .marketplace-dashboard__item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.45rem;
        padding: 0.45rem 0.5rem;
        border-radius: 0.4rem;
        background: rgba(255, 255, 255, 0.03);
        font-size: 0.62rem;
    }
    .marketplace-dashboard__item strong {
        flex: 1 1 100%;
        color: rgba(255, 255, 255, 0.9);
    }
    .marketplace-dashboard__item span,
    .marketplace-dashboard__item em,
    .marketplace-dashboard__item small {
        color: rgba(255, 255, 255, 0.52);
    }
    .marketplace-dashboard__item--owned {
        justify-content: space-between;
    }
    .marketplace-dashboard__actions {
        display: flex;
        gap: 0.35rem;
    }
    .marketplace-dashboard__actions button,
    .marketplace-dashboard__form button,
    .marketplace-dashboard__item button {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(120, 220, 255, 0.1);
        color: rgba(220, 245, 255, 0.92);
        border-radius: 0.35rem;
        padding: 0.3rem 0.55rem;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .marketplace-dashboard__form {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }
    .marketplace-dashboard__form label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.62);
    }
    .marketplace-dashboard__row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
    }
    .marketplace-dashboard__edit {
        margin-top: 0.65rem;
        padding-top: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .marketplace-dashboard__edit h6 {
        margin: 0;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.72);
    }
    .marketplace-dashboard__empty {
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.62rem;
        padding: 0.35rem 0;
    }
    .marketplace-dashboard__message {
        margin: 0;
        font-size: 0.58rem;
        color: rgba(160, 240, 180, 0.9);
    }
    .marketplace-dashboard__analytics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0.45rem;
    }
    .marketplace-dashboard__analytics-card {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.4rem;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.03);
    }
    .marketplace-dashboard__analytics-card span {
        display: block;
        font-size: 0.54rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .marketplace-dashboard__analytics-card strong {
        font-size: 0.8rem;
        color: rgba(220, 245, 255, 0.95);
    }
</style>
