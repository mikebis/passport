import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuth, GOOGLE_SCOPES, loadGoogleSdk } from '../src/google-auth';
import { GoogleDrive, DriveError, lineage, snapshotHeads, type Snapshot, type SnapshotFile } from '../src/google-drive';
import { canonicalData, DISCONNECT_KEY, DriveSync, LINK_KEY, PENDING_PREFIX } from '../src/sync';
import { normalizeData, TravelStore } from '../src/store';
import type { LocationEntry, Territory } from '../src/types';

const registry: Territory[] = [
  { id: 'USA', kind: 'iso', alpha2: 'US', name: 'United States', continent: 'North America', marker: [-100, 40], microstate: false },
  { id: 'EST', kind: 'iso', alpha2: 'EE', name: 'Estonia', continent: 'Europe', marker: [25, 59], microstate: false },
];
const data = (status: LocationEntry['status'] = 'unvisited'): LocationEntry[] => normalizeData([
  { id: 'EST', name: 'Estonia', continent: 'Europe', status },
], registry);
const snapshot = (id = 'operation', predecessors: string[] = [], entries = data()): Snapshot => ({
  version: 1, operationId: id, predecessors, createdAt: '2026-01-01T00:00:00.000Z', entries,
});
const file = (id: string, predecessors: string[] = []): SnapshotFile => ({ id, ...lineage(snapshot(id, predecessors)) });
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
}
class MemoryDrive extends GoogleDrive {
  files = new Map<string, Snapshot>();
  uploads: string[] = [];
  next = 0;
  beforeUpload?: (id: string, value: Snapshot) => Promise<void>;
  constructor() { super(registry); }
  override async list(): Promise<SnapshotFile[]> { return [...this.files].map(([id, value]) => ({ id, ...lineage(value) })); }
  override async read(id: string): Promise<Snapshot> {
    const value = this.files.get(id);
    if (!value) throw new DriveError(404, '', 0);
    return structuredClone(value);
  }
  override async allocate(): Promise<string> { return `file-${++this.next}`; }
  override async upload(id: string, value: Snapshot): Promise<void> {
    await this.beforeUpload?.(id, value);
    if (this.files.has(id)) expect(this.files.get(id)).toEqual(value);
    this.files.set(id, structuredClone(value));
    this.uploads.push(id);
  }
}
const controllers: DriveSync[] = [];
function fixture(drive = new MemoryDrive(), storage = new MemoryStorage(), owner = 'account-one', entries = data()) {
  const auth = new GoogleAuth('test.apps.googleusercontent.com');
  vi.spyOn(auth, 'authorize').mockImplementation(async () => {
    const access = { token: 'private-test-token', account: { sub: owner, email: `${owner}@example.test` }, expiresAt: Date.now() + 3600000 };
    auth.access = access;
    return access;
  });
  const store = new TravelStore(entries, registry, storage, vi.fn());
  const beforeReplace = vi.fn();
  const sync = new DriveSync(auth, drive, store, storage, beforeReplace);
  controllers.push(sync);
  return { sync, auth, store, storage, drive, beforeReplace };
}
async function linked() {
  const context = fixture();
  await context.sync.connect();
  await context.sync.resolve('local');
  expect(context.sync.state.phase).toBe('synced');
  return context;
}
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Google authentication', () => {
  it('shares opt-in SDK loading, reports timeout and permits retry', async () => {
    vi.useFakeTimers();
    const scripts: { onload?: () => void; onerror?: () => void; remove: () => void }[] = [];
    const append = vi.fn();
    const browser = {};
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', { createElement: () => {
      const script = { remove: vi.fn() };
      scripts.push(script);
      return script;
    }, head: { append } });
    const first = loadGoogleSdk();
    expect(loadGoogleSdk()).toBe(first);
    const rejected = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(scripts[0]?.remove).toHaveBeenCalled();
    const retry = loadGoogleSdk();
    const sdk = { accounts: { oauth2: {} } };
    Object.assign(browser, { google: sdk });
    scripts[1]!.onload!();
    expect(await retry).toEqual(sdk);
    expect(append).toHaveBeenCalledTimes(2);
  });
  it('requires public configuration, requests minimal scopes and authenticates UserInfo without persisting tokens', async () => {
    let config: Parameters<NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']>[0] | undefined;
    const requestAccessToken = vi.fn(() => config!.callback({ access_token: 'secret-token', expires_in: 3600, token_type: 'Bearer' }));
    const hasScopes = vi.fn(() => true);
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: vi.fn((value) => { config = value; return { requestAccessToken }; }), hasGrantedAllScopes: hasScopes,
    } } } });
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ sub: 'stable-sub', email: 'person@example.test' }));
    const auth = new GoogleAuth('test.apps.googleusercontent.com', request);
    await auth.prepare();
    const access = await auth.authorize();
    expect(access.account.sub).toBe('stable-sub');
    expect(config?.scope.split(' ')).toEqual(GOOGLE_SCOPES);
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(request.mock.calls[0]?.[0]).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer secret-token' });
    auth.disconnect();
    expect(auth.access).toBeUndefined();
    await expect(new GoogleAuth('').prepare()).rejects.toThrow('not configured');
  });
  it.each(['scope', 'popup', 'identity', 'lifetime'])('rejects %s failures explicitly', async (mode) => {
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: (config: Parameters<NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']>[0]) => ({
        requestAccessToken: () => mode === 'popup' ? config.error_callback({ type: 'popup_closed' })
          : config.callback({ access_token: 'secret', expires_in: mode === 'lifetime' ? 1 : 3600, token_type: 'Bearer' }),
      }),
      hasGrantedAllScopes: () => mode !== 'scope',
    } } } });
    const auth = new GoogleAuth('test.apps.googleusercontent.com', vi.fn<typeof fetch>().mockResolvedValue(json({ email: 'no-sub' })));
    await auth.prepare();
    await expect(auth.authorize()).rejects.toThrow(mode === 'scope' ? 'permission' : mode === 'popup' ? 'cancelled' : mode === 'lifetime' ? 'invalid or expired' : 'identity');
    expect(auth.access).toBeUndefined();
  });
  it('cancels late callbacks and expires access without storing a token', async () => {
    let config: Parameters<NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']>[0] | undefined;
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: (value: NonNullable<typeof config>) => { config = value; return { requestAccessToken: () => {} }; },
      hasGrantedAllScopes: () => true,
    } } } });
    const auth = new GoogleAuth('test.apps.googleusercontent.com', request);
    await auth.prepare();
    const result = auth.authorize();
    auth.disconnect();
    await expect(result).rejects.toThrow('cancelled');
    config!.callback({ access_token: 'late-secret', expires_in: 3600, token_type: 'Bearer' });
    expect(request).not.toHaveBeenCalled();
    expect(auth.access).toBeUndefined();
  });
});

