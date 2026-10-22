import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import registry from '../../data/registry.json' with { type: 'json' };
import type { LocationEntry, TravelStatus } from '../../src/types';

const catalog = [
  { name: 'First steps', description: 'Visit Slovakia.', condition: 'SVK', value: 10 },
  { name: 'A grand adventure across distant countries and territories', description: 'Visit Slovakia and Austria.', condition: 'SVK + AUT', value: 50 },
  { name: 'Southern explorer', description: 'Visit Antarctica.', condition: 'ATA', value: 30 },
  { name: 'Equal points', description: 'Visit Slovakia.', condition: 'SVK', value: 30 },
  { name: 'Not earned', description: 'Visit Czechia.', condition: 'CZE', value: 100 },
];
const statuses: Record<string, TravelStatus> = { SVK: 'visited', AUT: 'lived', CZE: 'want_to_visit', ATA: 'visited', 'custom:KOS': 'visited' };
const seed: LocationEntry[] = registry.filter(({ id }) => statuses[id] || id === 'FRA')
  .map(({ id, name, continent }) => ({ id, name, continent, status: statuses[id] ?? 'unvisited', favourite: ['SVK', 'FRA', 'custom:KOS'].includes(id) }));
const picture = (page: Page) => page.getByRole('dialog', { name: 'Your travel passport', exact: true });
const image = (page: Page) => picture(page).locator('.infographic-preview img');
const downloadButton = (page: Page) => picture(page).getByRole('button', { name: 'Download PNG', exact: true });

async function ready(page: Page, entries = seed, badges: unknown = catalog): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((data) => {
    if (!localStorage.getItem('passport:locations:v1')) localStorage.setItem('passport:locations:v1', JSON.stringify(data));
  }, entries);
  await page.route('**/data/badges.json', (route) => route.fulfill({ json: badges }));
  await page.goto('./?incidental=not-in-qr#map');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}
async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
}
async function png(page: Page, dimensions = [2400, 1600], capture = 'passport-share-example.png'): Promise<Buffer> {
  const event = page.waitForEvent('download');
  await downloadButton(page).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('passport-infographic.png');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(dimensions);
  expect(bytes.length).toBeGreaterThan(50000);
  if (process.env.INFOGRAPHIC_CAPTURE_DIR) await download.saveAs(join(process.env.INFOGRAPHIC_CAPTURE_DIR, capture));
  return bytes;
}
async function captureSvg(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type.startsWith('image/svg+xml')) Reflect.set(window, '__pictureSvg', blob.text());
      return original(blob);
    };
  });
}
async function portraitLayout(page: Page, height: number, story: boolean) {
  return page.evaluate(async ({ height, story }) => {
    const svg: unknown = await Reflect.get(window, '__pictureSvg');
    if (typeof svg !== 'string') throw new Error('Missing rendered SVG');
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    root.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
    document.body.append(root);
    try {
      const texts = [...root.querySelectorAll('text')].map((node) => {
        const box = node.getBBox();
        return { label: node.textContent, x: box.x, y: box.y, width: box.width, height: box.height };
      });
      const outside = texts.filter((box) => box.x < 40 || box.x + box.width > 1040
        || box.y < (story ? 160 : 30) || box.y + box.height > (story ? 1720 : height - 24));
      const overlaps: string[] = [];
      for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
        const first = texts[a]!, second = texts[b]!;
        const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
        const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
        if (width > 1 && height > 1) overlaps.push(`${first.label} / ${second.label}`);
      }
      const groups = [...root.querySelectorAll('[data-flag-group]')];
      return { outside, overlaps, text: texts.map((box) => box.label).join('\n'),
        paths: root.querySelectorAll('[data-country]').length,
        groups: groups.map((group) => group.getAttribute('data-flag-group')),
        strips: groups.map((group) => ({
          shown: group.querySelectorAll('image').length + group.querySelectorAll('rect').length - 1,
          text: group.textContent,
        })) };
    } finally { root.remove(); }
  }, { height, story });
}

