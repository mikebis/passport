import { expect, test, type Page } from '@playwright/test';
import additional from '../../data/additional-territories.json' with { type: 'json' };
import legacyData from '../../data/user-data.json' with { type: 'json' };

const totalPlaces = 249 + additional.length;

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toContainText('Your places');
  await expect(page.locator('.world-map path.country-boundary')).toHaveCount(totalPlaces);
}

async function findCountry(page: Page, id: string): Promise<void> {
  await page.getByRole('searchbox').fill(id);
  await page.locator(`.country-row[data-country="${id}"]`).click();
  await expect(page.getByRole('dialog', { name: 'Change travel status' })).toBeVisible();
}

test('loads complete geometry, legend and seven collapsed continent groups', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.continent')).toHaveCount(7);
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  await expect(page.locator('.antarctica .country-row[data-country="ATA"]')).toHaveCount(1);
  await expect(page.locator('.antarctica .country-favourite[data-country="ATA"]')).toHaveCount(1);
  await expect(page.locator('.map-legend')).toContainText('Lived / Living');
  for (const id of ['VAT', 'MCO', 'SMR', 'LIE', 'AND', 'NRU', 'TUV', 'UMI', 'BVT', 'TKL']) {
    await expect(page.locator(`path[data-country="${id}"]`)).toHaveAttribute('d', /M/);
  }
});

test('Classic reference palette preserves white boundaries, status colors and marker halos', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.mouse.move(0, 0);
  const brazil = page.locator('path[data-country="BRA"]');
  await expect(brazil).toHaveCSS('fill', 'rgb(198, 206, 214)');
  await expect(brazil).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(brazil).toHaveCSS('stroke-width', '1px');
  await expect(brazil).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  await expect(page.locator('.map-legend .unvisited')).toHaveCSS('background-color', 'rgb(198, 206, 214)');
  const marker = page.locator('.microstate-marker[data-country="NRU"] .marker-dot');
  await expect(marker).toHaveCSS('fill', 'rgb(198, 206, 214)');
  await expect(marker).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(marker).toHaveCSS('stroke-width', '1px');
  await brazil.hover();
  await expect(brazil).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(brazil).toHaveCSS('stroke-width', '1.5px');
  await findCountry(page, 'EST');
  await expect(page.locator('path[data-country="EST"]')).toHaveClass(/is-selected/);
  await expect(page.locator('path[data-country="EST"]')).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(page.locator('path[data-country="EST"]')).toHaveCSS('stroke-width', '1.5px');
  await page.keyboard.press('Escape');
  for (const [status, color] of [
    ['visited', 'rgb(65, 161, 43)'], ['lived', 'rgb(242, 191, 5)'],
    ['want_to_visit', 'rgb(146, 84, 212)'], ['unvisited', 'rgb(198, 206, 214)'],
  ]) {
    await findCountry(page, 'VAT');
    await page.locator(`.status-choice[data-status="${status}"]`).click();
    await expect(page.locator('path[data-country="VAT"]')).toHaveCSS('fill', color!);
    await expect(page.locator('path[data-country="VAT"]')).toHaveCSS('stroke', 'rgb(255, 255, 255)');
    await expect(page.locator('.microstate-marker[data-country="VAT"] .marker-dot')).toHaveCSS('fill', color!);
  }
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(brazil).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(brazil).toHaveCSS('stroke-width', '1px');
});

test('all four statuses synchronize sidebar, map, markers and reload', async ({ page }) => {
  await ready(page);
  for (const status of ['visited', 'lived', 'want_to_visit', 'unvisited']) {
    await findCountry(page, 'VAT');
    await page.locator(`.status-choice[data-status="${status}"]`).click();
    await expect(page.locator('.country-row[data-country="VAT"]')).toHaveAttribute('data-status', status);
    await expect(page.locator('path[data-country="VAT"]')).toHaveAttribute('data-status', status);
    await expect(page.locator('.microstate-marker[data-country="VAT"]')).toHaveAttribute('data-status', status);
    await expect(page.locator('.status-popover')).toBeHidden();
  }
  await findCountry(page, 'VAT');
  await page.getByRole('button', { name: 'Want to Visit', exact: true }).click();
  await expect(page.locator('#wish-count')).toHaveText('1');
  await page.reload();
  await expect(page.locator('path[data-country="VAT"]')).toHaveAttribute('data-status', 'want_to_visit');
  await expect(page.locator('#wish-count')).toHaveText('1');
});

