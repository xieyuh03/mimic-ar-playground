import { expect, test } from '@playwright/test';

test('desktop entry, manual rain and capped fireworks with physical collisions', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('超能力');
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'idle');
  await page.screenshot({ path: testInfo.outputPath('desktop-idle.png'), fullPage: true });
  await page.locator('#demo-rain').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'demo');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-particles'))).toBeGreaterThan(0);
  await page.locator('#demo-fireworks').click();
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-collisions')), { timeout: 8000 }).toBeGreaterThan(0);
  for (let i = 0; i < 8; i++) await page.locator('#demo-fireworks').click();
  const count = Number(await page.locator('#stage').getAttribute('data-particles'));
  expect(count).toBeLessThanOrEqual(720);
  await expect(page.locator('#mode-badge')).toContainText('非摄像头');
  await page.screenshot({ path: testInfo.outputPath('desktop-fireworks.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile layout does not overflow and supports pointer movement', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#demo-fireworks').click();
  const stage = page.locator('#stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Stage has no layout box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-mode', 'demo');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('camera denial is explicit and does not pretend the demo is live', async ({ page }) => {
  const inferenceRequests: string[] = [];
  page.on('request', request => {
    if (/vision-worker|\/models\/|\/vendor\/wasm\//.test(request.url())) inferenceRequests.push(request.url());
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.locator('#camera-button').click();
  await expect(page.locator('#error-message')).toContainText('权限被拒绝');
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'error');
  await expect(page.locator('#mode-badge')).not.toContainText('LIVE');
  expect(inferenceRequests).toEqual([]);
});

test('actual local model and fake camera initialize; no-face state is honest; stopping releases tracks', async ({ page }) => {
  await page.goto('/');
  await page.locator('#camera-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'camera', { timeout: 35000 });
  await expect(page.locator('#stage')).toHaveAttribute('data-model-ready', 'true');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-inference-frames')), { timeout: 15000 }).toBeGreaterThan(3);
  await expect(page.locator('#stage')).toHaveAttribute('data-max-in-flight', '1');
  await expect(page.locator('#tracking-label')).toContainText('未检测到人脸');
  const track = await page.evaluateHandle(() => {
    const video = document.querySelector('video');
    if (!(video?.srcObject instanceof MediaStream)) throw new Error('No active camera stream');
    const [track] = video.srcObject.getVideoTracks();
    if (!track) throw new Error('No active video track');
    return track;
  });
  await page.locator('#camera-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'idle');
  expect(await track.evaluate(value => value.readyState)).toBe('ended');
  await track.dispose();
  expect(await page.locator('video').evaluate(video => {
    if (!(video instanceof HTMLVideoElement)) throw new Error('Expected a video element');
    return video.srcObject;
  })).toBeNull();
});

test('model download failure shows an error rather than silently falling back', async ({ page }) => {
  await page.route('**/models/face_landmarker.task', route => route.abort('failed'));
  await page.goto('/');
  await page.locator('#camera-button').click();
  await expect(page.locator('#error-message')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'error');
});

test('reduced-motion preference is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#reduced-motion')).toBeChecked();
  await page.locator('#demo-fireworks').click();
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-particles'))).toBeGreaterThan(0);
  expect(Number(await page.locator('#stage').getAttribute('data-particles'))).toBeLessThanOrEqual(50);
});

test('records a real animation-frame sample under continuous fireworks', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('#demo-fireworks').click();
  const sample = await page.evaluate(async () => {
    const intervals: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 240; i++) {
      const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
      if (i > 20) intervals.push(now - previous);
      previous = now;
    }
    intervals.sort((a, b) => a - b);
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Missing stage');
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      sampleFrames: intervals.length,
      meanFps: 1000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length),
      p95FrameIntervalMs: intervals[Math.floor(intervals.length * 0.95)],
      renderCpuP95Ms: Number(stage.dataset.frameCostP95),
      liveParticles: Number(stage.dataset.particles),
      collisions: Number(stage.dataset.collisions),
      quality: stage.dataset.quality,
    };
  });
  await testInfo.attach('performance.json', { body: JSON.stringify(sample, null, 2), contentType: 'application/json' });
  console.log('PERFORMANCE_SAMPLE', JSON.stringify(sample));
  expect(sample.liveParticles).toBeLessThanOrEqual(720);
  expect(sample.collisions).toBeGreaterThan(0);
});
