import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:4173/';
const seconds = Number(process.env.SAMPLE_SECONDS ?? 30);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) throw new Error('SAMPLE_SECONDS must be within [5, 120]');
const results = [];
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  for (const scenario of [
    { name: 'desktop-fireworks', viewport: { width: 1440, height: 1100 }, button: '#demo-fireworks', camera: false },
    { name: 'mobile-rain', viewport: { width: 390, height: 844 }, button: '#demo-rain', camera: false },
    { name: 'desktop-real-model-no-face', viewport: { width: 1440, height: 1100 }, button: '#camera-button', camera: true },
  ]) {
    const page = await browser.newPage({ viewport: scenario.viewport, deviceScaleFactor: scenario.camera ? 1 : 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator(scenario.button).click();
    if (scenario.camera) await page.waitForFunction(() => document.getElementById('stage')?.dataset.modelReady === 'true', null, { timeout: 45000 });
    await page.waitForTimeout(2000);
    const sample = await page.evaluate(async duration => {
      const intervals = [];
      let previous = performance.now();
      const start = previous;
      let peakParticles = 0;
      let peakRollingCpuP95 = 0;
      let peakInferenceMs = 0;
      let maxInFlight = 0;
      let samples = 0;
      const stage = document.getElementById('stage');
      const canvas = document.getElementById('effects');
      if (!stage || !(canvas instanceof HTMLCanvasElement)) throw new Error('Missing measurement targets');
      while (performance.now() - start < duration * 1000) {
        const now = await new Promise(resolve => requestAnimationFrame(resolve));
        intervals.push(now - previous);
        previous = now;
        peakParticles = Math.max(peakParticles, Number(stage.dataset.particles));
        peakRollingCpuP95 = Math.max(peakRollingCpuP95, Number(stage.dataset.frameCostP95) || 0);
        maxInFlight = Math.max(maxInFlight, Number(stage.dataset.maxInFlight));
        const inference = Number(document.getElementById('inference-value')?.textContent);
        if (Number.isFinite(inference)) peakInferenceMs = Math.max(peakInferenceMs, inference);
        samples++;
      }
      intervals.sort((a, b) => a - b);
      const percentile = ratio => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * ratio))];
      return {
        durationSeconds: (performance.now() - start) / 1000,
        frames: samples,
        meanFps: 1000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length),
        p95FrameIntervalMs: percentile(0.95),
        p99FrameIntervalMs: percentile(0.99),
        peakRollingCpuP95Ms: peakRollingCpuP95,
        peakParticles,
        collisions: Number(stage.dataset.collisions),
        burstCount: Number(stage.dataset.bursts),
        maxInFlight,
        inferenceFrames: Number(stage.dataset.inferenceFrames),
        peakDisplayedInferenceMs: peakInferenceMs,
        canvasPixels: canvas.width * canvas.height,
        finalQuality: stage.dataset.quality,
        userAgent: navigator.userAgent,
        dpr: devicePixelRatio,
      };
    }, seconds);
    results.push({ ...scenario, sample, errors });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
} finally {
  await browser.close();
}
const output = path.resolve('reports/performance-v2.json');
await fs.mkdir(path.dirname(output), { recursive: true });
const checks = results.map(({ name, sample, errors }) => ({
  name,
  pass: errors.length === 0 && sample.peakParticles <= 720 && sample.maxInFlight <= 1 &&
    sample.canvasPixels <= 2_510_000 && sample.peakRollingCpuP95Ms <= 8 && sample.p95FrameIntervalMs <= 33.5,
}));
await fs.writeFile(output, JSON.stringify({
  recordedAt: new Date().toISOString(),
  url: base,
  limits: { particleCap: 720, inFlight: 1, canvasPixels: 2_510_000, cpuP95Ms: 8, frameP95Ms: 33.5 },
  scope: 'Short desktop Chromium benchmarks and mobile viewport emulation; fake capture device for model case. Not real-phone thermals or human recognition accuracy. CPU statistic is the maximum sampled rolling p95, not the whole-run p95.',
  results,
  checks,
}, null, 2));
if (checks.some(check => !check.pass)) {
  console.error('One or more measured budgets failed. Inspect reports/performance-v2.json.');
  process.exitCode = 1;
}
