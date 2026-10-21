import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    themeIdentityCheck: () => boolean;
  }
}

const skins = [
  { id: 'classic', ocean: 'rgb(24, 147, 217)', land: 'rgb(198, 206, 214)', border: 'rgb(255, 255, 255)', surface: 'rgb(248, 249, 251)', scheme: 'light' },
  { id: 'dark', ocean: 'rgb(32, 32, 32)', land: 'rgb(65, 60, 57)', border: 'rgb(12, 12, 12)', surface: 'rgb(32, 38, 62)', scheme: 'dark' },
  { id: 'medieval', ocean: 'rgb(155, 165, 139)', land: 'rgb(220, 198, 153)', border: 'rgb(107, 81, 44)', surface: 'rgb(228, 204, 164)', scheme: 'light' },
];
const pageErrors = new WeakMap<Page, string[]>();

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(266);
}

async function selectCountry(page: Page, id: string): Promise<void> {
  await page.getByRole('searchbox').fill(id);
  await page.locator(`.country-row[data-country="${id}"]`).click();
}

async function checkContrast(page: Page): Promise<void> {
  const ratios = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const color = (token: string): number[] => {
      const node = document.createElement('span');
      node.style.color = root.getPropertyValue(token);
      document.body.append(node);
      const rgba = getComputedStyle(node).color.match(/[\d.]+/g)!.map(Number);
      node.remove();
      return rgba;
    };
    const luminance = (rgb: number[]): number => rgb.slice(0, 3).map(value => value / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const ratios = [
      ['--ink', '--surface'], ['--muted', '--surface'], ['--subtle', '--surface'], ['--subtle', '--input'],
      ['--on-accent', '--button'], ['--on-accent', '--button-hover'],
      ['--map-ink', '--map-panel'],
      ['--warning-ink', '--warning'], ['--toast-ink', '--toast'], ['--accent', '--surface'], ['--accent', '--input'],
    ].map(([foreground, background]) => {
      const rgb = color(background!);
      if (rgb[3] !== undefined) {
        const ocean = color('--ocean');
        for (let index = 0; index < 3; index++) rgb[index] = rgb[index]! * rgb[3] + ocean[index]! * (1 - rgb[3]);
      }
      const a = luminance(color(foreground!));
      const b = luminance(rgb);
      return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    const sidebar = getComputedStyle(document.querySelector('.sidebar')!);
    const credits = getComputedStyle(document.querySelector('.data-license')!);
    const a = luminance(credits.color.match(/[\d.]+/g)!.map(Number));
    const b = luminance(sidebar.backgroundColor.match(/[\d.]+/g)!.map(Number));
    ratios.push({ foreground: 'sidebar credits', background: 'sidebar', ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) });
    return ratios;
  });
  for (const { foreground, background, ratio } of ratios) {
    expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(foreground === '--accent' ? 3 : 4.5);
  }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const probe = { pending: new Set<number>(), requested: 0 };
    window.animationProbe = probe;
    window.requestAnimationFrame = callback => {
      const handle = request(time => { probe.pending.delete(handle); callback(time); });
      probe.pending.add(handle);
      probe.requested++;
      return handle;
    };
    window.cancelAnimationFrame = handle => { probe.pending.delete(handle); cancel(handle); };
  });
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

