// PCM WAV encoder (16 or 24 bit). Deterministic: no dither.

/** @param {Float32Array[]} channels @returns {Uint8Array} */
export function encodeWav(channels, sampleRate, bitDepth = 16) {
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('bitDepth must be 16 or 24');
  const nCh = channels.length;
  const len = channels[0].length;
  const bytes = bitDepth / 8;
  const dataSize = len * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, nCh, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nCh * bytes, true); dv.setUint16(32, nCh * bytes, true);
  dv.setUint16(34, bitDepth, true);
  str(36, 'data'); dv.setUint32(40, dataSize, true);
  let o = 44;
  const pos = bitDepth === 16 ? 32767 : 8388607;
  const neg = bitDepth === 16 ? 32768 : 8388608;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      let v = channels[c][i];
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      const q = Math.round(v < 0 ? v * neg : v * pos);
      if (bitDepth === 16) { dv.setInt16(o, q, true); o += 2; }
      else {
        const u = q < 0 ? q + 0x1000000 : q;
        dv.setUint8(o, u & 255); dv.setUint8(o + 1, (u >> 8) & 255); dv.setUint8(o + 2, (u >> 16) & 255);
        o += 3;
      }
    }
  }
  return new Uint8Array(buf);
}

/**
 * Same bytes as encodeWav(), returned as an array of parts (header + PCM chunks) so a 500 MB export never
 * needs one giant ArrayBuffer. Wrap with new Blob(parts).
 */
export function encodeWavParts(channels, sampleRate, bitDepth = 16, chunkFrames = 1 << 18) {
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('bitDepth must be 16 or 24');
  const nCh = channels.length, len = channels[0].length, bytes = bitDepth / 8;
  const dataSize = len * nCh * bytes;
  const head = encodeWav(channels.map((c) => c.subarray(0, 0)), sampleRate, bitDepth).slice(0, 44);
  const hv = new DataView(head.buffer);
  hv.setUint32(4, 36 + dataSize, true); hv.setUint32(40, dataSize, true);
  hv.setUint16(22, nCh, true); hv.setUint32(28, sampleRate * nCh * bytes, true); hv.setUint16(32, nCh * bytes, true);
  const parts = [head];
  for (let a = 0; a < len; a += chunkFrames) {
    const b = Math.min(len, a + chunkFrames);
    parts.push(encodeWav(channels.map((c) => c.subarray(a, b)), sampleRate, bitDepth).subarray(44));
  }
  return parts;
}