test('polygon and microstate marker open the same status popover', async ({ page }) => {
  await ready(page);
  const brazil = page.locator('path[data-country="BRA"]');
  const box = await brazil.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator('.status-popover')).toBeVisible();
  await expect(page.locator('.popover-heading')).toContainText('Brazil');
  await page.keyboard.press('Escape');
  await page.locator('.microstate-marker[data-country="NRU"] .marker-target').click({ force: true });
  await expect(page.locator('.popover-heading')).toContainText('Nauru');
});

test('map tooltip includes name, code and current status', async ({ page }) => {
  await ready(page);
  await page.locator('.microstate-marker[data-country="NRU"] .marker-target').hover({ force: true });
  await expect(page.getByRole('tooltip')).toContainText('Nauru');
  await expect(page.getByRole('tooltip')).toContainText('NRU');
  await expect(page.getByRole('tooltip')).toContainText('Unvisited');
});

test('tooltip reuses content and dimensions within one territory and refreshes after changes', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const tooltip = document.querySelector<HTMLElement>('.map-tooltip')!;
    const country = document.querySelector('path[data-country="BRA"]')!;
    country.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 200 }));
    const title = tooltip.firstElementChild;
    const measure = tooltip.getBoundingClientRect.bind(tooltip);
    let measurements = 0;
    tooltip.getBoundingClientRect = () => { measurements++; return measure(); };
    for (let index = 0; index < 40; index++) {
      country.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 + index, clientY: 200 }));
    }
    return { sameTitle: tooltip.firstElementChild === title, measurements, left: tooltip.style.left };
  });
  expect(result).toEqual({ sameTitle: true, measurements: 0, left: '355px' });
  await page.locator('.microstate-marker[data-country="NRU"] .marker-target').hover({ force: true });
  await expect(page.getByRole('tooltip')).toContainText('Nauru');
  await findCountry(page, 'BRA');
  await page.locator('.status-choice[data-status="visited"]').click();
  await page.locator('path[data-country="BRA"]').dispatchEvent('pointermove', { clientX: 400, clientY: 300 });
  await expect(page.getByRole('tooltip')).toContainText('Visited');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.locator('path[data-country="custom:CNM"]').dispatchEvent('pointermove', { clientX: 389, clientY: 843 });
  await expect(page.getByRole('tooltip')).toContainText('Cyprus UN Buffer Zone');
  const box = await page.getByRole('tooltip').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(382);
  expect(box!.y + box!.height).toBeLessThanOrEqual(836);
});

test('country geometry stays fixed during map navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const paths = await page.locator('.country-boundary').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.land-layer')).not.toHaveAttribute('transform', 'translate(0,0) scale(1)');
  expect(await page.locator('.country-boundary').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))).toEqual(paths);
});

test('clustered microstates select the dot nearest the cursor', async ({ page }) => {
  await ready(page);
  for (const [id, name] of [['SMR', 'San Marino'], ['VAT', 'Vatican City'], ['LIE', 'Liechtenstein'], ['MCO', 'Monaco']]) {
    const dot = await page.locator(`.microstate-marker[data-country="${id}"] .marker-dot`).boundingBox();
    await page.mouse.click(dot!.x + dot!.width / 2, dot!.y + dot!.height / 2);
    await expect(page.locator('.popover-heading')).toContainText(name!);
    await page.keyboard.press('Escape');
  }
});

