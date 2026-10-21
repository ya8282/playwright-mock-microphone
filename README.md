# playwright-mock-microphone

A fake microphone for [Playwright](https://playwright.dev/) tests. Feed `getUserMedia()` a tone or an audio file, or make it deny permission, on **Chromium, Firefox and WebKit**. Recordings made through it with `MediaRecorder` decode back to the audio you fed in, and the test suite checks that on all three engines by measuring the recorded pitch.

A test cannot change what Playwright's own fake microphones play. Chromium's is a launch flag, fixed for the whole browser. Since Playwright 1.62, WebKit offers mock microphones after `grantPermissions(['microphone'])`, but they deliver silence (measured on 1.63.0, WebKit 26.6, macOS). Firefox rejects that permission, but with the `firefoxUserPrefs` `media.navigator.streams.fake` and `media.navigator.permission.disabled` it plays a steady sine tone, also fixed at launch (measured on Firefox 155). So a WebKit-first app (anything aimed at iPad or Safari) cannot otherwise test what it records.

```js
import { test, expect } from '@playwright/test';
import { mockMicrophone } from 'playwright-mock-microphone';

test('records a voice memo', async ({ page }) => {
	const mic = await mockMicrophone(page); // before page.goto()
	await page.goto('/memo');
	await mic.tone(440); // or: await mic.play('fixtures/hello.wav')
	await page.getByRole('button', { name: 'Record' }).click();
	// ... assert on what your app saved
});
```

## Install

```sh
npm install -D playwright-mock-microphone
```

No runtime dependencies. Needs `@playwright/test` 1.63 or later and Node 20.19 or later. Node 20.19 is the first release that can `require()` this ES module, which a CommonJS test project needs.

## API

| Call | Does |
| --- | --- |
| `mockMicrophone(page, { label })` | Installs on the page and returns its `Microphone`. Call it before `page.goto()`, or `page.reload()` after. |
| `mockMicrophone(context, { label })` | Installs on every page of the context. Get a page's controller with `microphone(page)`. |
| `mic.tone(hz = 440)` | Continuous sine wave until `stop()` or the next `tone()`/`play()`. |
| `mic.play(pathOrBytes, { loop })` | Decodes with the page's own `decodeAudioData` (WAV and MP3 work everywhere) and plays it. Resolves with `{ duration }` when playback starts. |
| `mic.waitForEnd({ timeout })` | Resolves when the file has finished playing. |
| `mic.stop()` | Back to silence. |
| `mic.deny(name = 'NotAllowedError')` / `mic.allow()` | Later `getUserMedia({ audio })` calls reject with that `DOMException`, until `allow()`. Use it to test your permission-denied path. |

`label` (default `"Mock microphone"`) appears on the track and as the only `audioinput` in `enumerateDevices()`. Video requests pass through to the real `getUserMedia`.

## Behaviour worth knowing

- **WebKit needs a real user gesture.** Start recording from `page.click()` on your app's own button, as a user would. Starting `MediaRecorder` or resuming audio from `page.evaluate()` throws `NotAllowedError` on WebKit.
- **Silence is a quiet noise floor, not digital zero.** The track always delivers samples at about -80 dBFS, as a real microphone does. With no samples, or with digital zero on a context created before the user gesture, Chromium and WebKit record a file that `decodeAudioData` rejects with `EncodingError`.
- **`getUserMedia` resolves once audio is flowing.** Firefox on Linux can take over 300 ms to start an `AudioContext`, and Linux Chromium can report one as running and then render nothing for about 0.8 s. So the mock waits (up to 2 s) until the context's clock has advanced 50 ms before returning the stream, as a real device would.
- **Each caller gets its own stream.** One consumer calling `track.stop()` does not end the stream another consumer holds.
- **No permission prompt** appears for audio, because the mock never reaches the browser's permission layer.
- **Playwright's Linux WebKit has no `MediaRecorder`** (measured on 1.63.0, WebKit 26.6). The mock still feeds `getUserMedia` there, but nothing can record it, so run recording tests for WebKit on macOS. This repo's CI does exactly that.
- **Firefox on headless Linux needs an audio server** (`pulseaudio --start`), or its `AudioContext` never runs. See `.github/workflows/ci.yml`.
- **Lossy codecs smear the edges.** WebKit records AAC, Chromium and Firefox Opus. Assert on the steady part of a recording, not on its first and last few milliseconds.
- `navigator.mediaDevices` exists only in a secure context: HTTPS or `localhost`.

## How it works

An init script replaces `navigator.mediaDevices.getUserMedia` and `enumerateDevices` before the page's own scripts run. Audio requests get a clone of a Web Audio `MediaStreamAudioDestinationNode`'s stream, which the controller feeds from an oscillator or a decoded buffer. Because it is a genuine `MediaStream`, `MediaRecorder`, `AnalyserNode` and WebRTC all consume it unchanged.

The idea comes from [tsuemura/playwright-audio-mocking](https://github.com/tsuemura/playwright-audio-mocking). This package is a smaller rewrite. It adds tones, permission denial, and the silent floor that makes recordings of silence decodable, and its tests record and measure audio on every engine.

## License

MIT
