<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        getGlobalSearchAnalytics,
        initGlobalSearchEngine,
        navigateGlobalSearchResult,
        searchGlobalCommands,
        suggestGlobalCommands
    } from '../../lib/search/globalSearchEngine.js';

    const RECENT_KEY = 'reelforge_global_search_recent';
    const PINNED_KEY = 'reelforge_global_search_pinned';
    const MAX_RECENT = 8;

    let open = false;
    let query = '';
    let results = [];
    let suggestions = [];
    let recentSearches = [];
    let pinnedSearches = [];
    let highlightedIndex = -1;
    let analytics = { totalQueries: 0, history: [], fieldHitCounts: {} };
    let adminMode = false;
    let panelRef;
    let inputRef;
    let debounceTimer = null;

    function logSearchUI(tag, detail = {}) {
        console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
    }

    function loadList(key) {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
        } catch {
            return [];
        }
    }

    function saveList(key, values) {
        if (typeof window === 'undefined') return;
        localStorage.setItem(key, JSON.stringify(values));
    }

    function hydrateSearchState() {
        recentSearches = loadList(RECENT_KEY);
        pinnedSearches = loadList(PINNED_KEY);
        try {
            adminMode = typeof window !== 'undefined' && localStorage.getItem('admin_mode') === 'true';
        } catch {
            adminMode = false;
        }
        analytics = getGlobalSearchAnalytics();
    }

    function pushRecent(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return;
        recentSearches = [trimmed, ...recentSearches.filter((item) => item !== trimmed)].slice(0, MAX_RECENT);
        saveList(RECENT_KEY, recentSearches);
    }

    function togglePinned(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return;
        if (pinnedSearches.includes(trimmed)) {
            pinnedSearches = pinnedSearches.filter((item) => item !== trimmed);
        } else {
            pinnedSearches = [trimmed, ...pinnedSearches].slice(0, MAX_RECENT);
        }
        saveList(PINNED_KEY, pinnedSearches);
    }

    function isPinned(value) {
        return pinnedSearches.includes(String(value || '').trim());
    }

    function openSearch(trigger = 'button') {
        open = true;
        highlightedIndex = -1;
        logSearchUI('SEARCH_OPEN', { trigger });
        setTimeout(() => inputRef?.focus(), 0);
        updateResults(query, { emitDiag: false });
    }

    function closeSearch() {
        open = false;
        highlightedIndex = -1;
    }

    function updateResults(value, options = {}) {
        const normalized = String(value || '').trim();
        if (!normalized) {
            results = [];
            suggestions = suggestGlobalCommands('').suggestions || [];
            return;
        }
        const response = searchGlobalCommands(normalized, { limit: 20 });
        results = response.results || [];
        suggestions = suggestGlobalCommands(normalized).suggestions || [];
        if (options.emitDiag !== false) {
            logSearchUI('GLOBAL_SEARCH', { query: normalized, resultCount: results.length });
        }
        if (adminMode) {
            analytics = getGlobalSearchAnalytics();
        }
    }

    function selectSearch(value, source = 'suggestion') {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        query = normalized;
        updateResults(normalized);
        pushRecent(normalized);
        logSearchUI('SEARCH_SELECT', { source, value: normalized });
    }

    function selectResult(result, source = 'result') {
        if (!result) return;
        const navigationOk = navigateGlobalSearchResult(result);
        pushRecent(query || result.command);
        logSearchUI('SEARCH_SELECT', {
            source,
            query: query.trim(),
            title: result.title,
            category: result.category,
            confidenceScore: result.confidenceScore,
            navigationOk
        });
        closeSearch();
    }

    function handleGlobalKeydown(event) {
        const target = /** @type {HTMLElement | null} */ (event.target);
        const tag = String(target?.tagName || '').toLowerCase();
        const isTypingTarget = tag === 'input' || tag === 'textarea' || target?.isContentEditable === true;

        if (event.key === 'k' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            openSearch('ctrl+k');
            return;
        }

        const isSlashKey = event.key === '/' || event.key === '?' || event.key === 'Slash' || event.code === 'Slash';
        if (isSlashKey && !isTypingTarget && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            openSearch('/');
            return;
        }

        if (!open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearch();
            return;
        }

        const optionCount = suggestions.length + results.length;
        if (event.key === 'ArrowDown' && optionCount > 0) {
            event.preventDefault();
            highlightedIndex = (highlightedIndex + 1 + optionCount) % optionCount;
            return;
        }
        if (event.key === 'ArrowUp' && optionCount > 0) {
            event.preventDefault();
            highlightedIndex = (highlightedIndex - 1 + optionCount) % optionCount;
            return;
        }
        if (event.key === 'Enter' && highlightedIndex >= 0) {
            event.preventDefault();
            if (highlightedIndex < suggestions.length) {
                selectSearch(suggestions[highlightedIndex], 'keyboard_suggestion');
            } else {
                const result = results[highlightedIndex - suggestions.length];
                selectResult(result, 'keyboard_result');
            }
        }
    }

    function handleDocumentClick(event) {
        if (!open) return;
        if (panelRef && !panelRef.contains(/** @type {Node} */ (event.target))) {
            closeSearch();
        }
    }

    $: {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (!open) return;
            updateResults(query);
        }, 120);
    }

    onMount(() => {
        initGlobalSearchEngine();
        hydrateSearchState();
        suggestions = suggestGlobalCommands('').suggestions || [];
        window.addEventListener('keydown', handleGlobalKeydown);
        window.addEventListener('click', handleDocumentClick);
    });

    onDestroy(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        window.removeEventListener('keydown', handleGlobalKeydown);
        window.removeEventListener('click', handleDocumentClick);
    });
