<script>
import {
    fetchMonetizationStatus,
    fetchMonetizationConfig,
    updateSeriesMonetization,
    updateEpisodeMonetization,
    ACCESS_MODES
} from '../../lib/api/monetization.js';

/** @type {boolean} */
export let active = false;

/** @type {(msg: string) => void} */
export let onStatus = () => {};

let enabled = false;
let loading = false;
let error = '';
let config = null;
let selectedSeriesId = '';
let selectedEpisodeId = '';
let seriesDraft = {
    access_mode: 'FREE',
    free_episode_count: 0,
    season_price: '',
    vip_price: ''
};
let episodeDraft = {
    is_free_override: false,
    early_access: false,
    release_date: '',
    unlock_after_episode: ''
};
let saving = false;

$: seriesList = config?.series || [];
$: episodeOptions = seriesList
    .flatMap((s) =>
        (s.seasons || []).flatMap((season) =>
            (season.episodes || []).map((ep) => ({
                id: ep.id,
                label: `${s.title} — S${season.season_number}E${ep.episode_number}: ${ep.title}`,
                seriesId: s.id
            }))
        )
    );

$: if (active) {
    loadConfig();
}

$: if (selectedSeriesId && config) {
    const found = seriesList.find((s) => s.id === selectedSeriesId);
    if (found) {
        seriesDraft = {
            access_mode: found.access_mode || 'FREE',
            free_episode_count: found.free_episode_count ?? 0,
            season_price: found.season_price || '',
            vip_price: found.vip_price || ''
        };
    }
}

$: if (selectedEpisodeId && config) {
    const ep = episodeOptions.find((o) => o.id === selectedEpisodeId);
    if (ep) {
        for (const s of seriesList) {
            for (const season of s.seasons || []) {
                const match = (season.episodes || []).find((e) => e.id === selectedEpisodeId);
                if (match) {
                    episodeDraft = {
                        is_free_override: match.is_free_override || false,
                        early_access: match.early_access || false,
                        release_date: match.release_date
                            ? match.release_date.slice(0, 16)
                            : '',
                        unlock_after_episode:
                            match.unlock_after_episode != null
                                ? String(match.unlock_after_episode)
                                : ''
                    };
                }
            }
        }
    }
}

async function loadConfig() {
    loading = true;
    error = '';
    try {
        const status = await fetchMonetizationStatus();
        if (status?.disabled) {
            enabled = false;
            config = null;
            return;
        }
        enabled = true;
        config = await fetchMonetizationConfig();
        if (!selectedSeriesId && config?.series?.length) {
            selectedSeriesId = config.series[0].id;
        }
    } catch (err) {
        enabled = false;
        error = err?.message || 'Failed to load monetization config';
    } finally {
        loading = false;
    }
}

