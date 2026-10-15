import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test(`visible layered rain and fireworks at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      let seed = 12345;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    });
    await page.goto('/');
    const stage = page.locator('#stage');
    await page.locator('#demo-rain').click();
    await page.waitForTimeout(600);
    await expect.poll(async () => Number(await stage.getAttribute('data-rain-particles'))).toBeGreaterThan(80);
    const measure = async () => page.locator('#effects').evaluate(element => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing effects canvas');
      const context = element.getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      const width = element.width;
      const height = element.height;
      const pixels = context.getImageData(0, 0, width, height).data;
      let visible = 0;
      let darkContrast = 0;
      let brightContrast = 0;
      let evaluated = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      const alphaHistogram = new Uint32Array(256);
      let alphaSamples = 0;
      for (let offset = 0; offset < pixels.length; offset += 64) {
        if (pixels[offset]! < 30 && pixels[offset + 1]! < 40 && pixels[offset + 2]! < 60) {
          alphaHistogram[pixels[offset + 3]!] = alphaHistogram[pixels[offset + 3]!]! + 1;
          alphaSamples++;
        }
      }
      let medianAlpha = 0;
      let accumulated = 0;
      for (let alpha = 0; alpha < alphaHistogram.length; alpha++) {
        accumulated += alphaHistogram[alpha]!;
        if (accumulated >= alphaSamples / 2) { medianAlpha = alpha / 255; break; }
      }
      const tintLuminance = 0.2126 * 6 + 0.7152 * 16 + 0.0722 * 33;
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          if (((x / width - 0.5) / 0.23) ** 2 + ((y / height - 0.63) / 0.21) ** 2 < 1) continue;
          evaluated++;
          const index = (y * width + x) * 4;
          const alpha = pixels[index + 3]! / 255;
          const luminance = 0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!;
          // Excludes the flat dark atmospheric tint and the demo avatar.
          if (luminance > 85 && alpha > 0.2) {
            visible++;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            const darkBase = 24 * (1 - medianAlpha) + tintLuminance * medianAlpha;
            const brightBase = 232 * (1 - medianAlpha) + tintLuminance * medianAlpha;
            if (Math.abs(luminance * alpha + 24 * (1 - alpha) - darkBase) > 12) darkContrast++;
            if (Math.abs(luminance * alpha + 232 * (1 - alpha) - brightBase) > 12) brightContrast++;
          }
        }
      }
      return {
        pixelCoverage: visible / evaluated,
        darkContrastCoverage: darkContrast / evaluated,
        brightContrastCoverage: brightContrast / evaluated,
        spanX: (maxX - minX) / width,
        spanY: (maxY - minY) / height,
        canvasPixels: width * height,
      };
    });
    const rain = await measure();
    expect(rain.pixelCoverage).toBeGreaterThan(0.008);
    expect(rain.darkContrastCoverage).toBeGreaterThan(0.008);
    expect(rain.brightContrastCoverage).toBeGreaterThan(0.008);
    expect(rain.spanX).toBeGreaterThan(0.85);
    expect(rain.spanY).toBeGreaterThan(0.75);
    await stage.screenshot({ path: testInfo.outputPath('rain-dark.png') });
    await stage.evaluate(element => {
      const wash = element.querySelector('.stage-wash');
      if (!(wash instanceof HTMLElement)) throw new Error('Missing stage background');
      wash.style.background = '#e6e8eb';
    });
    await stage.screenshot({ path: testInfo.outputPath('rain-bright.png') });
    await page.locator('#demo-fireworks').click();
    await expect(stage).toHaveAttribute('data-rain-particles', '0');
    await expect.poll(async () => Number(await stage.getAttribute('data-bursts'))).toBeGreaterThan(0);
    await page.waitForTimeout(450);
    const fireworks = await measure();
    expect(fireworks.pixelCoverage).toBeGreaterThan(0.01);
    expect(fireworks.darkContrastCoverage).toBeGreaterThan(0.01);
    expect(fireworks.brightContrastCoverage).toBeGreaterThan(0.008);
    expect(fireworks.spanX).toBeGreaterThan(0.5);
    await stage.screenshot({ path: testInfo.outputPath('fireworks-bright.png') });
    await stage.evaluate(element => {
      const wash = element.querySelector('.stage-wash');
      if (!(wash instanceof HTMLElement)) throw new Error('Missing stage background');
      wash.style.background = '';
    });
    await stage.screenshot({ path: testInfo.outputPath('fireworks-dark.png') });
    await testInfo.attach('visibility.json', {
      body: JSON.stringify({ viewport, rain, fireworks, scope: 'Procedural effect visibility, not semantic realism or human recognition accuracy' }, null, 2),
      contentType: 'application/json',
    });
    console.log('VISIBILITY_SAMPLE', JSON.stringify({ viewport, rain, fireworks }));
    expect(fireworks.canvasPixels).toBeLessThanOrEqual(2_510_000);
  });
}

test('reduced motion trims existing effects immediately and stop clears queued shells', async ({ page }) => {
  await page.goto('/');
  await page.locator('#demo-fireworks').click();
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-bursts'))).toBeGreaterThan(0);
  await page.locator('#reduced-motion').check();
  await expect(page.locator('#particle-cap')).toHaveText('180');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-particles'))).toBeLessThanOrEqual(180);
  await page.locator('#stop-demo').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'idle');
  await expect(page.locator('#stage')).toHaveAttribute('data-pending-shells', '0');
  await expect(page.locator('#stage')).toHaveAttribute('data-particles', '0');
});
