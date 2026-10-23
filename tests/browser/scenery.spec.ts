import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    animationProbe: { pending: Set<number>; requested: number };
  }
}

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const probe = { pending: new Set<number>(), requested: 0 };
    window.animationProbe = probe;
    window.requestAnimationFrame = (callback) => {
      const handle = request((timestamp) => {
        probe.pending.delete(handle);
        callback(timestamp);
      });
      probe.requested++;
      probe.pending.add(handle);
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      probe.pending.delete(handle);
      cancel(handle);
    };
  });
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('.scenery-object')).toHaveCount(9);
}

async function poses(page: Page): Promise<string[]> {
  return page.locator('.scenery-object').evaluateAll((objects) =>
    objects.map((object) => `${object.getAttribute('transform')} / ${object.getAttribute('opacity')}`),
  );
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function setDocumentHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('subtle ships, planes and clouds animate with a single frame loop below the markers', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.scenery-ship')).toHaveCount(3);
  await expect(page.locator('.scenery-plane')).toHaveCount(2);
  await expect(page.locator('.scenery-cloud')).toHaveCount(4);
  await expect(page.locator('.map-scenery')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('.map-scenery').evaluate((layer) => layer.nextElementSibling?.classList.contains('marker-layer'))).toBe(true);
  await expect(page.locator('.map-scenery [tabindex], .map-scenery button, .map-scenery a')).toHaveCount(0);
  const ship = page.locator('[data-scenery-id="atlantic-ship"]');
  const initial = await ship.getAttribute('transform');
  await expect.poll(() => ship.getAttribute('transform')).not.toBe(initial);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(1);
});

test('pause freezes all motion and resume does not duplicate objects or animation loops', async ({ page }) => {
  await ready(page);
  const originalData = await page.evaluate(() => localStorage.getItem('passport:locations:v1'));
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
    await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
    const frozen = await poses(page);
    await twoFrames(page);
    expect(await poses(page)).toEqual(frozen);
    await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
    await page.getByRole('button', { name: 'Resume map animations', exact: true }).click();
    await expect.poll(() => poses(page)).not.toEqual(frozen);
    await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(1);
    await expect(page.locator('.scenery-object')).toHaveCount(9);
  }
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(originalData);
});

test('hide removes every decoration and keeps show reachable while preserving a paused scene', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  const frozen = await poses(page);
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await expect(page.locator('.map-scenery')).toBeHidden();
  await expect(page.locator('.scenery-object:visible')).toHaveCount(0);
  await expect(page.locator('#pause-scenery')).toBeDisabled();
  await expect(page.locator('#scenery-description')).toContainText('hidden');
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  const show = page.getByRole('button', { name: 'Show map scenery', exact: true });
  await show.focus();
  await expect(show).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.map-scenery')).toBeVisible();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  expect(await poses(page)).toEqual(frozen);
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.map-scenery')).toBeHidden();
  await show.click();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  expect(await poses(page)).not.toEqual(frozen);
  await twoFrames(page);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
});

test('show resumes a previously running scene and hiding stops frame work completely', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  const frozen = await poses(page);
  const requests = await page.evaluate(() => window.animationProbe.requested);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  // Intentional observation window: proves no frame is requested while hidden.
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.animationProbe.requested)).toBe(requests);
  await page.getByRole('button', { name: 'Show map scenery', exact: true }).click();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'running');
  await expect.poll(() => poses(page)).not.toEqual(frozen);
});

test('scenery is static for reduced motion on load and after live preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByRole('button', { name: 'Map animations disabled for reduced motion' })).toBeDisabled();
  const frozen = await poses(page);
  await twoFrames(page);
  expect(await poses(page)).toEqual(frozen);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Show map scenery', exact: true }).click();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'reduced');
  expect(await poses(page)).not.toEqual(frozen);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'running');
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#pause-scenery')).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  await expect(page.getByRole('button', { name: 'Resume map animations', exact: true })).toBeEnabled();
});