async function handleSaveSeries() {
    if (!selectedSeriesId) return;
    saving = true;
    try {
        await updateSeriesMonetization(selectedSeriesId, {
            access_mode: seriesDraft.access_mode,
            free_episode_count: Number(seriesDraft.free_episode_count) || 0,
            season_price: seriesDraft.season_price || '',
            vip_price: seriesDraft.vip_price || ''
        });
        await loadConfig();
        onStatus('✅ Series monetization saved');
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}

async function handleSaveEpisode() {
    if (!selectedEpisodeId) return;
    saving = true;
    try {
        await updateEpisodeMonetization(selectedEpisodeId, {
            is_free_override: episodeDraft.is_free_override,
            early_access: episodeDraft.early_access,
            release_date: episodeDraft.release_date
                ? new Date(episodeDraft.release_date).toISOString()
                : null,
            unlock_after_episode: episodeDraft.unlock_after_episode
                ? Number(episodeDraft.unlock_after_episode)
                : null
        });
        await loadConfig();
        onStatus('✅ Episode monetization saved');
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}
</script>

<div class="monetization-section">
    <div class="smart-header">
        <div class="ai-badge">💎 MONETIZATION</div>
        <h3>Access Strategy (Metadata Only)</h3>
        <p class="smart-subtitle">No payment processing — playback unchanged until paywall phase</p>
    </div>

    {#if loading}
        <p class="mono-hint">Loading monetization config...</p>
    {:else if !enabled}
        <p class="mono-hint">
            Monetization API disabled. Set <code>REELFORGE_MONETIZATION=true</code> on the backend.
        </p>
    {:else if error}
        <p class="mono-error">{error}</p>
    {:else}
        {#if config?.enforce_paywall === false}
            <p class="mono-hint">Paywall enforcement: <strong>off</strong> — all content remains playable.</p>
        {/if}

        <div class="mono-panel">
            <h4>Series</h4>
            <label class="input-label-wrapper">SELECT SERIES
                <select bind:value={selectedSeriesId}>
                    {#each seriesList as s (s.id)}
                        <option value={s.id}>{s.title}</option>
                    {/each}
                </select>
            </label>
            <label class="input-label-wrapper">SERIES ACCESS MODE
                <select bind:value={seriesDraft.access_mode}>
                    {#each ACCESS_MODES as mode}<option value={mode}>{mode}</option>{/each}
                </select>
            </label>
            <label class="input-label-wrapper">FREE EPISODES<input type="number" min="0" bind:value={seriesDraft.free_episode_count} /></label>
            <label class="input-label-wrapper">SEASON PASS PRICE<input type="text" bind:value={seriesDraft.season_price} placeholder="e.g. 9.99" /></label>
            <label class="input-label-wrapper">VIP PRICE<input type="text" bind:value={seriesDraft.vip_price} placeholder="e.g. 14.99" /></label>
            <button class="quick-upload-btn" type="button" disabled={saving || !selectedSeriesId} on:click={handleSaveSeries}>Save series monetization</button>
        </div>

        {#if episodeOptions.length > 0}
            <div class="mono-panel">
                <h4>Episode overrides</h4>
                <label class="input-label-wrapper">SELECT EPISODE
                    <select bind:value={selectedEpisodeId}>
                        <option value="">— optional —</option>
                        {#each episodeOptions as opt (opt.id)}
                            <option value={opt.id}>{opt.label}</option>
                        {/each}
                    </select>
                </label>
                {#if selectedEpisodeId}
                    <label class="mono-toggle"><input type="checkbox" bind:checked={episodeDraft.is_free_override} /> Free override</label>
                    <label class="mono-toggle"><input type="checkbox" bind:checked={episodeDraft.early_access} /> Early access</label>
                    <label class="input-label-wrapper">RELEASE DATE<input type="datetime-local" bind:value={episodeDraft.release_date} /></label>
                    <label class="input-label-wrapper">UNLOCK AFTER EPISODE #<input type="number" min="1" bind:value={episodeDraft.unlock_after_episode} placeholder="Episode number" /></label>
                    <button class="batch-upload-btn" type="button" disabled={saving} on:click={handleSaveEpisode}>Save episode monetization</button>
                {/if}
            </div>
        {/if}

        {#if !seriesList.length}
            <p class="mono-hint">No series found. Run studio hierarchy backfill first.</p>
        {/if}
    {/if}
</div>

<style>
    .monetization-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .mono-hint {
        color: rgba(255, 255, 255, 0.55);
        font-size: 0.85rem;
        margin: 0.5rem 0;
    }
    .mono-error {
        color: #f87171;
        font-size: 0.85rem;
    }
    .mono-panel {
        display: grid;
        gap: 0.5rem;
        margin-top: 1rem;
        padding: 0.75rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
    }
    .mono-panel h4 {
        margin: 0 0 0.25rem;
        font-size: 0.9rem;
        color: var(--neon-gold, #ffd700);
    }
    .mono-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.85);
    }
</style>
