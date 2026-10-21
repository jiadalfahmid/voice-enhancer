import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('ClearVoice Studio Browser Smoke Test', () => {
  test('loads page, verifies crossOriginIsolated, verifies 0 external network requests, runs GTCRN, and downloads', async ({ page }) => {
    const consoleErrors = [];
    const externalRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://localhost:4173') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/ClearVoice Studio/);

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);
    expect(externalRequests).toEqual([]);

    const fixturePath = path.resolve(__dirname, '../tests/fixtures/speech-5s.wav');
    await page.setInputFiles('input[type="file"]', fixturePath);

    await expect(page.locator('.audio-meta-title')).toBeVisible();

    const gtcrnCard = page.locator('.engine-card', { hasText: 'GTCRN' });
    const enhanceBtn = gtcrnCard.locator('button', { hasText: 'Enhance Original' });
    await expect(enhanceBtn).toBeEnabled();
    await enhanceBtn.click();

    const resultCard = page.locator('.version-card', { hasText: 'GTCRN' });
    await expect(resultCard).toBeVisible({ timeout: 45000 });

    const downloadBtn = resultCard.locator('button', { hasText: /Download/i }).first();
    await expect(downloadBtn).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await downloadBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.wav');

    expect(externalRequests).toEqual([]);
    const relevantErrors = consoleErrors.filter((err) => !err.includes('favicon'));
    expect(relevantErrors).toEqual([]);
  });
});