test('hidden document suspension does not override a user pause', async ({ page }) => {
  await ready(page);
  await setDocumentHidden(page, true);
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'background');
  const frozen = await poses(page);
  await twoFrames(page);
  expect(await poses(page)).toEqual(frozen);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  await setDocumentHidden(page, false);
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'running');
  await expect.poll(() => poses(page)).not.toEqual(frozen);
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  await setDocumentHidden(page, true);
  await setDocumentHidden(page, false);
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
});

test('50-percent larger icons keep constant screen sizes and geographic positioning during navigation', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  const artwork = await Promise.all(([
    ['atlantic-ship', 25], ['atlantic-plane', 23], ['southern-cloud', 46],
  ] as const).map(async ([id, originalSize]) => {
    const art = page.locator(`[data-scenery-id="${id}"] use`);
    await expect(art).toHaveAttribute('width', String(originalSize * 1.5));
    await expect(art).toHaveAttribute('height', String(originalSize * 1.5));
    const bounds = (await art.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    return { art, bounds };
  }));
  async function expectConstantSizes(): Promise<void> {
    for (const { art, bounds } of artwork) {
      const current = (await art.boundingBox())!;
      expect(current.width).toBeCloseTo(bounds.width, 1);
      expect(current.height).toBeCloseTo(bounds.height, 1);
    }
  }
  const plane = page.locator('[data-scenery-id="atlantic-plane"]');
  const center = () => plane.evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) throw new Error('Expected an SVG decoration.');
    const matrix = element.transform.baseVal.consolidate()!.matrix;
    return { x: matrix.e, y: matrix.f };
  });
  const before = await center();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const after = await center();
  const zoom = await page.locator('.land-layer').evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) throw new Error('Expected a map layer.');
    const matrix = element.transform.baseVal.consolidate()!.matrix;
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  expect(after.x).toBeCloseTo(before.x * zoom.scale + zoom.x, 2);
  expect(after.y).toBeCloseTo(before.y * zoom.scale + zoom.y, 2);
  await expectConstantSizes();
  const canvas = await page.locator('#map-canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width / 2 + 60, canvas!.y + canvas!.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  expect(await center()).not.toEqual(after);
  const panned = await center();
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect.poll(() => center()).not.toEqual(panned);
  await expectConstantSizes();
});

test('clouds are click-through over polygons and tiny markers', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  const svg = await page.locator('.world-map').boundingBox();
  for (const [selector, name] of [['path[data-country="BRA"]', 'Brazil'], ['.microstate-marker[data-country="NRU"] .marker-target', 'Nauru']]) {
    const target = await page.locator(selector!).boundingBox();
    const x = target!.x + target!.width / 2;
    const y = target!.y + target!.height / 2;
    await page.locator('.scenery-cloud').first().evaluate((cloud, point) => {
      cloud.setAttribute('transform', `translate(${point.x},${point.y})`);
    }, { x: x - svg!.x, y: y - svg!.y });
    expect(await page.locator('.scenery-cloud use').first().evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
    await page.mouse.click(x, y);
    await expect(page.locator('.popover-heading')).toContainText(name!);
    await page.keyboard.press('Escape');
  }
});

test('scenery never redraws geographic paths and cleans up its loop and listeners', async ({ page }) => {
  await ready(page);
  const before = await page.locator('.land-layer').innerHTML();
  await twoFrames(page);
  expect(await page.locator('.land-layer').innerHTML()).toBe(before);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.map-scenery')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect(page.locator('.map-scenery')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
});

test('mobile density and both controls remain usable without horizontal overflow', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator('.scenery-object:visible')).toHaveCount(6);
  await expect(page.locator('.scenery-ship:visible')).toHaveCount(2);
  await expect(page.locator('.scenery-plane:visible')).toHaveCount(1);
  await expect(page.locator('.scenery-cloud:visible')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#pause-scenery')).toBeInViewport();
  await expect(page.locator('#toggle-scenery')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('scenery-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await expect(page.locator('.scenery-object:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show map scenery', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.scenery-object:visible')).toHaveCount(9);
  await page.screenshot({ path: testInfo.outputPath('scenery-desktop.png'), fullPage: true });
});