test('zoom and pan do not change marker size or activate status selection', async ({ page }) => {
  await ready(page);
  const marker = page.locator('.microstate-marker[data-country="NRU"] .marker-dot');
  const initialMarker = await marker.boundingBox();
  const before = await page.locator('.land-layer').getAttribute('transform');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.land-layer')).not.toHaveAttribute('transform', before!);
  await expect(page.locator('.marker-dot').first()).toHaveAttribute('r', '4.5');
  const zoomedMarker = await marker.boundingBox();
  expect(zoomedMarker!.width).toBeCloseTo(initialMarker!.width, 1);
  expect(zoomedMarker!.height).toBeCloseTo(initialMarker!.height, 1);
  const canvas = await page.locator('#map-canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width / 2 + 90, canvas!.y + canvas!.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.status-popover')).toBeHidden();
  await page.getByRole('button', { name: 'Reset map view' }).click();
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', 'translate(0,0) scale(1)');
});

test('wheel and double-click zoom work and Antarctica has a visible marker', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const antarctica = page.locator('.microstate-marker[data-country="ATA"] .marker-dot');
  await expect(antarctica).toBeInViewport();
  const canvas = await page.locator('#map-canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(page.locator('.land-layer')).not.toHaveAttribute('transform', 'translate(0,0) scale(1)');
  await expect(page.locator('.status-popover')).toBeHidden();
  await page.getByRole('button', { name: 'Reset map view' }).click();
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', 'translate(0,0) scale(1)');
  await page.mouse.dblclick(canvas!.x + canvas!.width - 30, canvas!.y + canvas!.height / 2);
  await expect(page.locator('.land-layer')).not.toHaveAttribute('transform', 'translate(0,0) scale(1)');
});

test('keyboard status controls trap focus, close on Escape and restore focus', async ({ page }) => {
  await ready(page);
  await page.getByRole('searchbox').fill('Estonia');
  const row = page.locator('.country-row[data-country="EST"]');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-status="unvisited"].status-choice')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.favourite-choice')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close status choices' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Visited', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('data-status', 'visited');
});

test('search reveals collapsed continents and restores accordion state', async ({ page }) => {
  await ready(page);
  const africa = page.locator('.continent').filter({ has: page.locator('summary', { hasText: 'Africa' }) });
  await expect(africa).not.toHaveAttribute('open');
  await page.getByRole('searchbox').fill('Kenya');
  await expect(page.locator('.country-row[data-country="KEN"]')).toBeVisible();
  await page.getByRole('searchbox').fill('nothing-matches');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.getByRole('searchbox').clear();
  await expect(africa).not.toHaveAttribute('open');
  await expect(page.locator('.continent')).toHaveCount(7);
});

test('download export round-trips all countries and nested subdivisions', async ({ page }) => {
  await ready(page);
  const nested = [{
    id: 'USA', name: 'United States', continent: 'North America', status: 'lived',
    subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'visited' }],
  }];
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooserPromise).setFiles({ name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(nested)) });
  await expect(page.getByRole('dialog', { name: 'Replace your travel data?' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(page.locator('#lived-count')).toHaveText('1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('passport-data.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data).toHaveLength(totalPlaces);
  expect(data.find((entry: { id: string }) => entry.id === 'USA').subdivisions).toEqual(nested[0]!.subdivisions);
  await page.reload();
  await expect(page.locator('path[data-country="USA"]')).toHaveAttribute('data-status', 'lived');
});

test('cancelled or invalid import leaves current data untouched', async ({ page }) => {
  await ready(page);
  await findCountry(page, 'EST');
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  await page.locator('#import-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('[]') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('[{"id":"EST","name":"Estonia","continent":"Europe","status":"bad"}]') });
  await expect(page.locator('#toast')).toContainText('Import rejected');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('clipboard export succeeds and denial offers download instead', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.locator('#toast')).toContainText('JSON copied');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard)).toHaveLength(totalPlaces);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.locator('#toast')).toContainText('Could not copy JSON');
  await expect(page.locator('#toast')).toContainText('Export data');
});

test('corrupt browser state is preserved until confirmed recovery', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('passport:locations:v1', '{broken'));
  await page.goto('./');
  await expect(page.getByRole('dialog', { name: 'Your browser data needs attention' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe('{broken');
  await page.getByRole('button', { name: 'Use committed data' }).click();
  await expect(page.locator('.world-map path.country-boundary')).toHaveCount(totalPlaces);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('passport:locations:v1')))!)).toHaveLength(totalPlaces);
});

