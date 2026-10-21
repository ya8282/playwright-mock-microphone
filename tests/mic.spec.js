import { test, expect } from '@playwright/test';
import { mockMicrophone, microphone } from '../index.js';
import { sineWav } from './wav.js';

// Records MS of microphone input with MediaRecorder from a real click (WebKit requires the gesture),
// then decodes it and reports duration, peak level and an estimated pitch from zero crossings.
const PAGE = `<button id=rec>rec</button><script>
const MS = 1200;
document.getElementById('rec').onclick = async () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = stream.getAudioTracks()[0].label;
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    window.__recording = true;
    // Fixed window by default; with __hold set, record until the test calls __finish().
    const finished = new Promise((r) => (window.__finish = r));
    if (!window.__hold) setTimeout(window.__finish, MS);
    await finished;
    rec.stop();
    await stopped;
    const buf = await ctx.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
    const d = buf.getChannelData(0);
    let peak = 0, crossings = 0, first = -1, last = -1, loudFrom = -1, loudTo = -1;
    for (let i = 0; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      if (Math.abs(d[i]) > 0.25) { if (loudFrom < 0) loudFrom = i; loudTo = i; }
    }
    // Pitch only over the loud span: lossy codecs (AAC on WebKit) leave low-level noise around a burst.
    for (let i = Math.max(loudFrom, 1); i <= loudTo; i++) {
      if (d[i - 1] < 0 && d[i] >= 0) {
        crossings++;
        if (first < 0) first = i;
        last = i;
      }
    }
    const hz = crossings > 1 ? ((crossings - 1) * buf.sampleRate) / (last - first) : 0;
    window.__result = { label, mime: rec.mimeType, duration: buf.duration, peak, hz };
  } catch (e) {
    window.__result = { error: e.name };
  }
};</script>`;

const URL = 'http://localhost/mic';

async function open(page) {
	await page.route(URL, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
	await page.goto(URL);
	test.skip(
		await page.evaluate(() => typeof MediaRecorder !== 'function'),
		'This browser build has no MediaRecorder (Playwright WebKit on Linux); run WebKit on macOS',
	);
}

const result = async (page) => {
	await page.waitForFunction(() => window.__result, null, { timeout: 15_000 });
	return page.evaluate(() => window.__result);
};

test('records a tone set before the app asks for the microphone', async ({ page }) => {
	const mic = await mockMicrophone(page);
	await open(page);
	await mic.tone(440);
	await page.click('#rec');
	const r = await result(page);
	expect(r.error).toBeUndefined();
	expect(r.duration).toBeGreaterThan(0.8);
	expect(r.peak).toBeGreaterThan(0.5);
	expect(r.hz).toBeGreaterThan(400);
	expect(r.hz).toBeLessThan(480);
});

test('records an audio file played after recording starts', async ({ page }) => {
	const mic = await mockMicrophone(page);
	await open(page);
	await page.evaluate(() => (window.__hold = true));
	await page.click('#rec');
	await page.waitForFunction(() => window.__recording);
	const { duration } = await mic.play(sineWav(220, 0.5));
	expect(duration).toBeCloseTo(0.5, 1);
	await mic.waitForEnd();
	await page.evaluate(() => window.__finish());
	const r = await result(page);
	expect(r.peak).toBeGreaterThan(0.3);
	expect(r.hz).toBeGreaterThan(200);
	expect(r.hz).toBeLessThan(240);
});

test('getUserMedia waits for the context to render, not just to report running', async ({ page }) => {
	await mockMicrophone(page);
	await open(page);
	// Linux Chromium can report 'running' and then render nothing for ~0.8 s. Simulate that.
	const ms = await page.evaluate(async () => {
		const ctx = window.__mockMic.ensure();
		await ctx.suspend();
		Object.defineProperty(ctx, 'state', { get: () => 'running', configurable: true });
		setTimeout(() => {
			delete ctx.state;
			ctx.resume().catch(() => {});
		}, 500);
		const t0 = performance.now();
		await navigator.mediaDevices.getUserMedia({ audio: true });
		return performance.now() - t0;
	});
	expect(ms).toBeGreaterThan(450);
});

test('records silence when nothing plays', async ({ page }) => {
	await mockMicrophone(page);
	await open(page);
	await page.click('#rec');
	const r = await result(page);
	expect(r.error).toBeUndefined();
	expect(r.peak).toBeLessThan(0.01);
});

test('stop() silences a tone', async ({ page }) => {
	const mic = await mockMicrophone(page);
	await open(page);
	await mic.tone(440);
	await mic.stop();
	await page.click('#rec');
	expect((await result(page)).peak).toBeLessThan(0.01);
});

test('deny() rejects getUserMedia until allow()', async ({ page }) => {
	const mic = await mockMicrophone(page);
	await open(page);
	await mic.deny();
	await page.click('#rec');
	expect((await result(page)).error).toBe('NotAllowedError');

	await page.evaluate(() => delete window.__result);
	await mic.allow();
	await page.click('#rec');
	expect((await result(page)).error).toBeUndefined();
});

test('reports the label on the track and in enumerateDevices', async ({ page }) => {
	await mockMicrophone(page, { label: 'Studio mic' });
	await open(page);
	await page.click('#rec');
	expect((await result(page)).label).toBe('Studio mic');
	const inputs = await page.evaluate(async () =>
		(await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').map((d) => d.label),
	);
	expect(inputs).toEqual(['Studio mic']);
});

test("one consumer stopping its track does not end another's", async ({ page }) => {
	await mockMicrophone(page);
	await open(page);
	const state = await page.evaluate(async () => {
		const a = await navigator.mediaDevices.getUserMedia({ audio: true });
		const b = await navigator.mediaDevices.getUserMedia({ audio: true });
		a.getAudioTracks()[0].stop();
		return b.getAudioTracks()[0].readyState;
	});
	expect(state).toBe('live');
});

test('installs on a whole browser context', async ({ context }) => {
	await mockMicrophone(context);
	const page = await context.newPage();
	await open(page);
	await microphone(page).tone(440);
	await page.click('#rec');
	expect((await result(page)).peak).toBeGreaterThan(0.5);
});
