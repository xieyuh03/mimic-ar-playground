import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import type { ParticleEngine } from '../../src/core/particles';

declare global {
  interface Window {
    ParticleRenderTest: { ParticleEngine: typeof ParticleEngine };
  }
}

let harness = '';
test.beforeAll(async () => {
  const output = await build({
    stdin: { contents: "export { ParticleEngine } from './src/core/particles';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'iife', globalName: 'ParticleRenderTest', write: false,
  });
  harness = output.outputFiles[0]!.text;
});

test('isolated rendered spark and trail fade toward transparent rather than popping', async ({ page }) => {
  await page.setContent('<canvas id="probe" width="400" height="300"></canvas>');
  await page.addScriptTag({ content: harness });
  const measurements = await page.evaluate(() => {
    const canvas = document.getElementById('probe');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing probe');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing probe context');
    const engine = new window.ParticleRenderTest.ParticleEngine(() => 0.4);
    engine.burst(150, 130, 1);
    engine.vx[0] = 150;
    engine.vy[0] = -30;
    for (let i = 0; i < 30; i++) engine.step(1 / 120, 400, 300, false, null);
    for (let i = 1; i < engine.life.length; i++) engine.life[i] = 0;
    engine.count = 1;
    const opacityAt = (fraction: number) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      engine.life[0] = engine.initialLife[0]! * fraction;
      engine.draw(context);
      const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let i = 3; i < image.length; i += 4) total += image[i]!;
      return total;
    };
    return { middle: opacityAt(0.4), late: opacityAt(0.05), terminal: opacityAt(0.001) };
  });
  expect(measurements.middle).toBeGreaterThan(100);
  expect(measurements.late).toBeLessThan(measurements.middle * 0.4);
  expect(measurements.terminal).toBeLessThan(measurements.middle * 0.03);
});
