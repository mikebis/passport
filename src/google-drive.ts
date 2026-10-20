import { normalizeData } from './store';
import type { LocationEntry, Territory } from './types';

const MARKER = 'passport-sync-v1';
const MAX_BYTES = 5 * 1024 * 1024;
const API = 'https://www.googleapis.com/drive/v3/files';
export interface Lineage {
  version: 1;
  operationId: string;
  predecessors: string[];
  createdAt: string;
}
export interface Snapshot extends Lineage { entries: LocationEntry[] }
export interface SnapshotFile extends Lineage { id: string }
export interface PendingSnapshot { owner: string; source: string; fileId?: string; snapshot: Snapshot }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function lineage(value: unknown): Lineage {
  if (!record(value) || value.version !== 1 || typeof value.operationId !== 'string'
    || !/^[\w-]{1,100}$/.test(value.operationId) || !Array.isArray(value.predecessors)
    || value.predecessors.length > 100
    || !value.predecessors.every((id: unknown) => typeof id === 'string' && /^[\w-]{1,200}$/.test(id))
    || new Set(value.predecessors).size !== value.predecessors.length
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Invalid or unsupported Drive snapshot metadata. Existing data has not been replaced.');
  }
  return { version: 1, operationId: value.operationId, predecessors: [...value.predecessors], createdAt: value.createdAt };
}

export function snapshotHeads(files: readonly SnapshotFile[]): SnapshotFile[] {
  const known = new Map(files.map((file) => [file.id, file]));
  if (known.size !== files.length) throw new Error('Drive returned duplicate snapshot IDs.');
  const referenced = new Set<string>();
  const children = new Map<string, string[]>();
  const remaining = new Map<string, number>();
  for (const file of files) {
    remaining.set(file.id, file.predecessors.length);
    for (const parent of file.predecessors) {
      if (!known.has(parent)) throw new Error('Drive history is incomplete. A predecessor snapshot is missing; export your local data before recovery.');
      referenced.add(parent);
      const list = children.get(parent) ?? [];
      list.push(file.id);
      children.set(parent, list);
    }
  }
  const ready = files.filter((file) => !file.predecessors.length).map((file) => file.id);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const child of children.get(ready[index]!) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (!count) ready.push(child);
    }
  }
  if (visited !== files.length) throw new Error('Drive snapshot history contains a cycle.');
  return files.filter((file) => !referenced.has(file.id));
}

export class DriveError extends Error {
  constructor(readonly status: number, readonly reason: string, readonly retryAfter: number) {
    super(status === 401 ? 'Google access expired. Reconnect to resume sync.'
      : status === 403 ? `Drive access denied (${reason}). Check permissions, Drive API setup or quota.`
        : status === 429 ? 'Google Drive rate limit reached. Retry shortly.'
          : `Google Drive request failed (${status}${reason ? `: ${reason}` : ''}).`);
  }
  get transient(): boolean { return this.status === 429 || this.status >= 500 || ['rateLimitExceeded', 'userRateLimitExceeded'].includes(this.reason); }
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Google Drive returned no readable content.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Drive data exceeds the 5 MB limit.'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export class GoogleDrive {
  constructor(private registry: readonly Territory[], private request: typeof fetch = (input, init) => fetch(input, init)) {}

  parse(value: unknown): Snapshot {
    const metadata = lineage(value);
    if (!record(value)) throw new Error('Invalid Drive snapshot.');
    return { ...metadata, entries: normalizeData(value.entries, this.registry) };
  }

