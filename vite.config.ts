import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const workerRevision = createHash('sha256')
  .update(readFileSync(new URL('./public/vision-worker.js', import.meta.url)))
  .digest('hex').slice(0, 16);

export default defineConfig({
  base: './',
  define: { __VISION_WORKER_REVISION__: JSON.stringify(workerRevision) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
