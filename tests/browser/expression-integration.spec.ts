import { expect, test } from '@playwright/test';
import { installVisionFixture, setFixture } from './vision-fixture';

test.beforeEach(async ({ page }) => {
  await installVisionFixture(page);
  await page.goto('/');
  await page.locator('#camera-button').click();
  await expect(page.locator('#calibration-label')).toContainText('已校准', { timeout: 12000 });
});

test('real processing path switches low-cheek laughter out of rain without leftover drops', async ({ page }) => {
  await setFixture(page, 'smile');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'smile');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-rain-particles'))).toBeGreaterThan(50);
  await setFixture(page, 'laugh');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'laugh');
  await expect(page.locator('#stage')).toHaveAttribute('data-rain-particles', '0');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-bursts'))).toBeGreaterThan(0);
  await expect(page.locator('#stage')).toHaveAttribute('data-max-in-flight', '1');
  await expect(page.locator('#mode-badge')).toContainText('LIVE');
});

test('mouth geometry can trigger fireworks when jaw coefficients are low', async ({ page }) => {
  await setFixture(page, 'lowJaw');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'laugh');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-opening-source', 'blendshape');
  await expect(page.locator('#raw-signals')).toContainText('0.12');
});

test('a confirmed brief laugh remains visible long enough for the first rocket to burst', async ({ page }) => {
  await setFixture(page, 'laugh');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'laugh');
  await setFixture(page, 'neutral');
  await expect.poll(async () => Number(await page.locator('#stage').getAttribute('data-bursts')), { timeout: 2000 }).toBeGreaterThan(0);
  await expect(page.locator('#stage')).toHaveAttribute('data-rain-particles', '0');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'neutral');
  await expect(page.locator('#stage')).toHaveAttribute('data-burst-requests', '1');
});

test('pure yawning and smile-then-yawning do not become laughter', async ({ page }) => {
  await setFixture(page, 'yawn');
  await page.waitForTimeout(1800);
  await expect(page.locator('#stage')).toHaveAttribute('data-burst-requests', '0');
  await setFixture(page, 'smile');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'smile');
  await setFixture(page, 'yawn');
  await page.waitForTimeout(1800);
  await expect(page.locator('#stage')).toHaveAttribute('data-burst-requests', '0');
});

test('short talking-like mouth pulses do not repeatedly set off fireworks', async ({ page }) => {
  await setFixture(page, 'speech');
  await page.waitForTimeout(4000);
  await expect(page.locator('#stage')).toHaveAttribute('data-burst-requests', '0');
});

test('personal laugh calibration is sampled, applied, and labeled explicitly', async ({ page }) => {
  await page.locator('#learn-laugh-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-calibrating', 'laugh');
  await setFixture(page, 'lowJaw');
  await expect(page.locator('#calibration-label')).toContainText('已学习', { timeout: 10000 });
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'laugh');
});

test('face loss interrupts calibration and removes weather/collider signals', async ({ page }) => {
  await setFixture(page, 'laugh');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'laugh');
  await setFixture(page, 'multiple');
  await expect(page.locator('#tracking-label')).toContainText('一张人脸');
  await expect(page.locator('#stage')).toHaveAttribute('data-expression', 'neutral');
  await setFixture(page, 'missing');
  await expect(page.locator('#tracking-label')).toContainText('未检测到');
});

test('visibility changes pause and resume the stream without stale calibration samples', async ({ page }) => {
  await page.locator('#learn-laugh-button').click();
  await setFixture(page, 'laugh');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.locator('video').evaluate(element => {
    if (!(element instanceof HTMLVideoElement) || !(element.srcObject instanceof MediaStream)) throw new Error('Missing stream');
    return element.srcObject.getVideoTracks()[0]?.enabled;
  })).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#calibration-label')).toContainText('已学习', { timeout: 10000 });
});