test('cancelling recovery leaves the original saved value untouched', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('passport:locations:v1', '{broken'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Recovery was cancelled');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe('{broken');
});

test('runtime assets and attribution are served locally under the configured base', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(`${origin}/`)) remote.push(request.url());
  });
  await ready(page);
  const provenance = await page.request.get(new URL('data/provenance.json', page.url()).toString());
  expect(provenance.ok()).toBe(true);
  expect((await provenance.json()).boundaries.license).toBe('Public domain');
  const sources = page.getByRole('link', { name: 'Data sources', exact: true });
  await expect(sources).toHaveCount(1);
  await expect(page.locator('.sidebar-footer .data-license')).toContainText('Boundaries: Natural Earth');
  await expect(page.locator('.sidebar-footer').getByRole('link', { name: 'Data sources' })).toHaveAttribute('href', new URL('data/provenance.json', page.url()).pathname);
  await expect(sources).toHaveAttribute('target', '_blank');
  await expect(sources).toHaveAttribute('rel', 'noopener');
  const repository = page.locator('.sidebar-footer .data-license').getByRole('link', { name: 'View on GitHub', exact: true });
  await expect(repository).toHaveCount(1);
  await expect(repository).toHaveAttribute('href', 'https://github.com/mikebis/passport');
  await expect(repository).toHaveAttribute('target', '_blank');
  await expect(repository).toHaveAttribute('rel', 'noopener');
  await expect(repository.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  const favicon = await page.request.get(new URL('favicon.svg', page.url()).toString());
  expect(await favicon.text()).toContain('<svg');
  expect(remote).toEqual([]);
});

test('storage write failure preserves the edit and shows an unsaved warning', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); };
  });
  await ready(page);
  await findCountry(page, 'EST');
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  await expect(page.locator('#warning')).toContainText('not saved');
  await expect(page.locator('#warning')).toContainText('Quota exceeded');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('failed data load presents a visible error and retry', async ({ page }) => {
  await page.route('**/data/world-10m.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('header-free layout reclaims top space and preserves the map, sidebar and controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await expect(page.locator('.app-header, .map-intro')).toHaveCount(0);
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'passport home' })).toHaveCount(0);
  await expect(page.getByText('Oh, the places', { exact: false })).toHaveCount(0);
  const map = page.getByRole('region', { name: 'Travel map', exact: true });
  const sidebar = page.getByRole('complementary', { name: 'Your places.' });
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.locator('.world-map').getAttribute('viewBox')).toMatch(new RegExp(`^0 0 ${width === 1280 ? 925 : 360} `));
    const mapBounds = (await map.boundingBox())!;
    const canvasBounds = (await page.locator('#map-canvas').boundingBox())!;
    const sidebarBounds = (await sidebar.boundingBox())!;
    expect(mapBounds.x).toBe(0);
    expect(mapBounds.y).toBe(0);
    expect(canvasBounds).toEqual(mapBounds);
    expect(mapBounds.height).toBe(width === 1280 ? 800 : 560);
    if (width === 1280) {
      expect(sidebarBounds.y).toBe(0);
      expect(sidebarBounds.x).toBe(mapBounds.width);
      expect(sidebarBounds.height).toBe(800);
    } else {
      expect(sidebarBounds.x).toBe(0);
      expect(sidebarBounds.y).toBe(mapBounds.height);
      expect(sidebarBounds.width).toBe(width);
    }
    const controls = page.getByRole('group', { name: 'Map controls' }).getByRole('button');
    await expect(controls).toHaveCount(5);
    for (const control of await controls.all()) await expect(control).toBeInViewport();
    await expect(page.locator('.map-legend')).toBeInViewport();
    await expect(page.locator('.map-hint, .map-attribution')).toHaveCount(0);
    await page.getByRole('link', { name: 'Data sources' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'Data sources' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
  }
});

test('mobile layout has reachable controls and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await findCountry(page, 'VAT');
  const bounds = await page.locator('.status-popover').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export data' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Export data' })).toBeInViewport();
});

