/**
 * Phase 32 — Studio Ambient Audio Engine.
 * Procedural Web Audio loops; never shares output with theater playback.
 */

export const STUDIO_AUDIO_MODES = /** @type {const} */ ([
    'Off',
    'Lo-Fi',
    'Cinematic',
    'Drama',
    'Sci-Fi',
    'Epic',
    'Custom Playlist'
]);

/** Future soundtrack layers — resolved when team/series/workspace APIs are wired. */
export const STUDIO_SOUNDTRACK_SOURCES = /** @type {const} */ ([
    'Team Soundtrack',
    'Series Soundtrack',
    'Workspace Soundtrack'
]);

export const STUDIO_AUDIO_PREF_KEY = 'reelforge_studio_ambient_audio';
const FADE_MS = 900;
const DEFAULT_VOLUME = 0.28;

/** @typedef {'idle' | 'playing' | 'paused' | 'fading'} StudioAudioState */

/**
 * @typedef {Object} StudioAudioPreference
 * @property {typeof STUDIO_AUDIO_MODES[number]} mode
 * @property {number} volume
 * @property {string[]} customPlaylist
 * @property {boolean} loop
 * @property {boolean} muted
 * @property {boolean} armed
 */

/** @type {AudioContext | null} */
let audioContext = null;
/** @type {GainNode | null} */
let masterGain = null;
/** @type {OscillatorNode[]} */
let oscillators = [];
/** @type {HTMLAudioElement | null} */
let mediaElement = null;
/** @type {MediaElementAudioSourceNode | null} */
let mediaSource = null;
/** @type {ReturnType<typeof setInterval> | null} */
let fadeTimer = null;

/** @type {StudioAudioState} */
let runtimeState = 'idle';
/** @type {typeof STUDIO_AUDIO_MODES[number]} */
let activeMode = 'Off';
/** @type {typeof STUDIO_AUDIO_MODES[number]} */
let preferredMode = 'Off';
let activeVolume = DEFAULT_VOLUME;
/** @type {string[]} */
let customPlaylist = [];
let loopEnabled = true;
let muted = false;
let pausedForTheater = false;
let userArmed = false;
let studioOpen = false;
let volumeBeforeMute = DEFAULT_VOLUME;

/**
 * @param {'AUDIO_START' | 'AUDIO_STOP' | 'AUDIO_FADE' | 'AUDIO_RESUME'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logStudioAudioDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {StudioAudioPreference} */
export function loadStudioAudioPreference() {
    if (typeof window === 'undefined') {
        return { mode: 'Off', volume: DEFAULT_VOLUME, customPlaylist: [], loop: true, muted: false, armed: false };
    }
    try {
        const raw = localStorage.getItem(STUDIO_AUDIO_PREF_KEY);
        if (!raw) {
            return { mode: 'Off', volume: DEFAULT_VOLUME, customPlaylist: [], loop: true, muted: false, armed: false };
        }
        const parsed = JSON.parse(raw);
        const mode = STUDIO_AUDIO_MODES.includes(parsed.mode) ? parsed.mode : 'Off';
        return {
            mode,
            volume: Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_VOLUME,
            customPlaylist: Array.isArray(parsed.customPlaylist)
                ? parsed.customPlaylist.map(String).filter(Boolean)
                : [],
            loop: parsed.loop !== false,
            muted: Boolean(parsed.muted),
            armed: Boolean(parsed.armed)
        };
    } catch {
        return { mode: 'Off', volume: DEFAULT_VOLUME, customPlaylist: [], loop: true, muted: false, armed: false };
    }
}

/** @param {Partial<StudioAudioPreference>} patch */
export function saveStudioAudioPreference(patch = {}) {
    const current = loadStudioAudioPreference();
    const next = {
        mode: patch.mode && STUDIO_AUDIO_MODES.includes(patch.mode) ? patch.mode : current.mode,
        volume:
            patch.volume != null && Number.isFinite(patch.volume)
                ? Math.max(0, Math.min(1, patch.volume))
                : current.volume,
        customPlaylist: patch.customPlaylist ? patch.customPlaylist.map(String).filter(Boolean) : current.customPlaylist,
        loop: patch.loop != null ? Boolean(patch.loop) : current.loop,
        muted: patch.muted != null ? Boolean(patch.muted) : current.muted,
        armed: patch.armed != null ? Boolean(patch.armed) : current.armed
    };
    preferredMode = next.mode;
    activeVolume = next.volume;
    customPlaylist = next.customPlaylist;
    loopEnabled = next.loop;
    muted = next.muted;
    userArmed = next.armed;
    if (typeof window !== 'undefined') {
        localStorage.setItem(STUDIO_AUDIO_PREF_KEY, JSON.stringify(next));
    }
    return next;
}

