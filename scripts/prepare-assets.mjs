import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'node_modules/@mediapipe/tasks-vision');
const publicDir = path.join(root, 'public');
const modelDir = path.join(publicDir, 'models');
const wasmDir = path.join(publicDir, 'vendor/wasm');
await fs.mkdir(modelDir, { recursive: true });
await fs.mkdir(wasmDir, { recursive: true });

for (const name of await fs.readdir(path.join(vendor, 'wasm'))) {
  if (/\.(js|wasm)$/.test(name)) {
    await fs.copyFile(path.join(vendor, 'wasm', name), path.join(wasmDir, name));
  }
}

const modelPath = path.join(modelDir, 'face_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelSha256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
let model;
try {
  model = await fs.readFile(modelPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Downloading the versioned MediaPipe face model...');
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  model = Buffer.from(await response.arrayBuffer());
  if (model.length < 1_000_000 || model.length > 15_000_000) {
    throw new Error(`Unexpected model size: ${model.length}`);
  }
  await fs.writeFile(modelPath, model);
}
const digest = createHash('sha256').update(model).digest('hex');
if (digest !== modelSha256) throw new Error(`Face model checksum mismatch: ${digest}`);
console.log(`Face model: ${model.length} bytes, verified SHA-256 ${digest}`);

// MediaPipe's WASM loader uses importScripts: this must be a classic worker.
await build({
  entryPoints: [path.join(root, 'src/vision.worker.ts')],
  outfile: path.join(publicDir, 'vision-worker.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
});
console.log('Prepared same-origin model, WASM and classic inference worker.');