test('captures representative desktop and mobile rendering', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('all additional territories are searchable, independently selectable and included in totals', async ({ page }) => {
  await ready(page);
  await expect(page.locator('path.country-boundary[data-kind="iso"]')).toHaveCount(249);
  await expect(page.locator('path.country-boundary[data-kind="custom"]')).toHaveCount(additional.length);
  for (const territory of additional) {
    await findCountry(page, territory.id);
    const row = page.locator(`.country-row[data-country="${territory.id}"]`);
    await expect(row).toContainText(territory.name);
    await expect(row.locator('.country-code')).toHaveText(territory.id);
    await expect(row.locator('.country-flag')).toHaveText('\u25ce');
    await expect(row.locator('.territory-kind')).toContainText('non-ISO');
    await expect(page.locator('.popover-subtitle')).toContainText(`${territory.id} \u00b7 Additional territory`);
    await page.getByRole('button', { name: 'Visited', exact: true }).click();
    await expect(page.locator(`path[data-country="${territory.id}"]`)).toHaveAttribute('data-status', 'visited');
  }
  await expect(page.locator('#visited-count')).toHaveText(String(additional.length));
  await expect(page.locator('#colored-count')).toHaveText(`${additional.length} / ${totalPlaces}`);
  const progress = await page.locator('#progress-fill').evaluate((element) => Number.parseFloat(element.style.width));
  expect(progress).toBeCloseTo(additional.length / totalPlaces * 100, 2);
  for (const id of ['SRB', 'CYP', 'SOM', 'KOR', 'PRK', 'USA']) {
    await expect(page.locator(`path[data-country="${id}"]`)).toHaveAttribute('data-status', 'unvisited');
  }
  await page.reload();
  await expect(page.locator('#visited-count')).toHaveText(String(additional.length));
  for (const territory of additional) {
    await expect(page.locator(`path[data-country="${territory.id}"]`)).toHaveAttribute('data-status', 'visited');
  }
});

test('additional territories support all four statuses and leave related ISO entries unchanged', async ({ page }) => {
  await ready(page);
  for (const id of ['custom:KOS', 'custom:CYN', 'custom:SOL']) {
    for (const status of ['visited', 'lived', 'want_to_visit', 'unvisited']) {
      await findCountry(page, id);
      await page.locator(`.status-choice[data-status="${status}"]`).click();
      await expect(page.locator(`.country-row[data-country="${id}"]`)).toHaveAttribute('data-status', status);
      await expect(page.locator(`path[data-country="${id}"]`)).toHaveAttribute('data-status', status);
    }
  }
  await expect(page.locator('#colored-count')).toHaveText(`0 / ${totalPlaces}`);
  for (const id of ['SRB', 'CYP', 'SOM']) {
    await expect(page.locator(`path[data-country="${id}"]`)).toHaveAttribute('data-status', 'unvisited');
  }
});

async function clickPolygon(page: Page, id: string): Promise<void> {
  const point = await page.locator(`path.country-boundary[data-country="${id}"]`).evaluate((element) => {
    if (!(element instanceof SVGPathElement)) throw new Error('Expected an SVG polygon path.');
    const path = element;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('Polygon has no screen transform.');
    const length = path.getTotalLength();
    for (let index = 0; index < 128; index++) {
      const point = path.getPointAtLength(length * index / 128).matrixTransform(matrix);
      if (document.elementFromPoint(point.x, point.y) === path) return { x: point.x, y: point.y };
    }
    throw new Error('No directly clickable point found on the polygon.');
  });
  await page.mouse.click(point.x, point.y);
}

test('additional polygons and tiny markers open status controls with neutral labels', async ({ page }) => {
  await ready(page);
  for (const [id, name] of [['custom:KOS', 'Kosovo'], ['custom:SOL', 'Somaliland']]) {
    await clickPolygon(page, id!);
    await expect(page.locator('.popover-heading')).toContainText(name!);
    await expect(page.locator('.popover-subtitle')).toContainText('non-ISO');
    await page.keyboard.press('Escape');
  }
  const reef = page.locator('.microstate-marker[data-country="custom:SCR"] .marker-dot');
  const bounds = await reef.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('Scarborough Reef');
  await expect(page.getByRole('tooltip')).toContainText('custom:SCR');
  await expect(page.getByRole('tooltip')).toContainText('non-ISO');
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.getByRole('button', { name: 'Want to Visit', exact: true }).click();
  await expect(page.locator('.microstate-marker[data-country="custom:SCR"]')).toHaveAttribute('data-status', 'want_to_visit');
});

test('a DMZ source overlay stays above its ISO parent and is directly clickable when zoomed', async ({ page }) => {
  await ready(page);
  const dmz = page.locator('path.country-boundary[data-country="custom:KNX"]');
  const bounds = await dmz.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -3000);
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', /scale\(24\)/);
  // Wait until D3 ends the wheel gesture (after its idle debounce).
  await expect(page.locator('svg.world-map')).not.toHaveAttribute('data-navigating', 'true');
  await clickPolygon(page, 'custom:KNX');
  await expect(page.locator('.popover-heading')).toContainText('Korean DMZ (south)');
  await page.getByRole('button', { name: 'Lived / Living', exact: true }).click();
  await expect(dmz).toHaveAttribute('data-status', 'lived');
  await expect(page.locator('path[data-country="KOR"]')).toHaveAttribute('data-status', 'unvisited');
  await expect(page.locator('path[data-country="custom:KNZ"]')).toHaveAttribute('data-status', 'unvisited');
});

