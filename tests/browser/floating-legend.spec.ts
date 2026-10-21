import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(266);
}

async function legendCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.map-legend').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function putBrazilUnderLegend(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('path[data-country="BRA"]').boundingBox())!;
  const target = await legendCenter(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  // D3 suppresses clicks until the next event-loop turn after a drag.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  expect(await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest('.country-boundary')?.getAttribute('data-country'), target)).toBe('BRA');
  return target;
}

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme} floats a readable legend over the full canvas without control collisions`, async ({ page }) => {
    await ready(page);
    await page.locator('#theme-picker').selectOption(theme);
    for (const size of [
      { width: 1440, height: 900 }, { width: 721, height: 620 },
      { width: 360, height: 800 }, { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(size);
      await page.evaluate(() => scrollTo(0, 0));
      const section = (await page.locator('.map-section').boundingBox())!;
      await expect.poll(() => page.locator('.world-map').getAttribute('viewBox'))
        .toBe(`0 0 ${section.width} ${section.height}`);
      expect(await page.locator('.map-canvas').boundingBox()).toEqual(section);
      const legend = page.locator('.map-legend');
      const box = (await legend.boundingBox())!;
      const toolbar = (await page.locator('.map-toolbar').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width).toBeLessThanOrEqual(section.width - 16);
      expect(box.x + box.width / 2).toBeCloseTo(section.width / 2, 0);
      expect(section.height - box.y - box.height).toBeCloseTo(16, 0);
      expect(box.y - toolbar.y - toolbar.height).toBeGreaterThanOrEqual(8);
      await expect(legend).toBeInViewport();
      await expect(legend.locator(':scope > span')).toHaveText(['Visited', 'Lived / Living', 'Want to Visit', 'Not yet']);
      for (const label of await legend.locator(':scope > span').all()) {
        const bounds = (await label.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(box.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(box.y + box.height);
        expect(await label.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(10);
      }
      await expect(legend.locator('a, button, [tabindex]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.google-sync summary').click();
      for (const selector of ['#export-data', '#copy-data', '#import-data', '.data-license a']) {
        for (const item of await page.locator(selector).all()) {
          await item.scrollIntoViewIfNeeded();
          await expect(item).toBeInViewport();
        }
      }
      await page.locator('.google-sync summary').click();
      await page.locator('#save-status').scrollIntoViewIfNeeded();
      await expect(page.locator('#save-status')).toBeInViewport();
    }
  });

  test(`${theme} legend passes real country clicks, drag and wheel zoom through to the map`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page);
    await page.locator('#theme-picker').selectOption(theme);
    const target = await putBrazilUnderLegend(page);
    await page.mouse.click(target.x, target.y);
    await expect(page.locator('.popover-heading')).toContainText('Brazil');
    await page.keyboard.press('Escape');
    const land = page.locator('.land-layer');
    const beforeDrag = await land.getAttribute('transform');
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 60, target.y - 40, { steps: 8 });
    await page.mouse.up();
    await expect(land).not.toHaveAttribute('transform', beforeDrag!);
    await expect(page.locator('.status-popover')).toBeHidden();
    const beforeZoom = await land.getAttribute('transform');
    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(0, -300);
    await expect(land).not.toHaveAttribute('transform', beforeZoom!);
    await expect(page.locator('.status-popover')).toBeHidden();
  });
}

test.describe('touch through the legend', () => {
  test.use({ hasTouch: true });

  test('touch tap, drag and pinch reach the map instead of scrolling the page', async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await ready(page);
    const target = await putBrazilUnderLegend(page);
    await page.touchscreen.tap(target.x, target.y);
    await expect(page.locator('.popover-heading')).toContainText('Brazil');
    await page.keyboard.press('Escape');
    const land = page.locator('.land-layer');
    const before = await land.getAttribute('transform');
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target] });
    for (let step = 1; step <= 6; step++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: target.x + step * 5, y: target.y - step * 10 }],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(land).not.toHaveAttribute('transform', before!);
    await expect(page.locator('.status-popover')).toBeHidden();
    const scale = () => land.evaluate(element => {
      if (!(element instanceof SVGGraphicsElement)) throw new Error('Missing land layer');
      return element.transform.baseVal.consolidate()!.matrix.a;
    });
    const beforePinch = await scale();
    const fingers = (distance: number) => [
      { x: target.x - distance, y: target.y, id: 1 },
      { x: target.x + distance, y: target.y, id: 2 },
    ];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) });
    for (let distance = 25; distance <= 50; distance += 5) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(distance) });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(scale).toBeGreaterThan(beforePinch);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await client.detach();
  });
});
