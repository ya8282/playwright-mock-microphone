import { readFile } from 'node:fs/promises';

// Runs in the page, before any page script. Must stay self-contained (Playwright serializes it).
function install(opts) {
	if (window.__mockMic || !navigator.mediaDevices) return;
	const md = navigator.mediaDevices;
	const AC = window.AudioContext || window.webkitAudioContext;
	const s = { ctx: null, dest: null, src: null, denied: null };

	s.ensure = () => {
		if (!s.ctx) {
			s.ctx = new AC();
			s.dest = s.ctx.createMediaStreamDestination();
			// A real mic always delivers samples; without a source the track carries no frames and
			// MediaRecorder writes an undecodable file (Chromium, WebKit).
			const floor = s.ctx.createConstantSource();
			floor.offset.value = 0;
			floor.connect(s.dest);
			floor.start();
		}
		if (s.ctx.state === 'suspended') s.ctx.resume().catch(() => {});
		return s.ctx;
	};
	s.stop = () => {
		if (!s.src) return;
		const src = s.src;
		s.src = null;
		try {
			src.stop();
		} catch {}
		src.disconnect();
	};
	s.start = (node) => {
		s.stop();
		node.connect(s.dest);
		node.onended = () => {
			if (s.src === node) s.src = null;
		};
		node.start();
		s.src = node;
	};

	const real = md.getUserMedia ? md.getUserMedia.bind(md) : null;
	md.getUserMedia = async (c = {}) => {
		if (!c.audio) {
			if (!real) throw new DOMException('Requested device not found', 'NotFoundError');
			return real(c);
		}
		if (s.denied) throw new DOMException(s.denied.message, s.denied.name);
		s.ensure();
		// One clone per caller, so one consumer's track.stop() cannot end another's stream.
		const stream = s.dest.stream.clone();
		for (const t of stream.getAudioTracks()) {
			try {
				Object.defineProperty(t, 'label', { get: () => opts.label });
			} catch {}
		}
		if (c.video && real) {
			const v = await real({ video: c.video });
			for (const t of v.getVideoTracks()) stream.addTrack(t);
		}
		return stream;
	};

	const realEnum = md.enumerateDevices ? md.enumerateDevices.bind(md) : async () => [];
	md.enumerateDevices = async () => {
		const others = (await realEnum().catch(() => [])).filter((d) => d.kind !== 'audioinput');
		const fake = { deviceId: 'mock-microphone', groupId: 'mock-microphone', kind: 'audioinput', label: opts.label };
		return [{ ...fake, toJSON: () => fake }, ...others];
	};

	window.__mockMic = s;
}

const mic = (page) => ({
	async tone(frequency = 440) {
		await page.evaluate((f) => {
			const s = window.__mockMic;
			const osc = s.ensure().createOscillator();
			osc.frequency.value = f;
			s.start(osc);
		}, frequency);
	},

	async play(input, { loop = false } = {}) {
		const bytes = typeof input === 'string' ? await readFile(input) : Buffer.from(input);
		return page.evaluate(
			async ({ b64, loop }) => {
				const s = window.__mockMic;
				const ctx = s.ensure();
				const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
				const src = ctx.createBufferSource();
				src.buffer = await ctx.decodeAudioData(raw.buffer);
				src.loop = loop;
				s.start(src);
				return { duration: src.buffer.duration };
			},
			{ b64: bytes.toString('base64'), loop },
		);
	},

	async waitForEnd({ timeout } = {}) {
		await page.waitForFunction(() => !window.__mockMic.src, null, { timeout });
	},

	async stop() {
		await page.evaluate(() => window.__mockMic.stop());
	},

	async deny(name = 'NotAllowedError', message = 'Permission denied') {
		await page.evaluate((d) => (window.__mockMic.denied = d), { name, message });
	},

	async allow() {
		await page.evaluate(() => (window.__mockMic.denied = null));
	},
});

export async function mockMicrophone(target, { label = 'Mock microphone' } = {}) {
	await target.addInitScript(install, { label });
	return 'newPage' in target ? undefined : mic(target);
}

export const microphone = mic;
