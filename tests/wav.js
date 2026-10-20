// A mono 16-bit PCM WAV of a sine wave.
export function sineWav(frequency, seconds, sampleRate = 44_100) {
	const n = Math.round(seconds * sampleRate);
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVEfmt ', 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) {
		buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.8 * 32767), 44 + i * 2);
	}
	return buf;
}