describe('private immutable Drive protocol', () => {
  it('preserves favourite flags in downloaded snapshots and rejects invalid flags', () => {
    const entries = data();
    entries[0]!.favourite = true;
    const drive = new GoogleDrive(registry);
    expect(drive.parse(snapshot('favourite', [], entries)).entries).toEqual(entries);
    expect(() => drive.parse({ ...snapshot(), entries: [{ ...data()[0], favourite: 'yes' }] })).toThrow('Favourite flag');
  });
  it('detects forks, missing predecessors and cyclic metadata', () => {
    expect(snapshotHeads([file('root'), file('a', ['root']), file('b', ['root'])]).map((value) => value.id)).toEqual(['a', 'b']);
    expect(snapshotHeads([file('root'), file('a', ['root']), file('b', ['root']), file('resolution', ['a', 'b'])]).map((value) => value.id)).toEqual(['resolution']);
    expect(() => snapshotHeads([file('a', ['missing'])])).toThrow('incomplete');
    expect(() => snapshotHeads([file('a', ['b']), file('b', ['a'])])).toThrow('cycle');
    expect(() => lineage({ ...snapshot(), version: 2 })).toThrow('unsupported');
    expect(() => lineage({ ...snapshot(), predecessors: ['a', 'a'] })).toThrow();
  });
  it('paginates only appDataFolder metadata and allocates private-space IDs', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ files: [{ id: 'a', mimeType: 'application/json', appProperties: { passport: 'passport-sync-v1' }, description: JSON.stringify(lineage(snapshot('a'))) }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ files: [], incompleteSearch: false }))
      .mockResolvedValueOnce(json({ ids: ['fixed-id'] }));
    const drive = new GoogleDrive(registry, request);
    expect(await drive.list('token', new AbortController().signal)).toHaveLength(1);
    expect(String(request.mock.calls[0]?.[0])).toContain('spaces=appDataFolder');
    expect(String(request.mock.calls[1]?.[0])).toContain('pageToken=next');
    expect(await drive.allocate('token', new AbortController().signal)).toBe('fixed-id');
    expect(String(request.mock.calls[2]?.[0])).toContain('space=appDataFolder');
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer token');
  });
  it('verifies a fixed-ID upload after 409 and never PATCHes existing snapshots', async () => {
    const value = snapshot();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { errors: [{ reason: 'conflict' }] } }, 409))
      .mockResolvedValueOnce(json(value));
    const drive = new GoogleDrive(registry, request);
    await drive.upload('fixed-id', value, 'token', new AbortController().signal);
    expect(request.mock.calls[0]?.[1]?.method).toBe('POST');
    const body = request.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(Blob);
    expect(await (body as Blob).text()).toContain('"parents":["appDataFolder"]');
    expect(request.mock.calls[1]?.[0]).toContain('/fixed-id?alt=media');
  });
  it.each([401, 403, 429, 503])('surfaces HTTP %s rather than interpreting failure as empty Drive', async (code) => {
    const drive = new GoogleDrive(registry, vi.fn<typeof fetch>().mockResolvedValue(json({ error: { errors: [{ reason: 'denied' }] } }, code)));
    await expect(drive.list('token', new AbortController().signal)).rejects.toMatchObject({ status: code });
  });
  it('rejects incomplete listings, metadata mismatch, invalid statuses and oversized downloads', async () => {
    const signal = new AbortController().signal;
    await expect(new GoogleDrive(registry, vi.fn<typeof fetch>().mockResolvedValue(json({ files: [], incompleteSearch: true }))).list('t', signal)).rejects.toThrow('incomplete');
    await expect(new GoogleDrive(registry, vi.fn<typeof fetch>().mockResolvedValue(json(snapshot()))).read('id', 't', signal, lineage(snapshot('other')))).rejects.toThrow('metadata');
    expect(() => new GoogleDrive(registry).parse({ ...snapshot(), entries: [{ ...data()[0], status: 'bad' }] })).toThrow('status');
    const huge = new Response('x'.repeat(5 * 1024 * 1024 + 1));
    await expect(new GoogleDrive(registry, vi.fn<typeof fetch>().mockResolvedValue(huge)).read('id', 't', signal)).rejects.toThrow('5 MB');
  });
  it('times out stalled requests and leaves their outcome to fixed-ID reconciliation', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const result = new GoogleDrive(registry, request).list('token', new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
  });
});