test('downloads the exact preview PNG with a decodable app-only QR, actual flag pixels and marked geography', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    requests.push(request.url());
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:4173' : page.url()).origin) external.push(request.url());
  });
  await ready(page);
  expect(requests.some((url) => /infographic-ui|\/sk-[\w-]+\.svg/.test(url))).toBe(false);
  const storage = await page.evaluate(() => ({ ...localStorage }));
  await open(page);
  await expect(image(page)).toHaveAttribute('alt', /3 of 249 ISO places.*4 badges earned/);
  await expect(picture(page).locator('input')).toHaveCount(3);
  await expect(picture(page).locator('.infographic-local-warning')).toBeVisible();
  expect(await image(page).evaluate((node) => node.getBoundingClientRect().height <= innerHeight * .6 + 1)).toBe(true);
  if (process.env.INFOGRAPHIC_CAPTURE_DIR) await picture(page).screenshot({ path: join(process.env.INFOGRAPHIC_CAPTURE_DIR, 'passport-share-desktop.png') });
  const address = await picture(page).locator('.infographic-address span').innerText();
  expect(address).toBe(new URL(process.env.TEST_BASE_PATH || '/', page.url()).href);
  expect(requests.filter((url) => url === address)).toEqual([]);
  const previewHash = await image(page).evaluate(async (node: HTMLImageElement) => {
    const bytes = await (await fetch(node.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  });
  const bytes = await png(page);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(previewHash);
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
    const map = context.getImageData(120, 675, 1380, 515).data;
    let visited = 0, lived = 0, unvisited = 0;
    for (let index = 0; index < map.length; index += 4) {
      if (map[index] === 98 && map[index + 1] === 165 && map[index + 2] === 116) visited++;
      if (map[index] === 228 && map[index + 1] === 183 && map[index + 2] === 85) lived++;
      if (map[index] === 220 && map[index + 1] === 216 && map[index + 2] === 202) unvisited++;
    }
    return { width: image.width, height: image.height, qr: Array.from(context.getImageData(1990, 80, 300, 300).data),
      flagWhite: pixel(1256, 1367), flagRed: pixel(1256, 1385), visited, lived, unvisited };
  }, bytes.toString('base64'));
  expect([pixels.width, pixels.height]).toEqual([2400, 1600]);
  expect(jsQR(Uint8ClampedArray.from(pixels.qr), 300, 300)?.data).toBe(address);
  expect(pixels.flagWhite).toEqual([255, 255, 255, 255]);
  expect(pixels.flagRed).toEqual([215, 20, 26, 255]);
  expect(pixels.visited).toBeGreaterThan(2000);
  expect(pixels.lived).toBeGreaterThan(20);
  expect(pixels.unvisited).toBeGreaterThan(50000);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(storage);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('personalization is ephemeral, escaped and regenerated; blank titles have an explicit recoverable error', async ({ page }) => {
  await ready(page);
  const stored = await page.evaluate(() => ({ ...localStorage }));
  await open(page);
  const first = await image(page).getAttribute('src');
  await picture(page).getByLabel('Name (optional)').fill('Zo\u00eb <script> & friends');
  await picture(page).getByLabel('Title', { exact: true }).fill('My "Private" Atlas');
  await picture(page).getByLabel('Subtitle (optional)').fill('Memories <not markup>');
  await expect(downloadButton(page)).toBeEnabled();
  await expect(image(page)).toHaveAttribute('alt', /^My "Private" Atlas\./);
  expect(await image(page).getAttribute('src')).not.toBe(first);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(stored);
  await picture(page).getByLabel('Title', { exact: true }).fill(' ');
  await expect(picture(page).getByRole('alert')).toContainText('Please enter a title');
  await expect(downloadButton(page)).toBeDisabled();
  await expect(image(page)).toBeHidden();
  await picture(page).getByLabel('Title', { exact: true }).fill('The next adventure');
  await expect(downloadButton(page)).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(picture(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Share picture', exact: true })).toBeFocused();
  await open(page);
  await expect(picture(page).getByLabel('Name (optional)')).toHaveValue('Zo\u00eb <script> & friends');
  await page.keyboard.press('Escape');
  await page.reload();
  await open(page);
  await expect(picture(page).getByLabel('Name (optional)')).toHaveValue('');
  await expect(picture(page).getByLabel('Title', { exact: true })).toHaveValue('My Travel Passport');
});

test('catalog failures are isolated, retryable and shared with the Badges tab', async ({ page }) => {
  await ready(page);
  let requests = 0;
  await page.route('**/data/badges.json', (route) => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ json: catalog });
  });
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await expect(picture(page).getByRole('alert')).toContainText('Could not prepare');
  await expect(downloadButton(page)).toBeDisabled();
  await picture(page).getByRole('button', { name: 'Retry picture' }).click();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Badges', exact: true }).click();
  await expect(page.locator('.badge-card')).toHaveCount(catalog.length);
  await open(page);
  expect(requests).toBe(2);
});

