import { GoogleAuth } from './google-auth';
import { GoogleDrive } from './google-drive';
import { DriveSync, type SyncConflict } from './sync';
import type { TravelStore } from './store';
import type { Territory } from './types';
import { downloadText, uniqueId } from './dom';

export function createGoogleSync(
  host: HTMLElement, store: TravelStore, registry: readonly Territory[], storage: Storage | undefined, beforeReplace: () => void,
  focusFallback: () => void,
): () => void {
  const auth = new GoogleAuth();
  const sync = new DriveSync(auth, new GoogleDrive(registry), store, storage, beforeReplace);
  const section = document.createElement('section');
  section.className = 'google-sync save-export-group';
  const heading = document.createElement('h3');
  heading.id = uniqueId('google-sync-heading');
  heading.textContent = 'Google Drive sync';
  section.setAttribute('aria-labelledby', heading.id);
  const panel = document.createElement('div');
  panel.className = 'google-sync-panel';
  const account = document.createElement('p');
  account.className = 'google-account';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.className = 'google-sync-status';
  const warning = document.createElement('p');
  warning.className = 'google-sync-warning';
  const last = document.createElement('p');
  last.className = 'google-sync-last';
  const controls = document.createElement('div');
  controls.className = 'data-actions';
  const connect = document.createElement('button');
  connect.className = 'button secondary';
  const retry = document.createElement('button');
  retry.className = 'button secondary';
  retry.textContent = 'Sync now';
  const signOut = document.createElement('button');
  signOut.className = 'button secondary';
  signOut.textContent = 'Sign out';
  const privacy = document.createElement('p');
  privacy.className = 'google-sync-last';
  privacy.textContent = 'Optional. Only private app-data access; no access to your other Drive files. Signing out keeps this map on your device.';
  controls.append(connect, retry, signOut);
  panel.append(account, status, warning, last, controls, privacy);
  section.append(heading, panel);
  host.append(section);
  let prepared = false;
  let dialog: HTMLDialogElement | undefined;
  let displayed: SyncConflict | undefined;
  const focusRetry = (): void => {
    if (retry.checkVisibility()) retry.focus();
    else focusFallback();
  };

  const closeDialog = (): void => {
    if (dialog) { dialog.close(); dialog.remove(); dialog = undefined; }
  };
  function showConflict(conflict: SyncConflict): void {
    displayed = conflict;
    closeDialog();
    const modal = document.createElement('dialog');
    dialog = modal;
    modal.className = 'confirmation-dialog sync-conflict';
    const heading = document.createElement('h2');
    heading.id = uniqueId('sync-conflict-heading');
    heading.textContent = 'Choose your travel map';
    const message = document.createElement('p');
    message.id = uniqueId('sync-conflict-message');
    message.textContent = `${conflict.message} Account: ${sync.state.account?.email ?? 'your selected Google account'}.`;
    const options = document.createElement('div');
    options.className = 'sync-versions';
    for (const option of conflict.options) {
      const row = document.createElement('div');
      row.className = 'sync-version';
      const choose = document.createElement('button');
      choose.className = 'button primary';
      choose.textContent = option.label;
      choose.addEventListener('click', () => { closeDialog(); void sync.resolve(option.key); });
      const description = document.createElement('p');
      const { statuses: changed, favourites } = store.differences(option.entries);
      description.textContent = `${changed} place statuses and ${favourites} favourite flags differ from the current map. Timestamps and subdivisions are also preserved.`;
      const backup = document.createElement('button');
      backup.className = 'text-button';
      backup.textContent = 'Download this version';
      backup.setAttribute('aria-label', `Download ${option.label}`);
      backup.addEventListener('click', () => downloadText(JSON.stringify(option.entries, null, 2) + '\n', 'passport-sync-backup.json'));
      row.append(choose, description, backup);
      options.append(row);
    }
    const cancel = document.createElement('button');
    cancel.className = 'button secondary';
    cancel.textContent = 'Cancel and pause sync';
    cancel.addEventListener('click', () => { closeDialog(); sync.pauseConflict(); focusRetry(); });
    modal.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); sync.pauseConflict(); focusRetry(); });
    modal.setAttribute('aria-labelledby', heading.id);
    modal.setAttribute('aria-describedby', message.id);
    modal.append(heading, message, options, cancel);
    document.body.append(modal);
    modal.showModal();
    cancel.focus();
  }

  connect.addEventListener('click', () => {
    if (prepared) void sync.connect();
    else void sync.prepare();
  });
  retry.addEventListener('click', () => { displayed = undefined; void sync.syncNow(); });
  signOut.addEventListener('click', () => sync.signOut());
  const unsubscribe = sync.subscribe((state) => {
    if (state.phase === 'ready') prepared = true;
    host.dataset.syncPhase = state.phase;
    account.textContent = state.account ? `Connected account: ${state.account.email ?? 'Google account'}` : '';
    account.hidden = !state.account;
    status.textContent = auth.configured ? state.message
      : 'Google sync is not configured. Set the public VITE_GOOGLE_CLIENT_ID to enable it. Local use is fully available.';
    warning.hidden = !state.warning;
    warning.textContent = state.warning ?? '';
    last.hidden = !state.lastSync;
    last.textContent = state.lastSync ? `Last synced: ${new Date(state.lastSync).toLocaleString()}` : '';
    connect.hidden = !!state.account && auth.valid;
    connect.disabled = !auth.configured || ['preparing', 'connecting'].includes(state.phase);
    connect.textContent = state.phase === 'preparing' ? 'Loading Google...'
      : state.phase === 'connecting' ? 'Connecting...'
        : prepared ? 'Continue with Google' : state.phase === 'reconnect' ? 'Reconnect Google' : 'Connect Google Drive';
    retry.hidden = !state.account;
    retry.disabled = ['checking', 'syncing', 'connecting'].includes(state.phase);
    signOut.hidden = !state.account && state.phase !== 'connecting';
    if (state.phase !== 'conflict') closeDialog();
    else if (state.conflict && state.conflict !== displayed) showConflict(state.conflict);
  });
  const onStorage = (event: StorageEvent): void => { if (event.storageArea === storage) sync.storageChanged(event); };
  const onOnline = (): void => sync.resume();
  const onVisibility = (): void => { if (!document.hidden) sync.resume(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsubscribe(); sync.dispose(); closeDialog(); section.remove();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