</script>

<div class="global-search" data-global-search bind:this={panelRef}>
    <button
        type="button"
        class="global-search__open"
        data-global-search-open
        on:click={() => openSearch('button')}
    >
        Search ReelForge
        <span class="global-search__shortcut">/ or Ctrl+K</span>
    </button>

    {#if open}
        <div class="global-search__panel" data-global-search-panel>
            <div class="global-search__input-row">
                <input
                    bind:this={inputRef}
                    bind:value={query}
                    class="global-search__input"
                    data-global-search-input
                    placeholder="show revenue, open hero manager, security alerts, find episode 3..."
                />
                <button
                    type="button"
                    class="global-search__pin"
                    data-global-search-pin-btn
                    on:click={() => togglePinned(query)}
                    disabled={!query.trim()}
                >
                    {isPinned(query) ? 'Unpin' : 'Pin'}
                </button>
            </div>

            {#if pinnedSearches.length}
                <section class="global-search__section" data-global-search-pinned>
                    <h5>Pinned Commands</h5>
                    <div class="global-search__chips">
                        {#each pinnedSearches as item (item)}
                            <button type="button" on:click={() => selectSearch(item, 'pinned')}>
                                {item}
                            </button>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if recentSearches.length}
                <section class="global-search__section" data-global-search-recent>
                    <h5>Recent Commands</h5>
                    <div class="global-search__chips">
                        {#each recentSearches as item (item)}
                            <button type="button" on:click={() => selectSearch(item, 'recent')}>
                                {item}
                            </button>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if suggestions.length}
                <section class="global-search__section">
                    <h5>Suggestions</h5>
                    <ul class="global-search__list">
                        {#each suggestions as suggestion, index (suggestion)}
                            <li>
                                <button
                                    type="button"
                                    data-global-search-suggestion
                                    class:global-search__item--active={highlightedIndex === index}
                                    on:click={() => selectSearch(suggestion, 'suggestion')}
                                >
                                    {suggestion}
                                </button>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/if}

            <section class="global-search__section">
                <h5>Results ({results.length})</h5>
                <ul class="global-search__list">
                    {#if results.length === 0}
                        <li class="global-search__empty">Try commands like “show revenue” or “open marketplace”.</li>
                    {:else}
                        {#each results.slice(0, 12) as result, index (`${result.category}:${result.title}:${index}`)}
                            <li>
                                <button
                                    type="button"
                                    data-global-search-result
                                    class:global-search__item--active={highlightedIndex === suggestions.length + index}
                                    on:click={() => selectResult(result, 'result_click')}
                                >
                                    <strong>{result.title}</strong>
                                    <span>{result.category} · confidence {Math.round(result.confidenceScore * 100)}%</span>
                                </button>
                            </li>
                        {/each}
                    {/if}
                </ul>
            </section>

            {#if adminMode}
                <section class="global-search__section global-search__analytics" data-global-search-analytics>
                    <h5>Search Analytics (Admin)</h5>
                    <p>Total queries: {analytics.totalQueries || 0}</p>
                    <p>
                        Top hit fields:
                        {Object.entries(analytics.fieldHitCounts || {})
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 4)
                            .map(([field, count]) => `${field} (${count})`)
                            .join(' · ') || 'none'}
                    </p>
                </section>
            {/if}
        </div>
    {/if}
</div>

<style>
    .global-search {
        position: relative;
    }
    .global-search__open {
        min-width: 14rem;
        padding: 0.4rem 0.7rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.63rem;
        text-align: left;
        cursor: pointer;
    }
    .global-search__shortcut {
        margin-left: 0.45rem;
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.56rem;
    }
    .global-search__panel {
        position: absolute;
        top: calc(100% + 0.35rem);
        right: 0;
        width: min(38rem, 90vw);
        max-height: 30rem;
        overflow: auto;
        border-radius: 12px;
        border: 1px solid rgba(0, 242, 255, 0.25);
        background: rgba(8, 12, 20, 0.97);
        box-shadow: 0 20px 42px rgba(0, 0, 0, 0.48);
        padding: 0.75rem;
        z-index: 300;
    }
    .global-search__input-row {
        display: flex;
        gap: 0.45rem;
        margin-bottom: 0.65rem;
    }
    .global-search__input {
        flex: 1;
        padding: 0.48rem 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.68rem;
    }
    .global-search__pin {
        padding: 0.48rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.62rem;
        cursor: pointer;
    }
    .global-search__section {
        margin-bottom: 0.7rem;
    }
    .global-search__section h5 {
        margin: 0 0 0.35rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.55);
    }
    .global-search__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .global-search__chips button {
        padding: 0.3rem 0.5rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.78);
        font-size: 0.58rem;
        cursor: pointer;
    }
    .global-search__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0.25rem;
    }
    .global-search__list button {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 0.45rem 0.55rem;
        text-align: left;
        background: rgba(255, 255, 255, 0.02);
        color: rgba(255, 255, 255, 0.88);
        cursor: pointer;
    }
    .global-search__list button strong {
        display: block;
        font-size: 0.67rem;
    }
    .global-search__list button span {
        display: block;
        margin-top: 0.15rem;
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .global-search__item--active {
        border-color: rgba(0, 242, 255, 0.45) !important;
        background: rgba(0, 242, 255, 0.1) !important;
    }
    .global-search__empty {
        padding: 0.4rem 0.2rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .global-search__analytics {
        padding: 0.55rem;
        border: 1px solid rgba(0, 242, 255, 0.2);
        border-radius: 8px;
        background: rgba(0, 242, 255, 0.07);
    }
    .global-search__analytics p {
        margin: 0.2rem 0 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.72);
    }
</style>