test('missing or unsafe flag assets never produce a partial-success picture and can be retried', async ({ page }) => {
  await ready(page);
  let requests = 0;
  await page.route(/\/sk(?:-[\w-]+)?\.svg(?:\?.*)?$/, (route) => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    requests++;
    if (requests === 1) return route.fulfill({ status: 404, body: 'Missing' });
    if (requests === 2) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg onload="alert(1)"></svg>' });
    if (requests === 3) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>' });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await expect(picture(page).getByRole('alert')).toContainText('flag SK');
  await picture(page).getByRole('button', { name: 'Retry picture' }).click();
  await expect(picture(page).getByRole('alert')).toContainText('self-contained SVG');
  await expect(downloadButton(page)).toBeDisabled();
  await picture(page).getByRole('button', { name: 'Retry picture' }).click();
  await expect(picture(page).getByRole('alert')).toContainText('self-contained SVG');
  await picture(page).getByRole('button', { name: 'Retry picture' }).click();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  expect(requests).toBe(4);
});

test('PNG encoding failures are explicit and retry uses a fresh render', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let failed = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (!failed) { failed = true; callback(null); return; }
      original.call(this, callback, type, quality);
    };
  });
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await expect(picture(page).getByRole('alert')).toContainText('could not encode the PNG');
  await expect(downloadButton(page)).toBeDisabled();
  await picture(page).getByRole('button', { name: 'Retry picture' }).click();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
});

test('closing or editing during a delayed load ignores stale work and renders only the latest inputs and snapshot', async ({ page }) => {
  await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/badges.json', async (route) => { await gate; await route.fulfill({ json: catalog }); });
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await expect(picture(page).locator('.infographic-message')).toContainText('Preparing');
  await picture(page).getByLabel('Title', { exact: true }).fill('Old title');
  await picture(page).getByLabel('Picture format').selectOption('feed');
  await page.keyboard.press('Escape');
  release();
  await expect(picture(page)).toBeHidden();
  await page.locator('path.country-boundary[data-country="CZE"]').dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.locator('.status-choice[data-status="visited"]').click();
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  await picture(page).getByLabel('Title', { exact: true }).fill('Latest title');
  await picture(page).getByLabel('Picture format').selectOption('story');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  await expect(image(page)).toHaveAttribute('alt', /^Latest title\. 4 of 249 ISO places.*5 badges earned/);
  await expect(image(page)).toHaveJSProperty('naturalHeight', 1920);
  await expect(page.locator('.status-popover')).toBeHidden();
});

