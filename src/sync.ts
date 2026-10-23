import { GoogleAuth, type GoogleAccount } from './google-auth';
import { DriveError, GoogleDrive, snapshotHeads, type PendingSnapshot, type SnapshotFile } from './google-drive';
import { STORAGE_KEY, TravelStore } from './store';
import { errorMessage, type LocationEntry } from './types';

export const LINK_KEY = 'passport:drive:link:v1';
export const PENDING_PREFIX = 'passport:drive:pending:v1:';
export const DISCONNECT_KEY = 'passport:drive:disconnect:v1';
interface Link { version: 1; owner: string; linked: boolean; heads: string[]; baseline: string; lastSync?: string }
export interface SyncOption { key: string; label: string; entries: LocationEntry[] }
export interface SyncConflict { generation: number; known: string[]; options: SyncOption[]; message: string }
export interface SyncState {
  phase: 'local' | 'preparing' | 'ready' | 'connecting' | 'checking' | 'pending' | 'syncing' | 'synced' | 'reconnect' | 'conflict' | 'paused' | 'error';
  message: string;
  account?: GoogleAccount;
  conflict?: SyncConflict;
  lastSync?: string;
  warning?: string;
}

export function canonicalData(entries: readonly LocationEntry[]): string {
  const ordered = (items: readonly LocationEntry[]): LocationEntry[] => [...items].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => {
    const value: LocationEntry = { id: entry.id, name: entry.name, continent: entry.continent, status: entry.status };
    if (entry.favourite === true) value.favourite = true;
    if (entry.updatedAt !== undefined) value.updatedAt = entry.updatedAt;
    if (entry.subdivisions !== undefined) value.subdivisions = ordered(entry.subdivisions);
    return value;
  });
  return JSON.stringify(ordered(entries));
}
const DRIVE_ID = /^[\w-]{1,200}$/;
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function parseLink(text: string): Link {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || typeof value.owner !== 'string'
    || typeof value.linked !== 'boolean' || typeof value.baseline !== 'string' || !Array.isArray(value.heads)
    || !value.heads.every((id: unknown) => typeof id === 'string' && DRIVE_ID.test(id))
    || (value.lastSync !== undefined && typeof value.lastSync !== 'string')) throw new Error('Invalid saved Google sync settings.');
  return { version: 1, owner: value.owner, linked: value.linked, heads: value.heads, baseline: value.baseline,
    ...(typeof value.lastSync === 'string' ? { lastSync: value.lastSync } : {}) };
}

/**
 * Local-first Google Drive synchronization.
 *
 * Flow: store edits bump `revision` and `schedule()` a debounced `check()`.
 * `check()` lists immutable Drive snapshots, compares their heads with the
 * local map and the accepted `link.baseline`, then either records a baseline,
 * `commit()`s a new snapshot (persisted to `pending` first so retries reuse the
 * same file ID), or pauses with a `choice()` the user resolves via `resolve()`.
 *
 * Guards: `generation` changes on connect/sign-out/account switch and makes
 * stale async completions no-ops; `revision` detects edits made while a job
 * was in flight (the job is re-queued instead of acknowledging older data);
 * `running`/`queued` serialize jobs within this controller.
 */
export class DriveSync {
  state: SyncState = { phase: 'local', message: 'Local only. Google Drive sync is optional.' };
  private listeners = new Set<(state: SyncState) => void>();
  private link: Link | undefined;
  private pending = new Map<string, PendingSnapshot>();
  private completed = new Set<string>();
  private source = crypto.randomUUID();
  private draft: string | undefined;
  private generation = 0;
  private revision = 0;
  private abort = new AbortController();
  private running = false;
  private queued = false;
  private paused = false;
  private initial = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private storageWarning: string | undefined;
  private unsubscribe: () => void;