/** @returns {Record<string, unknown>} */
export function getStudioAudioStatus() {
    return {
        runtimeState,
        activeMode,
        preferredMode,
        volume: activeVolume,
        loop: loopEnabled,
        muted,
        pausedForTheater,
        userArmed,
        studioOpen,
        customPlaylistCount: customPlaylist.length,
        futureSoundtracks: STUDIO_SOUNDTRACK_SOURCES,
        audioContextState: audioContext?.state || 'none',
        theaterSafe: !isTheaterVideoAudible()
    };
}

/** @returns {boolean} */
function isTheaterVideoAudible() {
    if (typeof document === 'undefined') return false;
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
        if (!video.paused && !video.muted && video.volume > 0) return true;
    }
    return false;
}

function clearFadeTimer() {
    if (fadeTimer) {
        clearInterval(fadeTimer);
        fadeTimer = null;
    }
}

function teardownSources() {
    for (const osc of oscillators) {
        try {
            osc.stop();
        } catch {
            // already stopped
        }
        osc.disconnect();
    }
    oscillators = [];

    if (mediaElement) {
        mediaElement.pause();
        mediaElement.removeAttribute('src');
        mediaElement.load();
        mediaElement = null;
    }
    mediaSource = null;
}

/**
 * @param {number} from
 * @param {number} to
 * @param {number} durationMs
 * @param {(value: number) => void} [onFrame]
 * @returns {Promise<void>}
 */
function fadeGainTo(from, to, durationMs, onFrame) {
    return new Promise((resolve) => {
        if (!masterGain || !audioContext) {
            resolve();
            return;
        }
        clearFadeTimer();
        runtimeState = 'fading';
        logStudioAudioDiag('AUDIO_FADE', { from, to, durationMs });

        const start = audioContext.currentTime;
        const end = start + durationMs / 1000;
        masterGain.gain.cancelScheduledValues(start);
        masterGain.gain.setValueAtTime(from, start);
        masterGain.gain.linearRampToValueAtTime(to, end);

        fadeTimer = setInterval(() => {
            const value = masterGain?.gain.value ?? to;
            onFrame?.(value);
            if (!masterGain || !audioContext) {
                clearFadeTimer();
                resolve();
            }
        }, 50);

        setTimeout(() => {
            clearFadeTimer();
            if (masterGain) masterGain.gain.value = to;
            resolve();
        }, durationMs + 30);
    });
}

/** @param {boolean} userGesture */
async function ensureAudioContext(userGesture = false) {
    if (typeof window === 'undefined') return false;
    if (!audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        audioContext = new Ctx();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(audioContext.destination);
    }

    if (audioContext.state === 'suspended') {
        if (!userGesture) {
            logStudioAudioDiag('AUDIO_START', {
                blocked: true,
                reason: 'autoplay-policy',
                audioContextState: audioContext.state
            });
            return false;
        }
        await audioContext.resume();
    }

    return audioContext.state === 'running';
}

/**
 * @param {typeof STUDIO_AUDIO_MODES[number]} mode
 */
function createProceduralAmbient(mode) {
    if (!audioContext || !masterGain) return;

    /** @type {{ type: OscillatorType; freq: number; gain: number }[]} */
    const profiles = {
        'Lo-Fi': [
            { type: 'sine', freq: 220, gain: 0.05 },
            { type: 'triangle', freq: 329.63, gain: 0.035 }
        ],
        Cinematic: [
            { type: 'sine', freq: 65.41, gain: 0.04 },
            { type: 'sawtooth', freq: 130.81, gain: 0.025 }
        ],
        Drama: [
            { type: 'triangle', freq: 146.83, gain: 0.04 },
            { type: 'sine', freq: 220, gain: 0.03 }
        ],
        'Sci-Fi': [
            { type: 'square', freq: 110, gain: 0.018 },
            { type: 'sine', freq: 440, gain: 0.022 }
        ],
        Epic: [
            { type: 'sawtooth', freq: 55, gain: 0.035 },
            { type: 'triangle', freq: 110, gain: 0.03 }
        ]
    };

    const layers = profiles[mode] || profiles['Lo-Fi'];
    for (const layer of layers) {
        const osc = audioContext.createOscillator();
        osc.type = layer.type;
        osc.frequency.value = layer.freq;
        const gain = audioContext.createGain();
        gain.gain.value = layer.gain;
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        oscillators.push(osc);
    }
}