test('accepted replacement imports update an open picture from one current snapshot without persisting personalization', async ({ page }) => {
  await ready(page);
  await open(page);
  await picture(page).getByLabel('Picture format').selectOption('feed');
  await expect(downloadButton(page)).toBeEnabled();
  await page.locator('#import-file').setInputFiles({
    name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('[]'),
  });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  await expect(image(page)).toHaveAttribute('alt', /0 of 249 ISO places.*0 badges earned/);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['passport:locations:v1']);
});

test('failed local saves still export the current in-memory map', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new Error('Storage denied');
      return original.call(this, key, value);
    };
  });
  await page.locator('path.country-boundary[data-country="CZE"]').dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.locator('.status-choice[data-status="visited"]').click();
  await expect(page.locator('#save-status')).toContainText(/not saved/i);
  await open(page);
  await picture(page).getByLabel('Picture format').selectOption('story');
  await expect(downloadButton(page)).toBeEnabled();
  await expect(image(page)).toHaveAttribute('alt', /4 of 249 ISO places.*5 badges earned/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('passport:locations:v1')!).find((entry: LocationEntry) => entry.id === 'CZE').status)).toBe('want_to_visit');
});

for (const format of [
  { id: 'feed', label: 'Instagram Feed', height: 1350, limit: 6, qrY: 970, flagY: 919 },
  { id: 'story', label: 'Story', height: 1920, limit: 12, qrY: 1370, flagY: 1263 },
] as const) {
  test(`${format.id}: reflowed PNG retains all sections, real flags, readable QR and non-overlapping text`, async ({ page }) => {
    await captureSvg(page);
    await ready(page);
    const stored = await page.evaluate(() => ({ ...localStorage }));
    await open(page);
    await picture(page).getByLabel('Picture format').selectOption(format.id);
    await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
    await expect(image(page)).toHaveAttribute('alt', new RegExp(`${format.label}, 1080 by ${format.height}`));
    await expect(picture(page).locator('.infographic-resolution')).toContainText(`1080 \u00d7 ${format.height}`);
    const blobHash = await image(page).evaluate(async (node: HTMLImageElement) => {
      const bytes = await (await fetch(node.src)).arrayBuffer();
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    const bytes = await png(page, [1080, format.height], `passport-share-${format.id}.png`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(blobHash);
    const pixels = await page.evaluate(async ({ base64, qrY, flagY }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return { qr: Array.from(context.getImageData(732, qrY, 300, 300).data),
        white: sample(94, flagY + 7), red: sample(94, flagY + 25) };
    }, { base64: bytes.toString('base64'), qrY: format.qrY, flagY: format.flagY });
    expect(jsQR(Uint8ClampedArray.from(pixels.qr), 300, 300)?.data).toBe(new URL(process.env.TEST_BASE_PATH || '/', page.url()).href);
    expect(pixels.white).toEqual([255, 255, 255, 255]);
    expect(pixels.red).toEqual([215, 20, 26, 255]);
    const layout = await portraitLayout(page, format.height, format.id === 'story');
    expect(layout.outside).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    expect(layout.paths).toBe(266);
    expect(layout.groups).toEqual(['visited', 'lived', 'want_to_visit', 'favourite']);
    for (const text of ['3/249', '2/7', '4 earned', '50 points', 'Southern explorer', 'Equal points', 'Favourites', 'KOS']) expect(layout.text).toContain(text);
    expect(layout.text).not.toContain('First steps');
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(stored);
  });
}

test('format selection survives reopen, resets on reload and invalidates previews during rapid changes', async ({ page }) => {
  await ready(page);
  await open(page);
  const select = picture(page).getByLabel('Picture format');
  await expect(select).toHaveValue('horizontal');
  await expect(select.locator('option')).toHaveCount(3);
  await picture(page).getByLabel('Name (optional)').fill('A traveller');
  await select.selectOption('feed');
  await expect(downloadButton(page)).toBeDisabled();
  await select.selectOption('story');
  await select.selectOption('horizontal');
  await select.selectOption('feed');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  await expect(image(page)).toHaveJSProperty('naturalHeight', 1350);
  await expect(picture(page).getByLabel('Name (optional)')).toHaveValue('A traveller');
  await page.keyboard.press('Escape');
  await open(page);
  await expect(select).toHaveValue('feed');
  await expect(image(page)).toHaveJSProperty('naturalWidth', 1080);
  await page.keyboard.press('Escape');
  await page.reload();
  await open(page);
  await expect(select).toHaveValue('horizontal');
  await expect(image(page)).toHaveJSProperty('naturalWidth', 2400);
});

test('all-place overflow and zero groups render successfully without fetching undisplayed flags', async ({ page }) => {
  await captureSvg(page);
  const flagRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && /\/(?:assets|node_modules\/flag-icons)\/.*\.svg(?:\?.*)?$/.test(new URL(request.url()).pathname)) flagRequests.push(request.url());
  });
  const dense: LocationEntry[] = registry.map(({ id, name, continent }, index) => ({
    id, name, continent, status: index < 100 ? 'visited' : index < 150 ? 'lived' : index < 200 ? 'want_to_visit' : 'unvisited', favourite: true,
  }));
  await ready(page, dense);
  await open(page);
  await expect(image(page)).toHaveAttribute('alt', /150 of 249 ISO places/);
  await picture(page).getByLabel('Title', { exact: true }).fill('W'.repeat(80));
  await picture(page).getByLabel('Name (optional)').fill('W'.repeat(60));
  await picture(page).getByLabel('Subtitle (optional)').fill('W'.repeat(120));
  await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
  await expect(image(page)).toHaveJSProperty('naturalWidth', 2400);
  expect(flagRequests.length).toBeGreaterThan(18);
  expect(flagRequests.length).toBeLessThanOrEqual(72);
  expect(new Set(flagRequests).size).toBe(flagRequests.length);
  if (process.env.INFOGRAPHIC_CAPTURE_DIR) {
    const event = page.waitForEvent('download');
    await downloadButton(page).click();
    await (await event).saveAs(join(process.env.INFOGRAPHIC_CAPTURE_DIR, 'passport-share-dense.png'));
  }
  for (const [id, height, limit] of [['feed', 1350, 6], ['story', 1920, 12]] as const) {
    await picture(page).getByLabel('Picture format').selectOption(id);
    await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
    const layout = await portraitLayout(page, height, id === 'story');
    expect(layout.outside).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    for (const [index, total] of [100, 50, 50, 266].entries()) {
      expect(layout.strips[index]!.shown).toBe(limit);
      expect(layout.strips[index]!.text).toContain(`+${total - limit} more`);
    }
    if (process.env.INFOGRAPHIC_CAPTURE_DIR) {
      const event = page.waitForEvent('download');
      await downloadButton(page).click();
      await (await event).saveAs(join(process.env.INFOGRAPHIC_CAPTURE_DIR, `passport-share-${id}-dense.png`));
    }
  }
});

