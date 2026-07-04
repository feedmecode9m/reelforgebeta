<script>
    import {
        STUDIO_AUDIO_MODES,
        STUDIO_SOUNDTRACK_SOURCES,
        getStudioAudioStatus,
        loadStudioAudioPreference,
        muteStudioAudio,
        pauseStudioAudio,
        resumeStudioAudio,
        saveStudioAudioPreference,
        setStudioAudioMode,
        unmuteStudioAudio
    } from '../../lib/studio/studioAudioEngine.js';

    /** @type {boolean} */
    export let studioOpen = false;

    let mode = 'Off';
    let volume = 0.28;
    let loop = true;
    let muted = false;
    let customPlaylistText = '';
    let statusMessage = '';

    $: if (studioOpen) {
        const pref = loadStudioAudioPreference();
        mode = pref.mode;
        volume = pref.volume;
        loop = pref.loop;
        muted = pref.muted;
        customPlaylistText = (pref.customPlaylist || []).join('\n');
    }

    async function applyAmbientAudio() {
        const customPlaylist = customPlaylistText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        saveStudioAudioPreference({ mode, volume, customPlaylist, loop, muted });

        const result = await setStudioAudioMode(mode, {
            userGesture: true,
            volume,
            customPlaylist
        });

        const status = getStudioAudioStatus();
        statusMessage =
            result.ok && mode !== 'Off'
                ? `Ambient ${mode} · ${status.runtimeState}${status.muted ? ' · muted' : ''}`
                : mode === 'Off'
                  ? 'Ambient audio off'
                  : 'Preference saved — enable with Apply';
    }

    async function handlePause() {
        await pauseStudioAudio('panel');
        statusMessage = 'Ambient paused';
    }

    async function handleResume() {
        const result = await resumeStudioAudio({ userGesture: true });
        statusMessage = result.resumed ? 'Ambient resumed' : 'Resume blocked — open studio or apply mode first';
    }

    async function toggleMute() {
        muted = !muted;
        if (muted) {
            await muteStudioAudio();
            statusMessage = 'Ambient muted';
        } else {
            await unmuteStudioAudio();
            statusMessage = 'Ambient unmuted';
        }
    }
</script>

<section class="studio-ambient-audio" data-studio-ambient-audio>
    <div class="studio-ambient-audio__header">
        <h4>Ambient Audio</h4>
        <span class="studio-ambient-audio__hint">Studio active → audio active · theater fades out</span>
    </div>

    <label class="studio-ambient-audio__field">
        <span>Mode</span>
        <select bind:value={mode} data-studio-audio-mode>
            {#each STUDIO_AUDIO_MODES as option (option)}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </label>

    <label class="studio-ambient-audio__field">
        <span>Volume</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={volume} data-studio-audio-volume />
    </label>

    <label class="studio-ambient-audio__checkbox">
        <input type="checkbox" bind:checked={loop} data-studio-audio-loop />
        <span>Loop with crossfade</span>
    </label>

    {#if mode === 'Custom Playlist'}
        <label class="studio-ambient-audio__field">
            <span>Playlist URLs (one per line)</span>
            <textarea
                bind:value={customPlaylistText}
                rows="3"
                placeholder="https://example.com/ambient.mp3"
                data-studio-audio-playlist
            ></textarea>
        </label>
    {/if}

    <div class="studio-ambient-audio__controls">
        <button type="button" class="studio-ambient-audio__apply" data-studio-audio-apply on:click={applyAmbientAudio}>
            Apply Ambient Audio
        </button>
        <button type="button" class="studio-ambient-audio__btn" data-studio-audio-pause on:click={handlePause}>
            Pause
        </button>
        <button type="button" class="studio-ambient-audio__btn" data-studio-audio-resume on:click={handleResume}>
            Resume
        </button>
        <button
            type="button"
            class="studio-ambient-audio__btn"
            class:studio-ambient-audio__btn--active={muted}
            data-studio-audio-mute
            on:click={toggleMute}
        >
            {muted ? 'Unmute' : 'Mute'}
        </button>
    </div>

    <p class="studio-ambient-audio__future" data-studio-audio-future>
        Coming soon: {STUDIO_SOUNDTRACK_SOURCES.join(' · ')}
    </p>

    {#if statusMessage}
        <p class="studio-ambient-audio__status" role="status" data-studio-audio-status>{statusMessage}</p>
    {/if}
</section>

<style>
    .studio-ambient-audio {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.22);
        background: rgba(0, 242, 255, 0.04);
    }
    .studio-ambient-audio__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .studio-ambient-audio__header h4 {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #00f2ff;
    }
    .studio-ambient-audio__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-ambient-audio__field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-bottom: 0.55rem;
    }
    .studio-ambient-audio__field span {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .studio-ambient-audio__field select,
    .studio-ambient-audio__field textarea {
        padding: 0.45rem 0.6rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: inherit;
    }
    .studio-ambient-audio__checkbox {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin-bottom: 0.55rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .studio-ambient-audio__controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .studio-ambient-audio__apply,
    .studio-ambient-audio__btn {
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.08);
        color: #00f2ff;
        border-radius: 6px;
        padding: 0.4rem 0.75rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
    }
    .studio-ambient-audio__btn--active {
        border-color: rgba(255, 211, 110, 0.5);
        color: #ffd36e;
    }
    .studio-ambient-audio__future {
        margin: 0.55rem 0 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.35);
    }
    .studio-ambient-audio__status {
        margin: 0.45rem 0 0;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.55);
    }
</style>
