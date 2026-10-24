import { expect, test, type Page } from '@playwright/test';
import initial from '../../data/user-data.json' with { type: 'json' };
import type { Snapshot } from '../../src/google-drive';
import { STATUSES, type TravelStatus } from '../../src/types';

interface CloudFile { metadata: { id: string; description: string; mimeType: string; appProperties: { passport: string } }; snapshot: Snapshot }
interface Cloud { files: Map<string, CloudFile>; next: number; requests: string[]; failList: boolean; owner: string; denyScope: boolean }
function cloud(): Cloud { return { files: new Map(), next: 0, requests: [], failList: false, owner: 'account-one', denyScope: false }; }
async function mockGoogle(page: Page, drive = cloud()): Promise<Cloud> {
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    drive.requests.push('sdk');
    await route.fulfill({ contentType: 'application/javascript', body: `
      window.google = { accounts: { oauth2: {
        initTokenClient(config) { return { requestAccessToken() {
          window.__googleUserGesture = navigator.userActivation.isActive;
          queueMicrotask(() => config.callback({ access_token: 'test-access-token-not-for-storage', expires_in: 3600, token_type: 'Bearer' }));
        } }; },
        hasGrantedAllScopes() { return ${!drive.denyScope}; }
      } } };
    ` });
  });
  await page.route('https://openidconnect.googleapis.com/v1/userinfo', async (route) => {
    drive.requests.push('userinfo');
    expect(route.request().headers().authorization).toBe('Bearer test-access-token-not-for-storage');
    await route.fulfill({ json: { sub: drive.owner, email: `${drive.owner}@example.test` } });
  });
  await page.route(/https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/files/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    drive.requests.push(`${request.method()} ${url.pathname}`);
    expect(request.headers().authorization).toBe('Bearer test-access-token-not-for-storage');
    if (url.pathname.endsWith('/generateIds')) {
      expect(url.searchParams.get('space')).toBe('appDataFolder');
      await route.fulfill({ json: { ids: [`file-${++drive.next}`] } });
    } else if (url.pathname.startsWith('/upload/')) {
      expect(request.method()).toBe('POST');
      const parts = request.postData()!.split('\r\n\r\n');
      const metadata = JSON.parse(parts[1]!.split('\r\n')[0]!) as CloudFile['metadata'] & { parents: string[] };
      const snapshot = JSON.parse(parts[2]!.split('\r\n')[0]!) as Snapshot;
      expect(metadata.parents).toEqual(['appDataFolder']);
      if (drive.files.has(metadata.id)) await route.fulfill({ status: 409, json: { error: { errors: [{ reason: 'conflict' }] } } });
      else { drive.files.set(metadata.id, { metadata, snapshot }); await route.fulfill({ json: { id: metadata.id } }); }
    } else if (url.searchParams.get('alt') === 'media') {
      const saved = drive.files.get(url.pathname.split('/').at(-1)!);
      await route.fulfill(saved ? { json: saved.snapshot } : { status: 404, json: { error: { errors: [{ reason: 'notFound' }] } } });
    } else {
      expect(url.searchParams.get('spaces')).toBe('appDataFolder');
      await route.fulfill(drive.failList ? { status: 403, json: { error: { errors: [{ reason: 'accessNotConfigured' }] } } }
        : { json: { files: [...drive.files.values()].map((value) => value.metadata), incompleteSearch: false } });
    }
  });
  return drive;
}
async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(266);
}
async function connect(page: Page): Promise<void> {
  await page.locator('.google-sync summary').click();
  const button = page.getByRole('button', { name: 'Connect Google Drive', exact: true });
  test.skip(await button.isDisabled(), 'Configured build required for mocked Google provider scenarios.');
  await button.click();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
}
async function backup(page: Page): Promise<void> {
  await connect(page);
  await page.getByRole('button', { name: 'Back up this device to Google Drive', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
}
async function status(page: Page, id: string, value: string): Promise<void> {
  await page.getByRole('searchbox').fill(id);
  await page.locator(`.country-row[data-country="${id}"]`).click();
  await page.locator(`.status-choice[data-status="${value}"]`).click();
}
function addRemote(drive: Cloud, status: TravelStatus = 'lived'): void {
  const referenced = new Set([...drive.files.values()].flatMap((value) => value.snapshot.predecessors));
  const heads = [...drive.files.keys()].filter((id) => !referenced.has(id));
  const snapshot: Snapshot = {
    version: 1, operationId: `remote-${drive.next}`, predecessors: heads, createdAt: '2026-05-01T00:00:00.000Z',
    entries: initial.map((entry) => {
      const originalStatus = STATUSES.find((value) => value === entry.status);
      if (!originalStatus) throw new Error('Invalid test seed status.');
      return { ...entry, status: entry.id === 'EST' ? status : originalStatus };
    }),
  };
  drive.files.set('remote-version', { snapshot, metadata: { id: 'remote-version', description: JSON.stringify({
    version: 1, operationId: snapshot.operationId, predecessors: snapshot.predecessors, createdAt: snapshot.createdAt,
  }), mimeType: 'application/json', appProperties: { passport: 'passport-sync-v1' } } });
}

test('local use makes no Google requests and unconfigured Google never blocks the map', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await status(page, 'EST', 'visited');
  await page.locator('.google-sync summary').click();
  if (await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).isDisabled()) {
    await expect(page.locator('.google-sync-status')).toContainText('not configured');
  }
  expect(drive.requests).toEqual([]);
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('explicit backup, automatic edits and reload reconnection preserve local data without storing tokens', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  expect(await page.evaluate(() => Reflect.get(window, '__googleUserGesture'))).toBe(true);
  expect(drive.files.size).toBe(1);
  const originalPath = await page.locator('path[data-country="EST"]').getAttribute('d');
  await status(page, 'EST', 'visited');
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await expect.poll(() => drive.files.size).toBe(2);
  expect([...drive.files.values()].at(-1)?.snapshot.entries.find((entry) => entry.id === 'EST')?.status).toBe('visited');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-access-token');
  expect(await page.locator('path[data-country="EST"]').getAttribute('d')).toBe(originalPath);
  expect(page.url()).not.toContain('token');
  await page.reload();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'reconnect');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
  expect(drive.files.size).toBe(2);
});