test('every ISO flag can be loaded, validated and embedded from the deployed local assets', async ({ page }) => {
  const iso = registry.filter((country) => country.kind === 'iso');
  const fetched = new Set<string>();
  page.on('request', (request) => {
    if (request.resourceType() !== 'fetch') return;
    const match = new URL(request.url()).pathname.match(/\/([a-z]{2})(?:-[\w-]+)?\.svg$/);
    if (match) fetched.add(match[1]!);
  });
  await ready(page, [], []);
  await open(page);
  for (let offset = 0; offset < iso.length; offset += 72) {
    const batch = iso.slice(offset, offset + 72);
    const data: LocationEntry[] = batch.map(({ id, name, continent }, index) => ({
      id, name, continent, status: index < 18 ? 'visited' : index < 36 ? 'lived' : index < 54 ? 'want_to_visit' : 'unvisited',
      favourite: index >= 54,
    }));
    await page.locator('#import-file').setInputFiles({
      name: 'flags.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.getByRole('button', { name: 'Replace data', exact: true }).click();
    await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
    await expect(image(page)).toHaveAttribute('alt', new RegExp(`${Math.min(batch.length, 36)} of 249 ISO places`));
  }
  expect([...fetched].sort()).toEqual(iso.map((country) => country.alpha2!.toLowerCase()).sort());
});

async function checkFooterActions(page: Page): Promise<void> {
  const actions = page.locator('.sidebar-footer > .data-actions > button');
  await expect(actions).toHaveText(['Export data', 'Copy JSON', 'Import']);
  for (const action of await actions.all()) {
    await expect(action).toHaveClass('text-button');
    await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(action).toHaveCSS('border-top-width', '0px');
    await expect(action).toHaveCSS('text-decoration-line', 'underline');
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
  }
  const rows = await actions.evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, right: bounds.right };
  }));
  for (const bounds of rows) {
    expect(bounds.y).toBe(rows[0]!.y);
  }
  expect(rows[0]!.x).toBeLessThan(rows[1]!.x);
  expect(rows[1]!.right).toBeLessThan(rows[2]!.x);
  expect(await actions.evaluateAll((buttons) => buttons.map((button) => button.id)))
    .toEqual(['export-data', 'copy-data', 'import-data']);
  await expect(page.locator('.sidebar-footer #share-picture, .picture-actions')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.data-license a').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.data-license a').last()).toBeInViewport();
}