describe('local-first synchronization', () => {
  it('canonicalizes absent/false equally while retaining true flags and subdivision favourites', () => {
    const entries = data();
    const changed = structuredClone(entries);
    changed[0]!.favourite = false;
    expect(canonicalData(changed)).toBe(canonicalData(entries));
    changed[0]!.favourite = true;
    expect(canonicalData(changed)).not.toBe(canonicalData(entries));
    entries[1]!.subdivisions = [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'unvisited' }];
    const nested = structuredClone(entries);
    nested[1]!.subdivisions![0]!.favourite = true;
    expect(canonicalData(nested)).not.toBe(canonicalData(entries));
  });
  it('automatically saves favourite-only local edits without changing statuses', async () => {
    vi.useFakeTimers();
    const { store, drive, sync } = await linked();
    store.setFavourite('EST', true);
    await vi.advanceTimersByTimeAsync(1100);
    const head = snapshotHeads(await drive.list())[0]!;
    expect((await drive.read(head.id)).entries[0]).toMatchObject({ id: 'EST', favourite: true, status: 'unvisited' });
    expect(drive.uploads).toHaveLength(2);
    expect(sync.state.phase).toBe('synced');
  });
  it('asks about favourite-only remote differences and applies them without upload echo', async () => {
    const { store, drive, sync } = await linked();
    const previous = snapshotHeads(await drive.list())[0]!;
    const remote = data();
    remote[0]!.favourite = true;
    drive.files.set('favourite-device', snapshot('favourite-edit', [previous.id], remote));
    await sync.syncNow();
    expect(sync.state.phase).toBe('conflict');
    expect(store.isFavourite('EST')).toBe(false);
    const uploads = drive.uploads.length;
    await sync.resolve('favourite-device');
    expect(store.isFavourite('EST')).toBe(true);
    expect(store.status('EST')).toBe('unvisited');
    expect(drive.uploads).toHaveLength(uploads);
    expect(sync.state.phase).toBe('synced');
  });
  it('requires explicit first backup, debounces changes, preserves history and signs out without changing the map', async () => {
    vi.useFakeTimers();
    const { sync, store, drive, storage, auth } = fixture();
    await sync.connect();
    expect(sync.state.phase).toBe('conflict');
    expect(drive.files.size).toBe(0);
    await sync.resolve('local');
    store.setStatus('EST', 'visited');
    store.setStatus('USA', 'lived');
    expect(drive.files.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.state.phase).toBe('synced');
    expect(drive.files.size).toBe(2);
    expect(snapshotHeads(await drive.list())).toHaveLength(1);
    expect([...storage.values.values()].join('')).not.toContain('private-test-token');
    const before = store.exportJson();
    sync.signOut();
    expect(store.exportJson()).toBe(before);
    expect(auth.access).toBeUndefined();
    expect(drive.files.size).toBe(2);
  });
  it('asks before remote replacement and applies the chosen version without echo or losing subdivisions', async () => {
    const { sync, store, drive, beforeReplace } = await linked();
    const previous = snapshotHeads(await drive.list())[0]!;
    const remote = data('lived');
    remote[1]!.subdivisions = [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'visited', updatedAt: '2025-01-01T00:00:00Z' }];
    drive.files.set('other-device', snapshot('other', [previous.id], remote));
    await sync.syncNow();
    expect(sync.state.phase).toBe('conflict');
    expect(store.status('EST')).toBe('unvisited');
    const uploads = drive.uploads.length;
    await sync.resolve('other-device');
    expect(store.snapshot()).toEqual(remote);
    expect(beforeReplace).toHaveBeenCalledOnce();
    expect(drive.uploads.length).toBe(uploads);
    expect(sync.state.phase).toBe('synced');
  });
  it('retains both simultaneous first saves and asks about the resulting branch', async () => {
    const drive = new MemoryDrive();
    const a = fixture(drive, new MemoryStorage(), 'same', data('visited'));
    const b = fixture(drive, new MemoryStorage(), 'same', data('lived'));
    await Promise.all([a.sync.connect(), b.sync.connect()]);
    await Promise.all([a.sync.resolve('local'), b.sync.resolve('local')]);
    expect(drive.files.size).toBeGreaterThanOrEqual(2);
    expect([...drive.files.values()].some((value) => value.entries[0]?.status === 'visited')).toBe(true);
    expect([...drive.files.values()].some((value) => value.entries[0]?.status === 'lived')).toBe(true);
    await a.sync.syncNow();
    expect(a.sync.state.phase).toBe('conflict');
    expect(snapshotHeads(await drive.list())).toHaveLength(2);
  });
  it('invalidates a choice after local edits, and cancelling keeps cloud and local data', async () => {
    const context = fixture();
    await context.sync.connect();
    context.store.setStatus('EST', 'visited');
    expect(context.sync.state.phase).toBe('paused');
    await context.sync.resolve('local');
    expect(context.drive.files.size).toBe(0);
    await context.sync.syncNow();
    context.sync.pauseConflict();
    expect(context.store.status('EST')).toBe('visited');
    expect(context.drive.files.size).toBe(0);
  });
  it('confirms a new account, never replays old account pending data and retains the local map', async () => {
    const first = await linked();
    first.auth.access = undefined;
    first.store.setStatus('EST', 'visited');
    expect([...first.storage.values.keys()].some((key) => key.startsWith(PENDING_PREFIX))).toBe(true);
    first.sync.signOut();
    const second = fixture(new MemoryDrive(), first.storage, 'different', first.store.snapshot());
    await second.sync.connect();
    expect(second.sync.state.phase).toBe('conflict');
    expect(second.drive.files.size).toBe(0);
    await second.sync.resolve('local');
    expect([...second.drive.files.values()].every((value) => value.entries[0]?.status === 'visited')).toBe(true);
    expect([...second.storage.values.keys()].some((key) => key.startsWith(PENDING_PREFIX))).toBe(true);
  });
  it('reconciles a committed upload with a lost response using its original ID', async () => {
    const { sync, store, drive } = await linked();
    store.setStatus('EST', 'visited');
    let fail = true;
    drive.beforeUpload = async (id, value) => {
      if (fail) { drive.files.set(id, structuredClone(value)); fail = false; throw new TypeError('Connection lost'); }
    };
    await sync.syncNow();
    expect(sync.state.phase).toBe('error');
    const ids = [...drive.files.keys()];
    await sync.syncNow();
    expect(sync.state.phase).toBe('synced');
    expect([...drive.files.keys()]).toEqual(ids);
  });
  it('does not apply a stale remote choice when an upload races with local edits', async () => {
    const { sync, store, drive } = await linked();
    store.setStatus('EST', 'visited');
    drive.beforeUpload = async () => { store.setStatus('USA', 'lived'); drive.beforeUpload = undefined; };
    await sync.syncNow();
    expect(store.status('EST')).toBe('visited');
    expect(store.status('USA')).toBe('lived');
    expect(sync.state.phase).not.toBe('synced');
  });
  it('automatically follows up edits made during its own upload without a spurious conflict', async () => {
    vi.useFakeTimers();
    const { sync, store, drive } = await linked();
    store.setStatus('EST', 'visited');
    drive.beforeUpload = async () => { store.setStatus('USA', 'lived'); drive.beforeUpload = undefined; };
    await sync.syncNow();
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.state.phase).toBe('synced');
    const head = snapshotHeads(await drive.list())[0]!;
    expect(drive.files.get(head.id)?.entries.find((entry) => entry.id === 'USA')?.status).toBe('lived');
    expect(drive.files.size).toBeGreaterThanOrEqual(3);
  });
  it('preserves concurrent edits from two linked devices and resolves without deleting either branch', async () => {
    const first = await linked();
    const second = fixture(first.drive, new MemoryStorage(), 'account-one');
    await second.sync.connect();
    await second.sync.resolve('local');
    first.store.setStatus('EST', 'visited');
    second.store.setStatus('USA', 'lived');
    await Promise.all([first.sync.syncNow(), second.sync.syncNow()]);
    await first.sync.syncNow();
    expect(first.sync.state.phase).toBe('conflict');
    const before = new Map(first.drive.files);
    await first.sync.resolve('local');
    expect(first.sync.state.phase).toBe('synced');
    for (const [id, value] of before) expect(first.drive.files.get(id)).toEqual(value);
    expect(snapshotHeads(await first.drive.list())).toHaveLength(1);
  });
  it('requires reconnect after expiry and retains edits as account-owned pending data', async () => {
    vi.useFakeTimers();
    const { sync, store, auth, storage } = await linked();
    await vi.advanceTimersByTimeAsync(3570000);
    expect(sync.state.phase).toBe('reconnect');
    expect(auth.access).toBeUndefined();
    store.setStatus('EST', 'visited');
    expect([...storage.values.keys()].some((key) => key.startsWith(PENDING_PREFIX))).toBe(true);
    await sync.connect();
    expect(sync.state.phase).toBe('conflict');
    await sync.resolve('local');
    expect(sync.state.phase).toBe('synced');
    expect(store.status('EST')).toBe('visited');
  });
  it('does not write an old account link back over another tab changing accounts', async () => {
    const { sync, storage, auth } = await linked();
    const changed = JSON.stringify({ version: 1, owner: 'other', linked: true, heads: [], baseline: '[]' });
    storage.setItem(LINK_KEY, changed);
    sync.storageChanged({ key: LINK_KEY, newValue: changed });
    expect(auth.access).toBeUndefined();
    expect(storage.getItem(LINK_KEY)).toBe(changed);
  });
  it('stops on cross-tab sign-out and pauses for cross-tab map changes', async () => {
    const { sync, auth, store } = await linked();
    sync.storageChanged({ key: 'passport:locations:v1', newValue: 'different' });
    expect(sync.state.phase).toBe('paused');
    const before = store.exportJson();
    sync.storageChanged({ key: DISCONNECT_KEY, newValue: '"logout"' });
    expect(auth.access).toBeUndefined();
    expect(store.exportJson()).toBe(before);
    expect(sync.state.phase).toBe('local');
  });
  it('surfaces pending-storage failure separately and never stores access tokens', async () => {
    const { sync, storage, store } = await linked();
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    store.setStatus('EST', 'visited');
    expect(sync.state.warning).toContain('could not be saved');
    await sync.syncNow();
    expect(sync.state.warning).toContain('export a backup');
    expect(store.status('EST')).toBe('visited');
    expect([...storage.values.values()].join('')).not.toContain('private-test-token');
  });
  it('retains in-memory pending backups across reconnect even when browser writes fail', async () => {
    const { sync, storage, store, drive } = await linked();
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
    store.setStatus('EST', 'visited');
    sync.signOut();
    store.setStatus('EST', 'lived');
    await sync.connect();
    await sync.resolve('local');
    expect(sync.state.phase).toBe('synced');
    expect([...drive.files.values()].some((value) => value.entries[0]?.status === 'visited')).toBe(true);
    expect([...drive.files.values()].some((value) => value.entries[0]?.status === 'lived')).toBe(true);
  });
  it('honors a server Retry-After longer than the normal bounded exponential delay', async () => {
    vi.useFakeTimers();
    const { sync, drive } = await linked();
    const list = vi.spyOn(drive, 'list').mockRejectedValueOnce(new DriveError(429, '', 300000));
    await sync.syncNow();
    await vi.advanceTimersByTimeAsync(299000);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(sync.state.phase).toBe('synced');
  });
  it('reports when unavailable storage prevents notifying other tabs of sign-out', async () => {
    const { sync, storage, auth } = await linked();
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
    sync.signOut();
    expect(auth.access).toBeUndefined();
    expect(sync.state.warning).toContain('other tabs could not be notified');
  });
  it('recognizes key/subdivision ordering without ignoring meaningful timestamps', () => {
    const entries = data();
    entries[1]!.subdivisions = [
      { id: 'US-CA', name: 'California', continent: 'North America', status: 'visited' },
      { id: 'US-NY', name: 'New York', continent: 'North America', status: 'lived' },
    ];
    const reordered = structuredClone(entries).reverse();
    reordered[0]!.subdivisions!.reverse();
    expect(canonicalData(entries)).toBe(canonicalData(reordered));
    reordered[0]!.updatedAt = '2026-01-01T00:00:00Z';
    expect(canonicalData(entries)).not.toBe(canonicalData(reordered));
  });
  it('restores an honest reconnect state from metadata without starting Google', async () => {
    const { storage, store } = await linked();
    expect(storage.getItem(LINK_KEY)).toBeTruthy();
    const restored = fixture(new MemoryDrive(), storage, 'account-one', store.snapshot());
    expect(restored.sync.state.phase).toBe('reconnect');
    expect(restored.auth.access).toBeUndefined();
    expect(restored.drive.files.size).toBe(0);
  });
});