test('old browser saves load without recovery or rewriting and preserve nested ISO data', async ({ page }) => {
  const old = legacyData.map((entry) => entry.id === 'USA' ? {
    ...entry, status: 'lived', updatedAt: '2025-03-01T12:30:00Z',
    subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'visited' }],
  } : entry);
  const raw = JSON.stringify(old);
  await page.addInitScript((saved) => localStorage.setItem('passport:locations:v1', saved), raw);
  await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(raw);
  await expect(page.locator('#lived-count')).toHaveText('1');
  for (const territory of additional) {
    await expect(page.locator(`path[data-country="${territory.id}"]`)).toHaveAttribute('data-status', 'unvisited');
  }
  await findCountry(page, 'custom:KOS');
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('passport:locations:v1')))!);
  expect(saved).toHaveLength(totalPlaces);
  expect(saved.filter((entry: { id: string }) => !entry.id.startsWith('custom:'))).toEqual(old);
});

test('passport title and loading branding are shown without bringing back the header', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/world-10m.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  try {
    await expect(page).toHaveTitle(/^passport /);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('passport.');
  } finally {
    release();
  }
  await expect(page.locator('.country-boundary')).toHaveCount(totalPlaces);
  await expect(page.getByRole('banner')).toHaveCount(0);
});

test('visited saves migrate unchanged to passport, survive reload and retain nested and custom data', async ({ page }) => {
  const old = [...legacyData.map((entry) => entry.id === 'USA' ? {
    ...entry, status: 'lived', updatedAt: '2025-03-01T12:30:00Z',
    subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'visited' }],
  } : entry), { id: 'custom:KOS', name: 'Kosovo', continent: 'Europe', status: 'visited' }];
  const raw = JSON.stringify(old, null, 2) + '\n';
  await page.goto('./');
  await page.evaluate((saved) => {
    localStorage.clear();
    localStorage.setItem('visited:locations:v1', saved);
  }, raw);
  await page.reload();
  await expect(page.locator('path[data-country="USA"]')).toHaveAttribute('data-status', 'lived');
  await expect(page.locator('path[data-country="custom:KOS"]')).toHaveAttribute('data-status', 'visited');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(raw);
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBeNull();
  await page.reload();
  await expect(page.locator('#lived-count')).toHaveText('1');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(raw);
  await findCountry(page, 'EST');
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  const updated = JSON.parse((await page.evaluate(() => localStorage.getItem('passport:locations:v1')))!);
  expect(updated).toHaveLength(totalPlaces);
  expect(updated.find((entry: { id: string }) => entry.id === 'USA')).toEqual(old.find((entry) => entry.id === 'USA'));
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBeNull();
});

