/**
 * WAV (PCM) encoding for recorded audio. The capture path collects float32 mono
 * samples; on stop we write a standard 16-bit mono WAV so the sample stores and
 * decodes through the exact same pipeline as imported audio (`putAudio` ->
 * content hash -> `decodeAudioData`). Pure + synchronous, so it is unit-testable
 * without the AudioContext.
 */

const WAV_HEADER_BYTES = 44;

/** Encode mono float32 samples as a 16-bit PCM WAV, returning the raw bytes. */
export function encodeWavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  return encodeWavChannels([samples], sampleRate);
}

/** Writes one -1..1 sample as PCM at a bit depth, full scale asymmetric (negative reaches the minimum). */
const PCM_WRITERS: Record<16 | 24, (view: DataView, offset: number, sample: number) => void> = {
  16: (view, offset, sample) => view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true),
  24: (view, offset, sample) => {
    const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
    view.setUint8(offset, value & 0xff);
    view.setUint8(offset + 1, (value >> 8) & 0xff);
    view.setInt8(offset + 2, value >> 16);
  },
};

/**
 * Encode float32 channels (of equal length) as a PCM WAV, interleaved, returning the raw bytes: 16-bit
 * unless asked, or 24-bit, as a mixdown is (DAW-13). The plugin's window turns a file the plugin can't
 * decode faithfully into one (PLUGIN-3.6).
 */
export function encodeWavChannels(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 16): ArrayBuffer {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const write = PCM_WRITERS[bits];
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // file size minus the first 8 bytes
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size (PCM)
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const samples of channels) {
      write(view, offset, Math.max(-1, Math.min(1, samples[i])));
      offset += bytesPerSample;
    }
  }
  return buffer;
}

/** Encode mono float32 samples as a 16-bit PCM WAV blob (for `putAudio`). */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWavBuffer(samples, sampleRate)], { type: "audio/wav" });
}