for (const skin of skins) {
  test(`${skin.id} restores before loading and themes the map, UI, portals and statuses`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.addInitScript(id => localStorage.setItem('passport:theme:v1', id), skin.id);
    await page.route('**/data/world-10m.json', async route => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', skin.id);
      await expect(page.locator('.loading-screen')).toBeVisible();
      await expect(page.locator('html')).toHaveCSS('color-scheme', skin.scheme);
      await route.continue();
    });
    await ready(page);
    const picker = page.getByRole('combobox', { name: 'Theme' });
    await expect(picker).toHaveValue(skin.id);
    await expect(page.locator('.map-section')).toHaveCSS('background-color', skin.ocean);
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', skin.surface);
    await expect(page.locator('path[data-country="BRA"]')).toHaveCSS('fill', skin.land);
    await expect(page.locator('path[data-country="BRA"]')).toHaveCSS('stroke', skin.border);
    await checkContrast(page);
    const oceanToken = await page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--ocean').trim());
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', oceanToken);
    if (skin.id === 'medieval') {
      await expect(page.locator('#places-heading')).toHaveCSS('font-family', /Georgia/);
      await expect(page.locator('.map-section')).not.toHaveCSS('background-image', 'none');
      await expect(page.locator('#scenery-description')).toContainText('dragons');
      await expect(page.locator('symbol[id$="-ship"] [data-model="galleon"]')).toHaveCount(1);
      await expect(page.locator('symbol[id$="-plane"] [data-model="dragon"]')).toHaveCount(1);
      const grain = await page.locator('.map-canvas').evaluate(node => {
        const style = getComputedStyle(node, '::after');
        return { image: style.backgroundImage, pointerEvents: style.pointerEvents };
      });
      expect(grain.image).toContain('url(');
      expect(grain.pointerEvents).toBe('none');
    }
    for (const status of ['visited', 'lived', 'want_to_visit', 'unvisited']) {
      await selectCountry(page, 'VAT');
      await expect(page.getByRole('dialog', { name: 'Change travel status' })).toHaveCSS('background-color', skin.surface);
      await page.locator(`.status-choice[data-status="${status}"]`).click();
      const color = await page.locator(`.map-legend .status-dot.${status}`).evaluate(node => getComputedStyle(node).backgroundColor);
      if (skin.id !== 'medieval') {
        const referenceColors: Record<string, string> = skin.id === 'classic' ? {
          visited: 'rgb(65, 161, 43)',
          lived: 'rgb(242, 191, 5)',
          want_to_visit: 'rgb(146, 84, 212)',
          unvisited: skin.land,
        } : {
          visited: 'rgb(34, 76, 187)',
          lived: 'rgb(251, 231, 105)',
          want_to_visit: 'rgb(236, 101, 104)',
          unvisited: skin.land,
        };
        expect(color).toBe(referenceColors[status]);
      }
      await expect(page.locator('path[data-country="VAT"]')).toHaveCSS('fill', color);
      await expect(page.locator('.microstate-marker[data-country="VAT"] .marker-dot')).toHaveCSS('fill', color);
      await expect(page.locator('.country-row[data-country="VAT"] .status-dot')).toHaveCSS('background-color', color);
    }
    await page.locator('.microstate-marker[data-country="NRU"] .marker-target').hover({ force: true });
    await expect(page.getByRole('tooltip')).toContainText('Nauru');
    const tooltip = await page.getByRole('tooltip').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(tooltip).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByRole('button', { name: 'Export data', exact: false }).click();
    await expect(page.locator('#toast')).toBeVisible();
    expect(await page.locator('#toast').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(skin.surface);
    await page.reload();
    await expect(picker).toHaveValue(skin.id);
  });

  test(`${skin.id} is usable at narrow sizes with a keyboard-accessible picker`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    const picker = page.getByRole('combobox', { name: 'Theme' });
    await picker.selectOption(skin.id);
    await picker.focus();
    await expect(picker).toBeFocused();
    await expect(picker).toHaveCSS('outline-style', 'solid');
    await expect(picker).toHaveCSS('outline-width', '3px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await selectCountry(page, 'custom:CNM');
    await expect(page.getByRole('dialog', { name: 'Change travel status' })).toBeVisible();
    const box = await page.getByRole('dialog', { name: 'Change travel status' }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(12);
    expect(box!.x + box!.width).toBeLessThanOrEqual(378);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Export data', exact: false }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Export data', exact: false })).toBeInViewport();
  });
}

test('Classic remains default regardless of system preference and does not write a theme on load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('classic');
  expect(await page.evaluate(() => localStorage.getItem('passport:theme:v1'))).toBeNull();
});