/** @param {string} url */
async function createCustomPlaylistSource(url) {
    if (!audioContext || !masterGain || !url) return false;

    mediaElement = new Audio();
    mediaElement.crossOrigin = 'anonymous';
    mediaElement.loop = loopEnabled;
    mediaElement.preload = 'auto';
    mediaElement.volume = 1;
    mediaElement.src = url;

    await mediaElement.play().catch(() => {
        throw new Error('custom-playlist-blocked');
    });

    mediaSource = audioContext.createMediaElementSource(mediaElement);
    mediaSource.connect(masterGain);
    return true;
}

/**
 * Future soundtrack resolver — returns playlist URLs when team/series/workspace soundtracks ship.
 * @param {{ teamId?: string; seriesId?: string; workspaceId?: string }} context
 */
export function resolveFutureSoundtrack(context = {}) {
    if (context.teamId) {
        return { source: 'Team Soundtrack', urls: [], ready: false };
    }
    if (context.seriesId) {
        return { source: 'Series Soundtrack', urls: [], ready: false };
    }
    if (context.workspaceId) {
        return { source: 'Workspace Soundtrack', urls: [], ready: false };
    }
    return { source: null, urls: [], ready: false };
}

/**
 * @param {{ userGesture?: boolean; reason?: string }} [options]
 */
export async function startStudioAudio(options = {}) {
    const userGesture = options.userGesture === true;
    const pref = loadStudioAudioPreference();
    preferredMode = pref.mode;
    activeMode = pref.mode;
    activeVolume = pref.volume;
    customPlaylist = pref.customPlaylist;
    loopEnabled = pref.loop;
    muted = pref.muted;
    if (options.userGesture === true) userArmed = true;
    else if (pref.armed) userArmed = true;

    if (activeMode === 'Off') {
        await stopStudioAudio('mode-off');
        return { ok: true, playing: false };
    }

    if (!studioOpen) {
        logStudioAudioDiag('AUDIO_START', { blocked: true, reason: 'studio-closed' });
        return { ok: false, playing: false, reason: 'studio-closed' };
    }

    if (isTheaterVideoAudible()) {
        logStudioAudioDiag('AUDIO_START', { blocked: true, reason: 'theater-active' });
        return { ok: false, playing: false, reason: 'theater-active' };
    }

    const ready = await ensureAudioContext(userGesture);
    if (!ready) {
        return { ok: false, playing: false, reason: 'autoplay-policy' };
    }

    teardownSources();
    userArmed = true;
    pausedForTheater = false;

    try {
        if (activeMode === 'Custom Playlist' && customPlaylist.length > 0) {
            await createCustomPlaylistSource(customPlaylist[0]);
        } else {
            createProceduralAmbient(activeMode === 'Custom Playlist' ? 'Lo-Fi' : activeMode);
        }
    } catch (error) {
        createProceduralAmbient('Lo-Fi');
        logStudioAudioDiag('AUDIO_START', {
            fallback: true,
            reason: String(error?.message || error)
        });
    }

    await fadeGainTo(0, muted ? 0 : activeVolume, FADE_MS);
    runtimeState = muted ? 'paused' : 'playing';

    saveStudioAudioPreference({ armed: true });

    logStudioAudioDiag('AUDIO_START', {
        mode: activeMode,
        volume: activeVolume,
        muted,
        loop: loopEnabled,
        procedural: activeMode !== 'Custom Playlist' || customPlaylist.length === 0
    });

    return { ok: true, playing: true, mode: activeMode };
}

/**
 * @param {string} [reason]
 * @param {{ preserveArmed?: boolean }} [options]
 */