test('chooses a remote version only after confirmation, with downloadable versions and no upload echo', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  addRemote(drive);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose your travel map' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'unvisited');
  const saved = drive.files.size;
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Download Google Drive version/ }).click();
  expect((await download).suggestedFilename()).toBe('passport-sync-backup.json');
  await dialog.getByRole('button', { name: /^Google Drive version/ }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'lived');
  expect(drive.files.size).toBe(saved);
});

test('accepted Drive replacement updates active sidebar filter membership without syncing the filters', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  await page.getByRole('button', { name: 'Filter by Lived / Living', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  addRemote(drive);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.country-row[data-country="EST"]')).toBeHidden();
  const size = drive.files.size;
  await page.getByRole('dialog', { name: 'Choose your travel map' })
    .getByRole('button', { name: /^Google Drive version/ }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await expect(page.locator('.country-row[data-country="EST"]')).toBeVisible();
  await expect(page.locator('.sidebar-meta')).toHaveText('1 matching places');
  await expect(page.getByRole('button', { name: 'Filter by Lived / Living', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(drive.files.size).toBe(size);
  expect([...drive.files.values()].every((file) => Array.isArray(file.snapshot.entries))).toBe(true);
});

test('accepted Drive data refreshes an open travel picture without upload echo', async ({ page }) => {
  const drive = await mockGoogle(page);
  await page.route('**/data/badges.json', (route) => route.fulfill({ json: [
    { name: 'Estonia', description: 'Visit or live in Estonia.', condition: 'EST', value: 5 },
  ] }));
  await ready(page);
  await backup(page);
  addRemote(drive);
  drive.files.get('remote-version')!.snapshot.entries.push({
    id: 'custom:SOL', name: 'Somaliland', continent: 'Africa', status: 'visited', favourite: true,
  });
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: 'Choose your travel map' });
  await expect(conflict).toBeVisible();
  await page.getByRole('button', { name: 'Cancel and pause sync', exact: true }).click();
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'Your travel passport', exact: true });
  await expect(picture.getByRole('button', { name: 'Download PNG' })).toBeEnabled({ timeout: 20000 });
  await picture.getByLabel('Picture format').selectOption('story');
  await expect(picture.getByRole('button', { name: 'Download PNG' })).toBeEnabled({ timeout: 20000 });
  await expect(picture.locator('img')).toHaveAttribute('alt', /0 of 266 places.*0 badges earned/);
  await page.getByRole('button', { name: 'Sync now', exact: true }).dispatchEvent('click');
  await expect(conflict).toBeVisible();
  const count = drive.files.size;
  await conflict.getByRole('button', { name: /^Google Drive version/ }).click();
  await expect(picture.getByRole('button', { name: 'Download PNG' })).toBeEnabled({ timeout: 20000 });
  await expect(picture.locator('img')).toHaveAttribute('alt', /2 of 266 places.*1 badges earned/);
  await expect(picture.locator('img')).toHaveJSProperty('naturalHeight', 1920);
  expect(drive.files.size).toBe(count);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('[data-stat="completed"]')).toHaveText('2/266 (0.8%)');
  await expect(page.locator('[data-stat="continents"]')).toHaveText('2/7');
});