async function checkHeadingCamera(page: Page): Promise<void> {
  const share = page.getByRole('button', { name: 'Share picture', exact: true });
  await expect(share).toHaveCount(1);
  await expect(page.locator('.sidebar-heading > #share-picture')).toHaveCount(1);
  await expect(page.locator('.globe-icon')).toHaveCount(0);
  await expect(share).toHaveAttribute('title', 'Share picture');
  await expect(share).toHaveAttribute('aria-label', 'Share picture');
  await expect(share).toHaveText('');
  await share.scrollIntoViewIfNeeded();
  await expect(share).toBeInViewport();
  const geometry = await page.locator('.sidebar-heading').evaluate((heading) => {
    const button = heading.querySelector('#share-picture')!.getBoundingClientRect();
    const title = heading.querySelector('div')!.getBoundingClientRect();
    const bounds = heading.getBoundingClientRect();
    return {
      width: button.width, height: button.height, gap: button.left - title.right,
      rightInset: bounds.right - button.right,
      paddingRight: parseFloat(getComputedStyle(heading).paddingRight),
      centerOffset: button.top + button.height / 2 - title.top - title.height / 2,
      fits: heading.scrollWidth <= heading.clientWidth,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(40);
  expect(geometry.height).toBe(geometry.width);
  expect(geometry.gap).toBeGreaterThanOrEqual(12);
  expect(geometry.rightInset).toBeCloseTo(geometry.paddingRight, 1);
  expect(geometry.centerOffset).toBeCloseTo(0, 1);
  expect(geometry.fits).toBe(true);
}

for (const theme of ['classic', 'dark', 'medieval'] as const) {
  test(`${theme}: shared heading camera, footer actions, short desktop/mobile fit, focus containment and preserved live map`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 620 });
    await ready(page, [], []);
    await page.locator('#theme-picker').selectOption(theme);
    const share = page.getByRole('button', { name: 'Share picture', exact: true });
    await expect(share).toHaveClass('button primary');
    await expect(share.locator('svg')).toBeVisible();
    await expect(share.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const fills = { classic: 'rgb(8, 106, 168)', dark: 'rgb(115, 151, 235)', medieval: 'rgb(100, 69, 30)' };
    await expect(share).toHaveCSS('background-color', fills[theme]);
    await checkHeadingCamera(page);
    await share.focus();
    await expect(share).toBeFocused();
    await expect(share).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'Manage countries', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(share).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
    await page.keyboard.press('Escape');
    await expect(share).toBeFocused();
    await page.locator('#export-data').focus();
    for (const id of ['copy-data', 'import-data']) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`#${id}`)).toBeFocused();
    }
    for (let index = 0; index < 2; index++) await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#export-data')).toBeFocused();
    await page.locator('.google-sync summary').click();
    expect(await page.locator('.country-groups').evaluate((node) => node.clientHeight)).toBeGreaterThan(90);
    await checkFooterActions(page);
    await share.scrollIntoViewIfNeeded();
    await expect(share).toBeInViewport();
    if (process.env.INFOGRAPHIC_CAPTURE_DIR) await page.locator('.sidebar').screenshot({ path: join(process.env.INFOGRAPHIC_CAPTURE_DIR, `passport-share-button-${theme}.png`) });
    await page.getByRole('searchbox').fill('SVK');
    await page.getByRole('button', { name: 'Filter by Favourites', exact: true }).click();
    const map = await page.locator('path.country-boundary[data-country="SVK"]').elementHandle();
    const scenery = await page.locator('.map-scenery').elementHandle();
    for (const tab of ['Stats', 'Badges', 'Manage countries']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await open(page);
      await expect(image(page)).toHaveAttribute('alt', /0 of 249 ISO places.*0 badges earned/);
      await picture(page).getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Tab');
      expect(await picture(page).evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
      const fits = await picture(page).evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
      });
      expect(fits).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    expect(await map!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await scenery!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.getByRole('searchbox')).toHaveValue('SVK');
    await expect(page.getByRole('button', { name: 'Filter by Favourites', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 1440, height: 900 });
    await checkHeadingCamera(page);
    if (process.env.INFOGRAPHIC_CAPTURE_DIR) {
      await page.locator('.sidebar-heading').screenshot({ path: join(process.env.INFOGRAPHIC_CAPTURE_DIR, `passport-share-header-${theme}-desktop.png`) });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await checkHeadingCamera(page);
    if (process.env.INFOGRAPHIC_CAPTURE_DIR) {
      await page.locator('.sidebar-heading').screenshot({ path: join(process.env.INFOGRAPHIC_CAPTURE_DIR, `passport-share-header-${theme}-mobile.png`) });
    }
    await checkFooterActions(page);
    await open(page);
    await picture(page).getByLabel('Picture format').selectOption('story');
    await expect(downloadButton(page)).toBeEnabled();
    expect(await picture(page).evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth && dialog.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await expect(downloadButton(page)).toBeVisible();
    if (process.env.INFOGRAPHIC_CAPTURE_DIR) {
      await picture(page).screenshot({ path: join(process.env.INFOGRAPHIC_CAPTURE_DIR, `passport-share-${theme}-mobile.png`) });
    }
  });
}

test('portrait maximum badge names and Unicode personalization remain within their text regions', async ({ page }) => {
  await captureSvg(page);
  await ready(page, seed, catalog.map((badge) => ({
    ...badge, name: badge.value === 50 ? 'W'.repeat(120) : badge.value === 30 ? `${badge.name} ${'\u00c9'.repeat(90)}` : badge.name,
  })));
  await open(page);
  await picture(page).getByLabel('Title', { exact: true }).fill('\u00c9'.repeat(80));
  await picture(page).getByLabel('Name (optional)').fill('Zo\u00eb <Traveller>');
  await picture(page).getByLabel('Subtitle (optional)').fill('Memories & adventures \u{1f30d}');
  for (const [id, height] of [['feed', 1350], ['story', 1920]] as const) {
    await picture(page).getByLabel('Picture format').selectOption(id);
    await expect(downloadButton(page)).toBeEnabled({ timeout: 20000 });
    const layout = await portraitLayout(page, height, id === 'story');
    expect(layout.outside).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    expect(layout.text).toContain('Zo\u00eb <Traveller>');
    expect(layout.text).toContain('Memories & adventures');
  }
});