for (const current of ['[]', '{broken']) {
  test(`passport data takes precedence over a legacy save (${current === '[]' ? 'valid' : 'corrupt'})`, async ({ page }) => {
    await page.addInitScript((raw) => {
      localStorage.setItem('passport:locations:v1', raw);
      localStorage.setItem('visited:locations:v1', '[{"id":"USA","name":"United States","continent":"North America","status":"lived"}]');
    }, current);
    await page.goto('./');
    if (current === '[]') {
      await expect(page.locator('path[data-country="USA"]')).toHaveAttribute('data-status', 'unvisited');
    } else {
      await expect(page.getByRole('dialog', { name: 'Your browser data needs attention' })).toBeVisible();
    }
    expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(current);
    expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).not.toBeNull();
  });
}

for (const action of ['Cancel', 'Use committed data']) {
  test(`corrupt legacy recovery preserves the raw backup and handles ${action}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('visited:locations:v1', '{broken'));
    await page.goto('./');
    await expect(page.getByRole('dialog', { name: 'Your browser data needs attention' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBeNull();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download original data' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('passport-recovery.json');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('{broken');
    await page.getByRole('button', { name: action, exact: true }).click();
    if (action === 'Cancel') {
      await expect(page.getByRole('alert')).toContainText('Recovery was cancelled');
      expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBe('{broken');
      expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBeNull();
    } else {
      await expect(page.locator('.country-boundary')).toHaveCount(totalPlaces);
      expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBeNull();
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem('passport:locations:v1')))!)).toHaveLength(totalPlaces);
    }
  });
}

test('migration write failure keeps legacy places usable and reports an unsaved warning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('visited:locations:v1', '[{"id":"USA","name":"United States","continent":"North America","status":"lived"}]');
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new Error('Migration quota exceeded');
      set.call(this, key, value);
    };
  });
  await ready(page);
  await expect(page.locator('path[data-country="USA"]')).toHaveAttribute('data-status', 'lived');
  await expect(page.locator('#warning')).toContainText('Migration quota exceeded');
  await expect(page.locator('#save-status')).toContainText('Not saved');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).not.toBeNull();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('cleanup failure reports saved data and retries removal after the next edit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('visited:locations:v1', '[]');
    const remove = Storage.prototype.removeItem;
    let fail = true;
    Storage.prototype.removeItem = function (key) {
      if (key === 'visited:locations:v1' && fail) {
        fail = false;
        throw new Error('Cleanup denied');
      }
      remove.call(this, key);
    };
  });
  await ready(page);
  await expect(page.locator('#warning')).toContainText('Cleanup denied');
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe('[]');
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBe('[]');
  await findCountry(page, 'EST');
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  await expect(page.locator('#warning')).toBeHidden();
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  expect(await page.evaluate(() => localStorage.getItem('visited:locations:v1'))).toBeNull();
});

test('custom JSON import and clipboard export round-trip and older replacement resets missing additions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  const data = [{ id: 'custom:CYN', name: 'Northern Cyprus', continent: 'Europe', status: 'lived' }];
  await page.locator('#import-file').setInputFiles({ name: 'additional.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(page.locator('path[data-country="custom:CYN"]')).toHaveAttribute('data-status', 'lived');
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.locator('#toast')).toContainText('JSON copied');
  const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(exported.find((entry: { id: string }) => entry.id === 'custom:CYN').status).toBe('lived');
  await page.locator('#import-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyData)) });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(page.locator('path[data-country="custom:CYN"]')).toHaveAttribute('data-status', 'unvisited');
  await page.locator('#import-file').setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ ...data[0], id: 'custom:XXX' }])) });
  await expect(page.locator('#toast')).toContainText('Unknown territory ID');
  await expect(page.locator('path[data-country="custom:CYN"]')).toHaveAttribute('data-status', 'unvisited');
});

test('long custom identifiers and labels remain usable on a narrow screen with keyboard controls', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await ready(page);
  await page.getByRole('searchbox').fill('custom:SPI');
  const row = page.locator('.country-row[data-country="custom:SPI"]');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.popover-heading')).toContainText('Southern Patagonian Ice Field');
  await expect(page.locator('.popover-subtitle')).toContainText('custom:SPI');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await page.locator('.status-popover').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('additional-mobile.png'), fullPage: true });
});