test('favourite-only changes save to Drive and remote replacements update stars without upload echo', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  await page.getByRole('searchbox').fill('EST');
  const star = page.locator('.country-favourite[data-country="EST"]');
  await star.click();
  await expect.poll(() => drive.files.size).toBe(2);
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  const localVersion = [...drive.files.values()].at(-1)!.snapshot;
  expect(localVersion.entries.find((entry) => entry.id === 'EST')).toMatchObject({
    favourite: true, status: 'unvisited',
  });
  await page.getByRole('button', { name: 'Filter by Favourites', exact: true }).click();
  addRemote(drive, 'unvisited');
  drive.files.get('remote-version')!.snapshot.entries = localVersion.entries.map((entry) =>
    entry.id === 'EST' ? { ...entry, favourite: false } : entry);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose your travel map' });
  const remote = dialog.locator('.sync-version').filter({ has: page.getByRole('button', { name: /^Google Drive version/ }) });
  await expect(remote).toContainText('0 place statuses and 1 favourite flags differ');
  const files = drive.files.size;
  await remote.getByRole('button', { name: /^Google Drive version/ }).click();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filter by Favourites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-favourite', 'false');
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'unvisited');
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  expect(drive.files.size).toBe(files);
});

test('accepted Drive data updates hidden Manage and live Stats/Badges without changing tabs or uploading awards', async ({ page }) => {
  const drive = await mockGoogle(page);
  await page.route('**/data/badges.json', (route) => route.fulfill({ json: [
    { name: 'Estonia', description: 'Visit or live in Estonia.', condition: 'EST', value: 10 },
  ] }));
  await ready(page);
  await backup(page);
  await page.getByRole('tab', { name: 'Badges', exact: true }).click();
  await expect(page.locator('#badge-summary')).toContainText('0/10 points');
  addRemote(drive);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  const size = drive.files.size;
  await page.getByRole('dialog', { name: 'Choose your travel map' })
    .getByRole('button', { name: /^Google Drive version/ }).click();
  await expect(page.getByRole('tab', { name: 'Badges', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#badge-summary')).toContainText('10/10 points');
  await expect(page.locator('.badge-country[data-country="EST"]')).toHaveAttribute('data-status', 'lived');
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('[data-stat="lived"]')).toHaveText('1');
  await page.getByRole('tab', { name: 'Manage countries', exact: true }).click();
  await expect(page.locator('#lived-count')).toHaveText('1');
  expect(drive.files.size).toBe(size);
  expect([...drive.files.values()].some((file) => 'badges' in file.snapshot)).toBe(false);
});

test('cancelled conflict stays paused and sign-out leaves local and Drive maps intact', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  addRemote(drive);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and pause sync', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'paused');
  await status(page, 'EST', 'visited');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'local');
  const requests = drive.requests.length;
  await status(page, 'USA', 'lived');
  expect(drive.requests.length).toBe(requests);
  expect(drive.files.size).toBe(2);
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('denied Drive setup is actionable and retry does not create duplicate files', async ({ page }) => {
  const drive = await mockGoogle(page);
  drive.failList = true;
  await ready(page);
  await connect(page);
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'error');
  await expect(page.locator('.google-sync-status')).toContainText('accessNotConfigured');
  expect(drive.files.size).toBe(0);
  drive.failList = false;
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await page.getByRole('button', { name: 'Back up this device to Google Drive', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  expect(drive.files.size).toBe(1);
});

test('a changed Google account cannot silently adopt the current device map', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  await status(page, 'EST', 'visited');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  drive.owner = 'account-two';
  drive.files.clear();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose your travel map' })).toContainText('account-two@example.test');
  expect(drive.files.size).toBe(0);
  await page.getByRole('button', { name: 'Cancel and pause sync', exact: true }).click();
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('partial scope denial keeps local edits available', async ({ page }) => {
  const drive = await mockGoogle(page);
  drive.denyScope = true;
  await ready(page);
  await connect(page);
  await expect(page.locator('.google-sync-status')).toContainText('permission was not granted');
  await status(page, 'EST', 'visited');
  expect(drive.files.size).toBe(0);
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('a blocked Google script is recoverable without affecting local use', async ({ page }) => {
  const drive = await mockGoogle(page);
  await page.route('https://accounts.google.com/gsi/client', (route) => route.abort(), { times: 1 });
  await ready(page);
  await page.locator('.google-sync summary').click();
  const connect = page.getByRole('button', { name: 'Connect Google Drive', exact: true });
  test.skip(await connect.isDisabled(), 'Configured mock-provider build required.');
  await connect.click();
  await expect(page.locator('.google-sync-status')).toContainText('could not load');
  await status(page, 'EST', 'visited');
  await connect.click();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByRole('button', { name: 'Back up this device to Google Drive', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  expect(drive.files.size).toBe(1);
});

test('cloud success cannot hide a local-save failure', async ({ page }) => {
  await mockGoogle(page);
  await ready(page);
  await backup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new Error('Browser quota exceeded');
      original.call(this, key, value);
    };
  });
  await status(page, 'EST', 'visited');
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await expect(page.locator('#warning')).toContainText('not saved');
  await expect(page.locator('#save-status')).toContainText('Not saved');
});

test('sign-out in another real tab disconnects without overwriting the current map', async ({ page, context }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  const second = await context.newPage();
  await mockGoogle(second, drive);
  await ready(second);
  await second.locator('.google-sync summary').click();
  await second.getByRole('button', { name: 'Reconnect Google', exact: true }).click();
  await second.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(second.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await second.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'local');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
  const count = drive.requests.length;
  await status(page, 'EST', 'visited');
  expect(drive.requests.length).toBe(count);
  await second.close();
});

test('hiding the sidebar leaves automatic Google synchronization running and its controls intact', async ({ page }) => {
  const drive = await mockGoogle(page);
  await ready(page);
  await backup(page);
  await status(page, 'EST', 'visited');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect.poll(() => drive.files.size).toBe(2);
  await expect(page.locator('#google-sync')).toHaveAttribute('data-sync-phase', 'synced');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('EST');
  await expect(page.locator('.country-row[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
});

test('connection controls fit all themes on narrow screens and remain keyboard accessible', async ({ page }, testInfo) => {
  await mockGoogle(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await ready(page);
  await page.locator('.google-sync summary').click();
  for (const theme of ['classic', 'dark', 'medieval']) {
    await page.locator('#theme-picker').selectOption(theme);
    await expect(page.getByRole('button', { name: 'Export data' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sync-${theme}-mobile.png`), fullPage: true });
  }
  await page.locator('.google-sync summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.google-sync')).not.toHaveAttribute('open');
});

test('conflict choices fit desktop and narrow Medieval without moving the map', async ({ page }, testInfo) => {
  const drive = await mockGoogle(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await backup(page);
  addRemote(drive);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose your travel map' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sync-conflict-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel and pause sync', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('#theme-picker').selectOption('medieval');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose your travel map' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sync-conflict-medieval-mobile.png'), fullPage: true });
});

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme}: expanded Google status leaves countries clickable with a long account in short desktop windows`, async ({ page }) => {
    const drive = await mockGoogle(page);
    drive.owner = 'a-long-account-name-for-testing-footer-wrapping-without-truncating-the-identity';
    await page.setViewportSize({ width: 1100, height: 620 });
    await ready(page);
    await page.locator('#theme-picker').selectOption(theme);
    await backup(page);
    await expect(page.locator('.google-account')).toContainText(`${drive.owner}@example.test`);
    expect(await page.locator('.google-sync-panel').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(page.locator('.google-account')).toHaveCSS('font-size', '12px');
    await expect(page.locator('.google-sync-last').last()).toHaveCSS('font-size', '11px');
    await status(page, 'EST', 'visited');
    await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'visited');
    for (const name of ['Data sources', 'mledoze/countries', 'ODbL', 'View on GitHub']) {
      const link = page.locator('.sidebar-footer').getByRole('link', { name, exact: true });
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeInViewport();
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await status(page, 'USA', 'lived');
    await expect(page.locator('path[data-country="USA"]')).toHaveAttribute('data-status', 'lived');
  });
}
