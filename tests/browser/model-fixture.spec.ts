import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('real model obtains mouth geometry, calibrates one face and rejects multiple faces', async ({ page }) => {
  const image = await fs.readFile('assignment/previews/03.jpg');
  await page.addInitScript(({ source }) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot create the local reference video');
      const draw = () => {
        context.fillStyle = '#888';
        context.fillRect(0, 0, 640, 480);
        if (document.documentElement.dataset.imageFixture === 'multiple') {
          context.drawImage(image, 0, 0, 320, 480);
          context.drawImage(image, 320, 0, 320, 480);
        } else if (document.documentElement.dataset.imageFixture !== 'none') {
          context.drawImage(image, 156, 0, 328, 480);
        }
      };
      draw();
      const interval = setInterval(draw, 66);
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No generated test track');
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(interval); stop(); };
      return stream;
    };
  }, { source: `data:image/jpeg;base64,${image.toString('base64')}` });
  await page.goto('/');
  await page.locator('#camera-button').click();
  await expect(page.locator('#calibration-label')).toContainText('已校准', { timeout: 20000 });
  await expect(page.locator('#raw-signals')).not.toContainText('几何不可用');
  await expect(page.locator('#stage')).toHaveAttribute('data-max-in-flight', '1');
  await page.evaluate(() => { document.documentElement.dataset.imageFixture = 'multiple'; });
  await expect(page.locator('#tracking-label')).toContainText('一张人脸');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'neutral');
  await page.evaluate(() => { document.documentElement.dataset.imageFixture = 'none'; });
  await expect(page.locator('#tracking-label')).toContainText('未检测到');
  await page.locator('#camera-button').click();
});
