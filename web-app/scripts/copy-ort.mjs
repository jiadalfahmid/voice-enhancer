// Copies the onnxruntime-web WASM runtime next to the app so it loads from our own origin
// (required by the CSP / cross-origin isolation). Runs after `npm install`.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/onnxruntime-web/dist');
const dst = path.resolve('public/ort');
if (!fs.existsSync(src)) { console.warn('[copy-ort] onnxruntime-web is not installed yet; skipping.'); process.exit(0); }
fs.mkdirSync(dst, { recursive: true });
const wanted = fs.readdirSync(src).filter((f) => /^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f));
if (wanted.length < 2) {
  console.error('[copy-ort] Expected ort-wasm-simd-threaded.wasm and .mjs in', src);
  console.error('[copy-ort] Found:', fs.readdirSync(src).filter((f) => f.startsWith('ort-wasm')).join(', ') || '(none)');
  process.exit(1);
}
for (const f of wanted) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); console.log('[copy-ort] copied', f); }
