import { chromium } from 'playwright';

const LOG_PATH = '/root/.cursor/debug-480721.log';
const APP_URL = 'http://127.0.0.1:5173/';
const TEST_VIDEO = '/videos/MICROS_STIRRED_V3.MOV';

function log(message, data = {}) {
  const line = JSON.stringify({
    sessionId: '480721',
    runId: 'auto-repro',
    hypothesisId: 'AUTO',
    location: 'debug-hero-hydration.mjs',
    message,
    data,
    timestamp: Date.now()
  });
  console.log(line);
  return line;
}

async function appendLog(line) {
  const fs = await import('node:fs/promises');
  await fs.appendFile(LOG_PATH, `${line}\n`);
}

async function main() {
  await import('node:fs/promises').then((fs) => fs.writeFile(LOG_PATH, ''));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    if (msg.text().includes('DEBUG') || msg.text().includes('[hero')) {
      console.log('[browser]', msg.text());
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(({ videoKey, imageKey, testVideo }) => {
    localStorage.setItem(videoKey, testVideo);
    localStorage.removeItem(imageKey);
  }, { videoKey: 'reelforge_hero_video', imageKey: 'reelforge_hero_image', testVideo: TEST_VIDEO });

  await appendLog(log('pre-reload localStorage set', { testVideo: TEST_VIDEO }));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(({ videoKey, imageKey }) => ({
    savedVideo: localStorage.getItem(videoKey),
    savedImage: localStorage.getItem(imageKey),
    heroVideoSrc: document.querySelector('.hero-video-container video source')?.getAttribute('src') || null,
    heroFailed: document.querySelector('.hero-video-container')?.classList.contains('hero-gradient-fallback') || false,
    hasPosterImage: Boolean(document.querySelector('.hero-fallback-image.active'))
  }), { videoKey: 'reelforge_hero_video', imageKey: 'reelforge_hero_image' });

  await appendLog(log('post-reload hero state', state));

  await browser.close();
  console.log('Done', state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