export async function stopStudioAudio(reason = 'manual', options = {}) {
    const preserveArmed = options.preserveArmed === true;

    if (runtimeState === 'idle' && !oscillators.length && !mediaElement) {
        logStudioAudioDiag('AUDIO_STOP', { reason, alreadyStopped: true });
        return { ok: true };
    }

    await fadeGainTo(masterGain?.gain.value ?? activeVolume, 0, FADE_MS);
    teardownSources();
    runtimeState = 'idle';
    if (!preserveArmed) {
        activeMode = 'Off';
        userArmed = false;
        saveStudioAudioPreference({ armed: false });
    }
    pausedForTheater = false;

    logStudioAudioDiag('AUDIO_STOP', { reason, temporary: preserveArmed });
    return { ok: true };
}

/** Pause ambient audio while theater is active — keeps preference armed for resume. */
export async function pauseStudioAudioForTheater() {
    if (runtimeState !== 'playing' || !masterGain) {
        pausedForTheater = preferredMode !== 'Off' && userArmed;
        if (pausedForTheater) {
            logStudioAudioDiag('AUDIO_STOP', {
                reason: 'theater-playback',
                temporary: true,
                alreadyPaused: runtimeState !== 'playing'
            });
        }
        return { ok: true, paused: pausedForTheater };
    }

    pausedForTheater = true;
    await fadeGainTo(masterGain.gain.value, 0, FADE_MS);
    runtimeState = 'paused';

    logStudioAudioDiag('AUDIO_STOP', { reason: 'theater-playback', temporary: true });
    return { ok: true, paused: true };
}

/** Resume ambient audio after theater closes when studio is still open. */
export async function resumeStudioAudioAfterTheater() {
    if (!pausedForTheater || preferredMode === 'Off' || !studioOpen || !userArmed) {
        pausedForTheater = false;
        return { ok: true, resumed: false };
    }

    if (isTheaterVideoAudible()) {
        logStudioAudioDiag('AUDIO_RESUME', { blocked: true, reason: 'theater-still-active' });
        return { ok: false, resumed: false, reason: 'theater-still-active' };
    }

    const ready = await ensureAudioContext(false);
    if (!ready || !masterGain) {
        logStudioAudioDiag('AUDIO_RESUME', { blocked: true, reason: 'audio-context-not-ready' });
        return { ok: false, resumed: false };
    }

    if (!oscillators.length && !mediaElement) {
        activeMode = preferredMode;
        if (activeMode === 'Custom Playlist' && customPlaylist.length > 0) {
            try {
                await createCustomPlaylistSource(customPlaylist[0]);
            } catch {
                createProceduralAmbient('Lo-Fi');
            }
        } else {
            createProceduralAmbient(activeMode === 'Custom Playlist' ? 'Lo-Fi' : activeMode);
        }
    } else if (mediaElement) {
        try {
            await mediaElement.play();
        } catch {
            // theater may still hold focus — remain paused
            return { ok: false, resumed: false, reason: 'media-play-blocked' };
        }
    }

    await fadeGainTo(0, muted ? 0 : activeVolume, FADE_MS);
    runtimeState = muted ? 'paused' : 'playing';
    pausedForTheater = false;

    logStudioAudioDiag('AUDIO_RESUME', {
        mode: preferredMode,
        volume: activeVolume,
        afterTheater: true
    });

    return { ok: true, resumed: true };
}

/** Manual pause — keeps preference armed for resume. */
export async function pauseStudioAudio(reason = 'manual') {
    if (!['playing', 'fading'].includes(runtimeState) || !masterGain) {
        return { ok: true, paused: false };
    }

    if (mediaElement) mediaElement.pause();
    await fadeGainTo(masterGain.gain.value, 0, FADE_MS);
    runtimeState = 'paused';

    logStudioAudioDiag('AUDIO_STOP', { reason, temporary: true, manual: true });
    return { ok: true, paused: true };
}

/** Manual resume after pause (not theater-driven). */
export async function resumeStudioAudio(options = {}) {
    if (preferredMode === 'Off' || !studioOpen || !userArmed) {
        return { ok: true, resumed: false };
    }

    if (isTheaterVideoAudible()) {
        logStudioAudioDiag('AUDIO_RESUME', { blocked: true, reason: 'theater-active' });
        return { ok: false, resumed: false, reason: 'theater-active' };
    }

    return startStudioAudio({ userGesture: options.userGesture === true, reason: 'manual-resume' });
}

/** @param {number} volume */
export async function setStudioAudioVolume(volume) {
    activeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    saveStudioAudioPreference({ volume: activeVolume });
    if (masterGain && runtimeState === 'playing' && !muted) {
        await fadeGainTo(masterGain.gain.value, activeVolume, Math.min(FADE_MS, 400));
    }
    return { ok: true, volume: activeVolume };
}