test('switching skins preserves map, search, selection, data and paused scenery without refetching geography', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/data/world-10m.json')) requests++; });
  await ready(page);
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  await selectCountry(page, 'VAT');
  await page.locator('.status-choice[data-status="visited"]').click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  const state = await page.evaluate(() => {
    const svg = document.querySelector('.world-map')!;
    const nodes = [...document.querySelectorAll('.country-boundary, .scenery-object')];
    window.themeIdentityCheck = () => svg === document.querySelector('.world-map')
      && nodes.every((node, index) => node === document.querySelectorAll('.country-boundary, .scenery-object')[index]);
    return {
      paths: [...document.querySelectorAll('.country-boundary')].map(node => node.getAttribute('d')),
      transform: document.querySelector('.land-layer')!.getAttribute('transform'),
      poses: [...document.querySelectorAll('.scenery-object')].map(node => node.getAttribute('transform')),
      data: localStorage.getItem('passport:locations:v1'),
      classicShip: document.querySelector('symbol[id$="-ship"]')!.innerHTML,
    };
  });
  const picker = page.getByRole('combobox', { name: 'Theme' });
  for (const id of ['dark', 'medieval', 'classic', 'medieval']) await picker.selectOption(id);
  expect(await page.evaluate(() => window.themeIdentityCheck())).toBe(true);
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', state.transform!);
  await expect(page.locator('path[data-country="VAT"]')).toHaveClass(/is-selected/);
  await expect(page.getByRole('searchbox')).toHaveValue('VAT');
  await expect(page.locator('#visited-count')).toHaveText('1');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(state.data);
  expect(await page.locator('.country-boundary').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))).toEqual(state.paths);
  expect(await page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(state.poses);
  expect(await page.locator('symbol[id$="-ship"]').innerHTML()).not.toBe(state.classicShip);
  expect(await page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  expect(requests).toBe(1);
  await expect(page.locator('.scenery-object')).toHaveCount(9);
});

test('running and hidden scenery retain their animation choice and theme artwork', async ({ page }) => {
  await ready(page);
  const picker = page.getByRole('combobox', { name: 'Theme' });
  await picker.selectOption('medieval');
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(1);
  await expect(page.locator('#scenery-description')).toContainText('dragons');
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  const poses = await page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  await picker.selectOption('dark');
  await picker.selectOption('medieval');
  await expect(page.locator('.map-scenery')).toBeHidden();
  expect(await page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  expect(await page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(poses);
  await page.getByRole('button', { name: 'Show map scenery', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.animationProbe.pending.size)).toBe(0);
  await picker.selectOption('dark');
  await expect(page.getByRole('button', { name: 'Map animations disabled for reduced motion' })).toBeDisabled();
  await expect(page.locator('.scenery-object')).toHaveCount(9);
});

test('theme changes dismiss cached tooltips and popovers without stealing picker focus', async ({ page }) => {
  await ready(page);
  await selectCountry(page, 'custom:CNM');
  const picker = page.getByRole('combobox', { name: 'Theme' });
  await picker.focus();
  await picker.selectOption('medieval');
  await expect(page.getByRole('dialog', { name: 'Change travel status' })).toBeHidden();
  await expect(picker).toBeFocused();
  await page.locator('path[data-country="BRA"]').dispatchEvent('pointermove', { clientX: 200, clientY: 200 });
  await expect(page.getByRole('tooltip')).toBeVisible();
  await picker.selectOption('dark');
  await expect(page.getByRole('tooltip')).toBeHidden();
});

test('unknown preference is reported and preserved until an explicit valid choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('passport:theme:v1', 'removed-theme'));
  await ready(page);
  await expect(page.locator('#theme-message')).toContainText('not available');
  expect(await page.evaluate(() => localStorage.getItem('passport:theme:v1'))).toBe('removed-theme');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('#theme-message')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('passport:theme:v1'))).toBe('dark');
});

test('failed theme writes preserve travel persistence and keep the requested session appearance', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:theme:v1') throw new Error('Theme quota exceeded');
      set.call(this, key, value);
    };
  });
  await ready(page);
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-message')).toContainText('could not be remembered');
  await expect(page.locator('#save-status')).toContainText('Changes stay');
  await selectCountry(page, 'VAT');
  await page.locator('.status-choice[data-status="visited"]').click();
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  await expect(page.locator('#theme-message')).toBeVisible();
});

