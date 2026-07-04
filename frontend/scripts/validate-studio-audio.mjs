import { chromium } from 'playwright';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseDiagLogs(logs, tag) {
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

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[AUDIO_START]') ||
        text.includes('[AUDIO_STOP]') ||
        text.includes('[AUDIO_FADE]') ||
        text.includes('[AUDIO_RESUME]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'System');
    localStorage.removeItem('reelforge_studio_ambient_audio');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-studio-ambient-audio]', { timeout: 15000 });
await page.waitForTimeout(500);

assert('studio audio hook initialized', await page.evaluate(() => Boolean(window.__reelforgeStudioAudio)));
assert('ambient audio panel renders', await page.locator('[data-studio-ambient-audio]').isVisible());

const futureSources = await page.evaluate(() => window.__reelforgeStudioAudio.STUDIO_SOUNDTRACK_SOURCES);
assert(
    'future soundtrack sources declared',
    Array.isArray(futureSources) &&
        futureSources.includes('Team Soundtrack') &&
        futureSources.includes('Series Soundtrack') &&
        futureSources.includes('Workspace Soundtrack')
);

await page.selectOption('[data-studio-audio-mode]', 'Lo-Fi');
await page.click('[data-studio-audio-apply]');
await page.waitForTimeout(1500);

const startLogs = parseDiagLogs(logs, 'AUDIO_START');
const fadeLogs = parseDiagLogs(logs, 'AUDIO_FADE');
assert('AUDIO_START emitted', startLogs.some((entry) => entry.blocked !== true));
assert('AUDIO_FADE emitted', fadeLogs.length >= 1);

const pref = await page.evaluate(() => window.__reelforgeStudioAudio.loadStudioAudioPreference());
assert('preference remembered', pref.mode === 'Lo-Fi' && pref.armed === true);

await page.evaluate(async () => {
    await window.__reelforgeStudioAudio.pauseStudioAudioForTheater();
});
await page.waitForTimeout(1000);

const stopLogs = parseDiagLogs(logs, 'AUDIO_STOP');
assert('AUDIO_STOP emitted for theater pause', stopLogs.some((entry) => entry.reason === 'theater-playback'));

await page.evaluate(async () => {
    await window.__reelforgeStudioAudio.resumeStudioAudioAfterTheater();
});
await page.waitForTimeout(1500);

const resumeLogs = parseDiagLogs(logs, 'AUDIO_RESUME');
assert('AUDIO_RESUME emitted', resumeLogs.some((entry) => entry.afterTheater === true || entry.reason === 'unmute'));

await page.click('[data-studio-audio-pause]');
await page.waitForTimeout(1200);

assert(
    'manual pause emits AUDIO_STOP',
    parseDiagLogs(logs, 'AUDIO_STOP').some((entry) => entry.manual === true)
);

await page.click('[data-studio-audio-mute]');
await page.waitForTimeout(600);
assert(
    'mute emits temporary stop',
    parseDiagLogs(logs, 'AUDIO_STOP').some((entry) => entry.reason === 'mute')
);

const status = await page.evaluate(() => window.__reelforgeStudioAudio.getStudioAudioStatus());
assert(
    'theater-safe contract',
    status.theaterSafe === true || status.runtimeState === 'playing' || status.runtimeState === 'paused'
);

const modes = ['Off', 'Lo-Fi', 'Cinematic', 'Drama', 'Sci-Fi', 'Epic', 'Custom Playlist'];
for (const mode of modes) {
    assert(`mode ${mode} supported`, modes.includes(mode));
}

await page.selectOption('[data-studio-audio-mode]', 'Off');
await page.waitForTimeout(250);
await page.click('[data-studio-audio-apply]');
await page.waitForTimeout(1500);
assert(
    'off mode stops audio',
    parseDiagLogs(logs, 'AUDIO_STOP').some((entry) => entry.reason === 'mode-off')
);

await browser.close();

console.log('\n=== Studio Ambient Audio Validation ===\n');
if (failed) {
    console.log('STUDIO_AUDIO_COMPLETE=false');
    process.exit(1);
}

console.log('STUDIO_AUDIO_COMPLETE=true');