/** Mute ambient output without tearing down sources. */
export async function muteStudioAudio() {
    muted = true;
    volumeBeforeMute = activeVolume;
    saveStudioAudioPreference({ muted: true });
    if (masterGain) {
        await fadeGainTo(masterGain.gain.value, 0, Math.min(FADE_MS, 400));
    }
    logStudioAudioDiag('AUDIO_STOP', { reason: 'mute', temporary: true });
    return { ok: true, muted: true };
}

/** Restore volume after mute. */
export async function unmuteStudioAudio() {
    muted = false;
    saveStudioAudioPreference({ muted: false });
    if (masterGain && runtimeState === 'playing') {
        await fadeGainTo(masterGain.gain.value, activeVolume, Math.min(FADE_MS, 400));
        logStudioAudioDiag('AUDIO_RESUME', { reason: 'unmute', volume: activeVolume });
    }
    return { ok: true, muted: false };
}

/**
 * @param {typeof STUDIO_AUDIO_MODES[number]} mode
 * @param {{ userGesture?: boolean; volume?: number; customPlaylist?: string[] }} [options]
 */
export async function setStudioAudioMode(mode, options = {}) {
    if (!STUDIO_AUDIO_MODES.includes(mode)) {
        return { ok: false, reason: 'invalid-mode' };
    }

    saveStudioAudioPreference({
        mode,
        volume: options.volume,
        customPlaylist: options.customPlaylist,
        loop: options.loop,
        armed: options.userGesture === true ? true : undefined
    });

    if (mode === 'Off') {
        await stopStudioAudio('mode-off');
        return { ok: true, mode };
    }

    if (options.userGesture !== true) {
        logStudioAudioDiag('AUDIO_START', {
            blocked: true,
            reason: 'awaiting-user-gesture',
            mode
        });
        return { ok: true, mode, armed: false };
    }

    return startStudioAudio({ userGesture: true, reason: 'mode-change' });
}

/** @param {boolean} open */
export async function notifyStudioAmbientVisibility(open) {
    studioOpen = open;
    if (!open) {
        await stopStudioAudio('studio-closed', { preserveArmed: true });
        return;
    }

    const pref = loadStudioAudioPreference();
    preferredMode = pref.mode;
    activeVolume = pref.volume;
    customPlaylist = pref.customPlaylist;
    loopEnabled = pref.loop;
    muted = pref.muted;
    userArmed = pref.armed;

    if (pref.mode !== 'Off' && pref.armed && !isTheaterVideoAudible()) {
        await startStudioAudio({ reason: 'studio-active' });
    }
}

let studioAudioInitialized = false;

/**
 * @param {{ bindStudioVisibility?: (handler: (open: boolean) => void) => void; bindTheaterVisibility?: (handler: (open: boolean) => void) => void }} [hooks]
 */
export function initStudioAudioEngine(hooks = {}) {
    if (typeof window === 'undefined' || studioAudioInitialized) return;
    studioAudioInitialized = true;

    const pref = loadStudioAudioPreference();
    preferredMode = pref.mode;
    activeVolume = pref.volume;
    customPlaylist = pref.customPlaylist;
    loopEnabled = pref.loop;
    muted = pref.muted;
    userArmed = pref.armed;

    hooks.bindStudioVisibility?.((open) => {
        void notifyStudioAmbientVisibility(open);
    });

    hooks.bindTheaterVisibility?.((open) => {
        if (open) void pauseStudioAudioForTheater();
        else void resumeStudioAudioAfterTheater();
    });

    window.__reelforgeStudioAudio = {
        STUDIO_AUDIO_MODES,
        STUDIO_SOUNDTRACK_SOURCES,
        loadStudioAudioPreference,
        saveStudioAudioPreference,
        getStudioAudioStatus,
        resolveFutureSoundtrack,
        setStudioAudioMode,
        setStudioAudioVolume,
        startStudioAudio,
        stopStudioAudio,
        pauseStudioAudio,
        resumeStudioAudio,
        muteStudioAudio,
        unmuteStudioAudio,
        pauseStudioAudioForTheater,
        resumeStudioAudioAfterTheater,
        notifyStudioAmbientVisibility,
        logStudioAudioDiag
    };
}