  constructor(
    readonly auth: GoogleAuth,
    private drive: GoogleDrive,
    private store: TravelStore,
    private storage: Storage | undefined,
    private beforeReplace: () => void,
  ) {
    try {
      const saved = storage?.getItem(LINK_KEY);
      if (saved) {
        this.link = parseLink(saved);
        if (this.link.linked) this.state = { phase: 'reconnect', message: 'Reconnect Google to resume sync. Your map remains on this device.' };
      }
    } catch (error) { this.state = { phase: 'error', message: `Sync settings could not be read. Reconnect to reconcile. ${errorMessage(error)}` }; }
    this.unsubscribe = store.subscribe((origin) => {
      this.revision++;
      if (origin === 'remote') return;
      if (this.link?.linked && (!auth.access || auth.access.account.sub === this.link.owner)) this.capture();
      if (this.state.conflict) {
        this.paused = true;
        this.publish('paused', 'Your map changed while choosing a version. Check again before resolving.');
      } else if (this.link?.linked && !this.paused) this.schedule();
    });
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private publish(phase: SyncState['phase'], message: string, conflict?: SyncConflict): void {
    this.state = { phase, message, ...(this.auth.access ? { account: this.auth.access.account } : {}),
      ...(conflict ? { conflict } : {}), ...(this.link?.lastSync ? { lastSync: this.link.lastSync } : {}),
      ...(this.storageWarning ? { warning: this.storageWarning } : {}) };
    this.listeners.forEach((listener) => listener(this.state));
  }
  private persist(key: string, value: unknown): void {
    try {
      if (!this.storage) throw new Error('Browser storage is unavailable.');
      this.storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      this.storageWarning = key === DISCONNECT_KEY
        ? `This tab is signed out, but other tabs could not be notified. Sign out in those tabs too; export a backup before closing. ${errorMessage(error)}`
        : `Cloud recovery information could not be saved locally. Keep this tab open or export a backup. ${errorMessage(error)}`;
    }
  }
  private removePending(operationId: string): void {
    this.completed.add(operationId);
    try {
      if (this.storage) this.storage.removeItem(PENDING_PREFIX + operationId);
      this.pending.delete(operationId);
    } catch (error) {
      this.storageWarning = `A saved pending operation could not be cleared. It will be reconciled on reconnect. ${errorMessage(error)}`;
      this.pending.delete(operationId);
    }
    if (this.draft === operationId) this.draft = undefined;
  }
  private make(entries: LocationEntry[], predecessors: string[], owner: string): PendingSnapshot {
    return { owner, source: this.source, snapshot: {
      version: 1, operationId: crypto.randomUUID(), predecessors: [...predecessors], createdAt: new Date().toISOString(), entries,
    } };
  }
  private remember(pending: PendingSnapshot): void {
    this.pending.set(pending.snapshot.operationId, pending);
    this.persist(PENDING_PREFIX + pending.snapshot.operationId, pending);
  }
  private capture(): void {
    if (!this.link) return;
    const previous = this.draft ? this.pending.get(this.draft) : undefined;
    if (previous && !previous.fileId) {
      previous.snapshot.entries = this.store.snapshot();
      this.remember(previous);
    } else {
      const pending = this.make(this.store.snapshot(), this.link.heads, this.link.owner);
      this.draft = pending.snapshot.operationId;
      this.remember(pending);
    }
  }
  /**
   * Loads pending snapshots saved by this or other tabs. This controller's own in-memory
   * entries are never replaced (they may be newer than storage if a write failed), entries this controller
   * already completed are not resurrected, and unreadable entries are skipped with a
   * warning instead of blocking synchronization for every account.
   */
  private restorePending(owner: string): void {
    if (!this.storage) return;
    let skipped = 0;
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(PENDING_PREFIX)) continue;
      const id = key.slice(PENDING_PREFIX.length);
      if (this.pending.get(id)?.source === this.source || this.completed.has(id)) continue;
      try {
        const raw = this.storage.getItem(key);
        if (!raw || raw.length > 6 * 1024 * 1024) throw new Error('Unreadable pending Drive backup.');
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value) || typeof value.owner !== 'string' || typeof value.source !== 'string') throw new Error('Invalid pending Drive backup.');
        if (value.owner !== owner) continue;
        if (value.fileId !== undefined && (typeof value.fileId !== 'string' || !DRIVE_ID.test(value.fileId))) throw new Error('Invalid pending Drive file ID.');
        const snapshot = this.drive.parse(value.snapshot);
        if (id !== snapshot.operationId) throw new Error('Pending Drive backup identifier mismatch.');
        this.pending.set(snapshot.operationId, { owner, source: value.source, snapshot,
          ...(typeof value.fileId === 'string' ? { fileId: value.fileId } : {}) });
      } catch { skipped++; }
    }
    if (skipped) this.storageWarning = `${skipped} saved pending Drive backup${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped. Export your map if you expected unsynced changes.`;
  }
  async prepare(): Promise<void> {
    const generation = this.generation;
    this.publish('preparing', 'Loading Google sign-in...');
    try {
      await this.auth.prepare();
      if (generation === this.generation) this.publish('ready', 'Google is ready. Continue to choose an account and grant private Drive access.');
    } catch (error) { if (generation === this.generation) this.publish('error', errorMessage(error)); }
  }
  async connect(): Promise<void> {
    this.cancelWork();
    const generation = this.generation;
    this.publish('connecting', 'Choose your Google account and allow private Drive app-data access.');
    try {
      const access = await this.auth.authorize();
      if (generation !== this.generation) return;
      this.draft = undefined;
      this.restorePending(access.account.sub);
      this.initial = true;
      this.paused = false;
      this.expiryTimer = setTimeout(() => {
        this.cancelWork();
        this.auth.disconnect();
        this.publish('reconnect', 'Google access expired. Your edits stay local; reconnect to resume sync.');
      }, Math.max(0, access.expiresAt - Date.now() - 30000));
      await this.check();
    } catch (error) { if (generation === this.generation) this.publish('error', errorMessage(error)); }
  }
  private cancelWork(): void {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.expiryTimer);
    this.abort.abort();
    this.abort = new AbortController();
    this.running = false;
    this.queued = false;
  }
  signOut(broadcast = true): void {
    this.cancelWork();
    this.auth.disconnect();
    this.paused = true;
    if (this.link) {
      this.link.linked = false;
      if (broadcast) this.persist(LINK_KEY, this.link);
    }
    if (broadcast) this.persist(DISCONNECT_KEY, crypto.randomUUID());
    this.publish('local', 'Signed out of passport. Your map remains on this device; Drive data and Google permissions were not deleted.');
  }
  storageChanged(event: Pick<StorageEvent, 'key' | 'newValue'>): void {
    if (event.key === DISCONNECT_KEY) { this.signOut(false); return; }
    if (!this.auth.access) return;
    if (event.key === LINK_KEY && event.newValue) {
      try {
        const other = parseLink(event.newValue);
        if (other.owner !== this.auth.access.account.sub || !other.linked) { this.signOut(false); return; }
      } catch (error) { this.paused = true; this.publish('error', `Another tab changed sync settings. ${errorMessage(error)}`); return; }
    }
    if ((event.key === STORAGE_KEY && event.newValue !== this.store.exportJson())
      || event.key === LINK_KEY || event.key?.startsWith(PENDING_PREFIX)) {
      this.cancelWork();
      this.paused = true;
      this.publish('paused', 'Another tab changed local data or sync history. Sync now to compare versions before saving.');
    }
  }
  private schedule(delay = 1000): void {
    if (this.paused) return;
    clearTimeout(this.timer);
    if (!this.auth.valid) { this.publish('reconnect', 'Changes are local. Reconnect Google to sync them.'); return; }
    this.publish('pending', 'Changes pending; waiting to sync to Google Drive.');
    this.timer = setTimeout(() => { void this.check(); }, delay);
  }
  async syncNow(): Promise<void> {
    clearTimeout(this.timer);
    this.paused = false;
    this.retries = 0;
    await this.check();
  }
  resume(): void { if (!this.paused && this.auth.valid) void this.check(); }
  pauseConflict(): void {
    this.paused = true;
    this.publish('paused', 'Sync paused. Both versions are retained. Use Sync now when ready to choose.');
  }
  private token(): string {
    if (!this.auth.valid || !this.auth.access) throw new DriveError(401, '', 0);
    return this.auth.access.token;
  }
  private choice(files: SnapshotFile[], options: SyncOption[], message: string): void {
    this.paused = true;
    this.publish('conflict', message, { known: files.map((file) => file.id), generation: this.revision, options, message });
  }
  private baseline(files: SnapshotFile[]): void {
    const owner = this.auth.access!.account.sub;
    this.link = { version: 1, owner, linked: true, heads: snapshotHeads(files).map((file) => file.id),
      baseline: canonicalData(this.store.snapshot()), lastSync: new Date().toISOString() };
    this.persist(LINK_KEY, this.link);
    this.initial = false;
    this.retries = 0;
    this.publish('synced', 'Synced with Google Drive.');
  }

  async check(): Promise<void> {
    if (this.paused) return;
    if (!this.auth.valid) { this.publish('reconnect', 'Reconnect Google to compare and sync your locally saved map.'); return; }
    if (this.running) { this.queued = true; return; }
    this.running = true;
    const generation = this.generation;
    const revision = this.revision;
    const signal = this.abort.signal;
    this.publish('checking', 'Checking Google Drive before saving...');
    try {
      const token = this.token();
      this.restorePending(this.auth.access!.account.sub);
      const files = await this.drive.list(token, signal);
      const heads = snapshotHeads(files);
      const remote: SyncOption[] = [];
      for (const head of heads) {
        const snapshot = await this.drive.read(head.id, token, signal, head);
        remote.push({ key: head.id, label: `Google Drive version saved ${snapshot.createdAt}`, entries: snapshot.entries });
      }
      if (generation !== this.generation) return;
      if (revision !== this.revision) { this.queued = true; return; }
      const entries = this.store.snapshot();
      const current = canonicalData(entries);
      const pending = [...this.pending.values()].filter((item) => item.owner === this.auth.access!.account.sub);
      const alternatives = pending.filter((item) => item.source !== this.source
        && canonicalData(item.snapshot.entries) !== current
        && !remote.some((option) => canonicalData(option.entries) === canonicalData(item.snapshot.entries)));
      const mustLink = !this.link?.linked || this.link.owner !== this.auth.access!.account.sub;
      const remoteSame = remote.length > 0 && remote.every((option) => canonicalData(option.entries) === current);
      const baselineSame = remote.length > 0 && remote.every((option) => canonicalData(option.entries) === this.link?.baseline);
      if (mustLink || !remote.length || alternatives.length || (!remoteSame && (this.initial || !baselineSame))) {
        this.choice(files, [
          { key: 'local', label: remote.length ? 'Use this device' : 'Back up this device to Google Drive', entries },
          ...remote,
          ...alternatives.map((item) => ({ key: item.snapshot.operationId, label: `Unsynced device version saved ${item.snapshot.createdAt}`, entries: item.snapshot.entries })),
        ], !remote.length ? 'No Drive history was found. Confirm before backing up this map to this Google account.'
          : mustLink ? 'Confirm which map to use with this Google account. Your device map is never linked to a different account automatically.'
            : 'Device and Google Drive versions differ. Choose a version; previous snapshots are retained.');
        return;
      }
      if (remoteSame && !pending.length) this.baseline(files);
      else await this.commit(entries, files, generation, revision, false);
    } catch (error) { if (generation === this.generation) this.failed(error); }
    finally {
      if (generation === this.generation) {
        this.running = false;
        if (this.queued && !this.paused) { this.queued = false; this.schedule(); }
      }
    }
  }

  async resolve(key: string): Promise<void> {
    const conflict = this.state.conflict;
    const selected = conflict?.options.find((option) => option.key === key);
    if (!conflict || !selected) return;
    if (conflict.generation !== this.revision) { this.pauseConflict(); return; }
    if (this.running) return;
    this.paused = false;
    this.running = true;
    const generation = this.generation;
    this.publish('checking', 'Checking that your version choice is still current...');
    try {
      const files = await this.drive.list(this.token(), this.abort.signal);
      if (generation !== this.generation) return;
      if (conflict.generation !== this.revision || files.some((file) => !conflict.known.includes(file.id))
        || conflict.known.some((id) => !files.some((file) => file.id === id))) {
        this.running = false;
        await this.check();
        return;
      }
      await this.commit(selected.entries, files, generation, conflict.generation, true);
    } catch (error) { if (generation === this.generation) this.failed(error); }
    finally {
      if (generation === this.generation) {
        this.running = false;
        if (this.queued && !this.paused) { this.queued = false; this.schedule(); }
      }
    }
  }

  private async commit(entries: LocationEntry[], files: SnapshotFile[], generation: number, revision: number, explicit: boolean): Promise<void> {
    this.publish('syncing', 'Saving a private versioned snapshot to Google Drive...');
    const owner = this.auth.access!.account.sub;
    const token = this.token();
    const signal = this.abort.signal;
    const known = new Set(files.map((file) => file.id));
    let current = files;
    const operations = [...this.pending.values()].filter((pending) => pending.owner === owner);
    const uploaded: string[] = [];
    for (const pending of operations) {
      if (generation !== this.generation) return;
      let item = pending;
      if (item.snapshot.predecessors.some((id) => !known.has(id))) {
        if (!explicit) throw new Error('Drive history changed. Sync now and explicitly choose a recovery version.');
        item = this.make(item.snapshot.entries, [], owner);
        this.remember(item);
      }
      if (!item.fileId) {
        item.fileId = await this.drive.allocate(token, signal);
        if (generation !== this.generation) return;
        this.remember(item);
      }
      await this.drive.upload(item.fileId, item.snapshot, token, signal);
      if (generation !== this.generation) return;
      uploaded.push(item.fileId);
      known.add(item.fileId);
      if (item !== pending) this.removePending(item.snapshot.operationId);
      this.removePending(pending.snapshot.operationId);
    }
    current = await this.drive.list(token, signal);
    if (generation !== this.generation) return;
    if (current.some((file) => !known.has(file.id)) || files.some((file) => !current.some((other) => other.id === file.id))) {
      this.initial = true;
      this.queued = true;
      return;
    }
    if (revision !== this.revision) {
      if (!explicit && this.link?.owner === owner && snapshotHeads(current).length === 1) {
        const head = snapshotHeads(current)[0]!;
        const accepted = await this.drive.read(head.id, token, signal, head);
        if (generation !== this.generation) return;
        this.link.heads = [head.id];
        this.link.baseline = canonicalData(accepted.entries);
        const draft = this.draft ? this.pending.get(this.draft) : undefined;
        if (draft && !draft.fileId && draft.source === this.source) {
          draft.snapshot.predecessors = [head.id];
          this.remember(draft);
        }
        this.persist(LINK_KEY, this.link);
      } else this.initial = true;
      this.queued = true;
      return;
    }
    const heads = snapshotHeads(current);
    let needsSnapshot = heads.length !== 1;
    if (heads.length === 1) {
      const latest = await this.drive.read(heads[0]!.id, token, signal, heads[0]);
      needsSnapshot = canonicalData(latest.entries) !== canonicalData(entries);
    }
    if (needsSnapshot) {
      const final = this.make(entries, heads.map((head) => head.id), owner);
      final.fileId = await this.drive.allocate(token, signal);
      if (generation !== this.generation || revision !== this.revision) { this.queued = true; return; }
      this.remember(final);
      await this.drive.upload(final.fileId, final.snapshot, token, signal);
      if (generation !== this.generation) return;
      uploaded.push(final.fileId);
      this.removePending(final.snapshot.operationId);
      current = await this.drive.list(token, signal);
      if (generation !== this.generation) return;
      const expected = new Set([...known, final.fileId]);
      if (current.some((file) => !expected.has(file.id)) || !current.some((file) => file.id === final.fileId)) {
        this.initial = true; this.queued = true; return;
      }
    }
    if (generation !== this.generation) return;
    if (revision !== this.revision) { this.initial = true; this.queued = true; return; }
    if (uploaded.some((id) => !current.some((file) => file.id === id))) throw new Error('Drive has not confirmed the complete upload history yet. Retry to reconcile; your map is unchanged.');
    if (canonicalData(this.store.snapshot()) !== canonicalData(entries)) {
      this.beforeReplace();
      this.store.replace(entries, 'remote');
    }
    this.baseline(current);
  }
  private failed(error: unknown): void {
    if (error instanceof DriveError && error.status === 401) {
      this.auth.disconnect();
      this.publish('reconnect', error.message);
      return;
    }
    this.publish('error', `${errorMessage(error)} Your map remains available locally.`);
    const transient = error instanceof DriveError ? error.transient
      : error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
    if (transient && this.retries < 3) {
      const backoff = Math.min(120000, 2000 * 2 ** this.retries);
      const delay = Math.min(2147483647, Math.max(error instanceof DriveError ? error.retryAfter : 0, backoff));
      this.retries++;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.check(); }, delay);
    }
  }
  dispose(): void { this.cancelWork(); this.auth.disconnect(); this.unsubscribe(); this.listeners.clear(); }
}