test('failed theme reads do not trigger travel-data recovery', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'passport:theme:v1') throw new Error('Theme read denied');
      return get.call(this, key);
    };
  });
  await ready(page);
  await expect(page.locator('#theme-message')).toContainText('Theme read denied');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('medieval');
  await expect(page.locator('#theme-message')).toBeHidden();
});

test('saved Medieval skin covers travel-data recovery and fatal errors', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('passport:theme:v1', 'medieval');
    localStorage.setItem('passport:locations:v1', 'broken');
  });
  await page.goto('./');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('background-color', 'rgb(228, 204, 164)');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.error-screen')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'medieval');
  await expect(page.locator('.error-screen h1')).toHaveCSS('font-family', /Georgia/);
  expect(await page.evaluate(() => localStorage.getItem('passport:theme:v1'))).toBe('medieval');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe('broken');
});

test('theme choice survives legacy travel migration and confirmed replacement imports', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('passport:theme:v1', 'dark');
    localStorage.setItem('visited:locations:v1', JSON.stringify([{ id: 'VAT', name: 'Vatican City', continent: 'Europe', status: 'visited' }]));
  });
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
  await expect(page.locator('#visited-count')).toHaveText('1');
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBeNull();
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('medieval');
  await page.locator('#import-file').setInputFiles({
    name: 'travel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([{ id: 'BRA', name: 'Brazil', continent: 'South America', status: 'lived' }])),
  });
  await expect(page.locator('.confirmation-dialog')).toHaveCSS('background-color', 'rgb(228, 204, 164)');
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(page.locator('#visited-count')).toHaveText('0');
  await expect(page.locator('#lived-count')).toHaveText('1');
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('medieval');
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('passport:locations:v1')!) as object[]);
  expect(data).toHaveLength(266);
  expect(JSON.stringify(data)).not.toContain('theme');
  expect(await page.evaluate(() => localStorage.getItem('passport:theme:v1'))).toBe('medieval');
});

test('unavailable browser storage reports theme and travel failures separately', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } });
  });
  await ready(page);
  await expect(page.locator('#theme-message')).toContainText('Could not read');
  await expect(page.locator('#warning')).toContainText('Browser storage is unavailable');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-message')).toContainText('could not be remembered');
  await expect(page.locator('#warning')).toContainText('Browser storage is unavailable');
});

test('Medieval grain and dragons are click-through and disappear when changing skins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const picker = page.getByRole('combobox', { name: 'Theme' });
  await picker.selectOption('medieval');
  const svg = (await page.locator('.world-map').boundingBox())!;
  const brazil = (await page.locator('path[data-country="BRA"]').boundingBox())!;
  const point = { x: brazil.x + brazil.width / 2, y: brazil.y + brazil.height / 2 };
  await page.locator('.scenery-plane').first().evaluate((dragon, position) => {
    dragon.setAttribute('transform', `translate(${position.x},${position.y})`);
  }, { x: point.x - svg.x, y: point.y - svg.y });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.popover-heading')).toContainText('Brazil');
  await page.keyboard.press('Escape');
  await page.locator('.microstate-marker[data-country="NRU"] .marker-target').click({ force: true });
  await expect(page.locator('.popover-heading')).toContainText('Nauru');
  await page.keyboard.press('Escape');
  const art = page.locator('.scenery-plane use').first();
  await expect(art).toHaveCSS('transform', 'matrix(1.35, 0, 0, 1.35, 0, 0)');
  for (const id of ['classic', 'dark']) {
    await picker.selectOption(id);
    await expect(art).toHaveCSS('transform', 'none');
    const layers = await page.locator('.map-canvas').evaluate(node => ({
      texture: getComputedStyle(node, '::after').content,
      frame: getComputedStyle(node.parentElement!, '::before').content,
    }));
    expect(layers).toEqual({ texture: 'none', frame: 'none' });
  }
});