  private async call(url: string, token: string, signal: AbortSignal, init: RequestInit = {}): Promise<string> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const cancel = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new DOMException('Google Drive timed out. Retry to reconcile your saved versions.', 'TimeoutError')), 30000);
    try {
      const response = await this.request(url, { ...init, headers, signal: controller.signal, cache: 'no-store' });
      const text = await boundedText(response);
      if (response.ok) return text;
      let reason = '';
      try {
        const value: unknown = JSON.parse(text);
        if (record(value) && record(value.error) && Array.isArray(value.error.errors)) {
          const first: unknown = value.error.errors[0];
          if (record(first) && typeof first.reason === 'string') reason = first.reason;
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        reason = 'unreadable error response';
      }
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 0;
      throw new DriveError(response.status, reason, Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0);
    } catch (error) {
      if (controller.signal.aborted && !signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  async list(token: string, signal: AbortSignal): Promise<SnapshotFile[]> {
    const files: SnapshotFile[] = [];
    const pages = new Set<string>();
    let pageToken = '';
    do {
      const query = new URLSearchParams({
        spaces: 'appDataFolder', q: `appProperties has { key='passport' and value='${MARKER}' }`,
        pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,description,mimeType,appProperties)',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const value: unknown = JSON.parse(await this.call(`${API}?${query}`, token, signal));
      if (!record(value) || !Array.isArray(value.files) || value.incompleteSearch === true) throw new Error('Google Drive returned an incomplete file listing.');
      for (const file of value.files) {
        if (!record(file) || typeof file.id !== 'string' || !/^[\w-]{1,200}$/.test(file.id)
          || typeof file.description !== 'string' || file.description.length > 16000
          || file.mimeType !== 'application/json' || !record(file.appProperties) || file.appProperties.passport !== MARKER) {
          throw new Error('Invalid Google Drive snapshot file metadata.');
        }
        files.push({ ...lineage(JSON.parse(file.description)), id: file.id });
        if (files.length > 10000) throw new Error('Drive snapshot history exceeds 10,000 files. Export a backup before managing app storage.');
      }
      if (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string') throw new Error('Invalid Drive pagination token.');
      pageToken = typeof value.nextPageToken === 'string' ? value.nextPageToken : '';
      if (pageToken && pages.has(pageToken)) throw new Error('Google Drive repeated a pagination token.');
      pages.add(pageToken);
    } while (pageToken);
    snapshotHeads(files);
    return files;
  }

  async read(id: string, token: string, signal: AbortSignal, expected?: Lineage): Promise<Snapshot> {
    const text = await this.call(`${API}/${encodeURIComponent(id)}?alt=media`, token, signal);
    const snapshot = this.parse(JSON.parse(text));
    if (expected && JSON.stringify(lineage(snapshot)) !== JSON.stringify(lineage(expected))) {
      throw new Error('Drive snapshot contents do not match their metadata.');
    }
    return snapshot;
  }

  async allocate(token: string, signal: AbortSignal): Promise<string> {
    const value: unknown = JSON.parse(await this.call(`${API}/generateIds?count=1&space=appDataFolder&type=files`, token, signal));
    if (!record(value) || !Array.isArray(value.ids) || value.ids.length !== 1
      || typeof value.ids[0] !== 'string' || !/^[\w-]{1,200}$/.test(value.ids[0])) throw new Error('Google Drive did not allocate a valid file ID.');
    return value.ids[0];
  }

  async upload(id: string, snapshot: Snapshot, token: string, signal: AbortSignal): Promise<void> {
    const metadata = {
      id, name: `passport-${snapshot.operationId}.json`, mimeType: 'application/json',
      parents: ['appDataFolder'], appProperties: { passport: MARKER }, description: JSON.stringify(lineage(snapshot)),
    };
    if (metadata.description.length > 16000) throw new Error('Too many concurrent Drive versions. Export backups before resolving history.');
    const text = JSON.stringify(snapshot);
    if (new Blob([text]).size > MAX_BYTES) throw new Error('Drive data exceeds the 5 MB limit. Export a backup.');
    const boundary = `passport_${snapshot.operationId}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`,
    ]);
    try {
      await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', token, signal, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
    } catch (error) {
      if (!(error instanceof DriveError) || error.status !== 409) throw error;
    }
    const actual = await this.read(id, token, signal, snapshot);
    if (JSON.stringify(actual) !== JSON.stringify(snapshot)) throw new Error('A Drive file ID contains different data. Sync paused; no file was overwritten.');
  }
}
