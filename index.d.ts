import type { BrowserContext, Page } from '@playwright/test';

export interface MockMicrophoneOptions {
	/** Label on the track and in enumerateDevices(). Default "Mock microphone". */
	label?: string;
}

export interface Microphone {
	/** Feed a continuous sine wave until stop() or another tone()/play(). */
	tone(frequency?: number): Promise<void>;
	/** Decode a file path or bytes with the page's decodeAudioData and feed it. Resolves when playback starts. */
	play(input: string | Uint8Array, options?: { loop?: boolean }): Promise<{ duration: number }>;
	/** Resolve when the current sound has finished. Never resolves for a loop or a tone. */
	waitForEnd(options?: { timeout?: number }): Promise<void>;
	/** Back to silence. The track keeps delivering silent samples, like a real mic. */
	stop(): Promise<void>;
	/** Make later getUserMedia({ audio }) calls reject with this DOMException name. */
	deny(name?: string, message?: string): Promise<void>;
	/** Undo deny(). */
	allow(): Promise<void>;
}

/** Install on a page (returns its controller) before page.goto(). */
export function mockMicrophone(page: Page, options?: MockMicrophoneOptions): Promise<Microphone>;
/** Install on every page of a context; get each page's controller with microphone(page). */
export function mockMicrophone(context: BrowserContext, options?: MockMicrophoneOptions): Promise<void>;

/** Controller for a page whose context was installed with mockMicrophone(context). */
export function microphone(page: Page): Microphone;
