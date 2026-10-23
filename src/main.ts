import './styles/main.css';
import './styles/map.css';
import './styles/popover.css';
import { decodeWorld, loadJson, validateRegistry } from './geography';
import { createMap } from './map';
import { StatusPopover } from './popover';
import { createSidebar } from './sidebar';
import { SidebarPreference } from './sidebar-visibility';
import { loadInitialState, parseData, TravelStore } from './store';
import { errorMessage, type LocationEntry, type SelectTerritory } from './types';
import type { SceneryState } from './scenery';
import { applyTheme, ThemePreference } from './theme';
import { THEMES } from './themes';
import { createGoogleSync } from './sync-ui';
import { createSidebarTabs } from './sidebar-tabs';
import { createStatistics } from './statistics-ui';
import { createBadges } from './badges-ui';
import { createBadgeCatalog } from './badge-catalog';
import { downloadText as download, uniqueId } from './dom';

const app = document.querySelector<HTMLDivElement>('#app')!;
const themePreference = new ThemePreference(() => window.localStorage);
const sidebarPreference = new SidebarPreference(() => window.localStorage);
applyTheme(themePreference.current);
app.innerHTML = `
  <main class="loading-screen" aria-live="polite">
    <span class="brand-mark" aria-hidden="true">\u2713</span>
    <h1>passport<span>.</span></h1>
    <p>Unfolding your world\u2026</p>
  </main>`;

function confirmation(title: string, message: string, action: string, extra?: { label: string; run: () => void }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirmation-dialog';
    const heading = document.createElement('h2');
    heading.id = uniqueId('confirmation-title');
    heading.textContent = title;
    const body = document.createElement('p');
    body.id = uniqueId('confirmation-message');
    body.textContent = message;
    const controls = document.createElement('div');
    controls.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.className = 'button secondary';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'button primary';
    confirm.textContent = action;
    const finish = (result: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    if (extra) {
      const button = document.createElement('button');
      button.className = 'button secondary';
      button.textContent = extra.label;
      button.addEventListener('click', extra.run);
      controls.append(button);
    }
    controls.append(cancel, confirm);
    dialog.append(heading, body, controls);
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.setAttribute('aria-describedby', body.id);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

async function boot(): Promise<void> {
  const [rawRegistry, rawWorld] = await Promise.all([loadJson('registry.json'), loadJson('world-10m.json')]);
  const registry = validateRegistry(rawRegistry);
  const world = decodeWorld(rawWorld, registry);
  let storage: Storage | undefined;
  let storageWarning: string | undefined;
  try {
    storage = window.localStorage;
  } catch (error) {
    storageWarning = `Browser storage is unavailable. Export to keep changes. ${errorMessage(error)}`;
  }
  const initial = await loadInitialState(registry, storage, () => loadJson('user-data.json'));
  if (initial.recovery) {
    const recovery = initial.recovery;
    const confirmed = await confirmation(
      'Your browser data needs attention',
      `Saved data could not be read: ${recovery.message} Download it for safekeeping, or explicitly replace it with the committed starting data. Your existing data has not been overwritten.`,
      'Use committed data',
      { label: 'Download original data', run: () => download(recovery.raw, 'passport-recovery.json') },
    );
    if (!confirmed) {
      showFatal('Recovery was cancelled. Your existing browser data has not been changed.');
      return;
    }
  }

  app.innerHTML = `
    <div class="application">
      <main class="workspace">
        <section class="map-section" aria-label="Travel map">
          <div id="map-canvas" class="map-canvas"></div>
          <button id="toggle-sidebar" class="button sidebar-toggle" aria-controls="places-sidebar" aria-expanded="true" aria-describedby="sidebar-message">Hide sidebar</button>
          <p id="sidebar-message" class="sidebar-preference-message" role="status" hidden></p>
          <div class="map-toolbar" role="group" aria-label="Map controls"><button id="zoom-in" class="icon-button" aria-label="Zoom in">+</button><button id="zoom-out" class="icon-button" aria-label="Zoom out">\u2212</button><span class="toolbar-divider"></span><button id="reset-map" class="icon-button reset-map" aria-label="Reset map view">\u21ba</button><span class="toolbar-divider"></span><button id="pause-scenery" class="icon-button scenery-control" aria-label="Pause map animations" aria-pressed="false" aria-describedby="scenery-description"></button><button id="toggle-scenery" class="icon-button scenery-control" aria-label="Hide map scenery" aria-pressed="true"></button><span id="scenery-description" class="sr-only">Decorative ships, airplanes, and clouds. Pause freezes them; hide removes them completely.</span></div>
          <div class="map-legend" aria-label="Travel status legend">
            <span><i class="status-dot visited"></i>Visited</span><span><i class="status-dot lived"></i>Lived / Living</span><span><i class="status-dot want_to_visit"></i>Want to Visit</span><span><i class="status-dot unvisited"></i>Not yet</span>
          </div>
        </section>
        <aside id="places-sidebar" class="sidebar" aria-labelledby="places-heading">
          <div class="sidebar-heading"><div><p class="eyebrow">THE WORLD, YOUR WAY</p><h2 id="places-heading">Your places<span>.</span></h2></div><button id="share-picture" type="button" class="button primary" aria-label="Share picture" title="Share picture"><svg class="share-picture-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 6 9.5 4h5L16 6h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.5" r="4"/></svg></button></div>
          <div class="sidebar-tabs" role="tablist" aria-label="Sidebar views">
            <button id="tab-manage" role="tab" aria-selected="true" aria-controls="panel-manage">Manage countries</button>
            <button id="tab-stats" role="tab" aria-selected="false" aria-controls="panel-stats" tabindex="-1">Stats</button>
            <button id="tab-badges" role="tab" aria-selected="false" aria-controls="panel-badges" tabindex="-1">Badges</button>
          </div>
          <section id="panel-manage" class="sidebar-panel manage-panel" role="tabpanel" aria-labelledby="tab-manage">
          <label class="theme-picker" for="theme-picker">Theme<select id="theme-picker" aria-describedby="theme-message"></select></label>
          <p id="theme-message" class="theme-message" role="status" hidden></p>
          <div class="travel-stats" aria-label="Your travel totals">
            <div><strong id="visited-count">0</strong><span><i class="status-dot visited"></i>visited</span></div>
            <div><strong id="lived-count">0</strong><span><i class="status-dot lived"></i>called home</span></div>
            <div><strong id="wish-count">0</strong><span><i class="status-dot want_to_visit"></i>on the list</span></div>
          </div>
          <div class="journey-progress"><div><span>Your world in color</span><strong id="colored-count">0 / ${registry.length}</strong></div><div class="progress-track"><span id="progress-fill"></span></div></div>
          <div id="country-sidebar" class="sidebar-content"></div>
          </section>
          <section id="panel-stats" class="sidebar-panel insight-panel" role="tabpanel" aria-labelledby="tab-stats" tabindex="0" hidden></section>
          <section id="panel-badges" class="sidebar-panel insight-panel" role="tabpanel" aria-labelledby="tab-badges" tabindex="0" hidden></section>
          <footer class="sidebar-footer"><p id="save-status"><span class="save-indicator"></span> Changes stay in your browser</p><div id="google-sync"></div>
            <div class="data-actions"><button id="export-data" class="text-button">Export data</button><button id="copy-data" class="text-button">Copy JSON</button><button id="import-data" class="text-button">Import</button></div>
            <input id="import-file" type="file" accept=".json,application/json" hidden /><p class="data-license">Boundaries: Natural Earth \u00b7 <a href="${import.meta.env.BASE_URL}data/provenance.json" target="_blank" rel="noopener">Data sources</a><br />Country metadata: <a href="https://github.com/mledoze/countries" target="_blank" rel="noopener">mledoze/countries</a> \u00b7 <a href="${import.meta.env.BASE_URL}data/COUNTRIES-LICENSE.txt" target="_blank" rel="noopener">ODbL</a><br /><a class="repo-link" href="https://github.com/mikebis/passport" target="_blank" rel="noopener"><svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="10" height="10"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>View on GitHub</a></p></footer>
        </aside>
      </main>
      <div id="warning" class="warning-banner" role="alert" hidden></div>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
    </div>`;

  function element<T extends HTMLElement>(selector: string): T {
    const node = app.querySelector<T>(selector);
    if (!node) throw new Error(`Missing application element: ${selector}`);
    return node;
  }
  const warning = element('#warning');
  const toast = element('#toast');
  const announcement = element('#announcement');
  const workspace = element('.workspace');
  const sidebarPanel = element('#places-sidebar');
  const sidebarToggle = element<HTMLButtonElement>('#toggle-sidebar');
  const sidebarMessage = element('#sidebar-message');
  const mobileLayout = window.matchMedia('(max-width: 720px)');
  function renderSidebarVisibility(): void {
    const visible = mobileLayout.matches || sidebarPreference.visible;
    workspace.classList.toggle('sidebar-collapsed', !visible);
    sidebarPanel.hidden = !visible;
    sidebarToggle.hidden = mobileLayout.matches;
    sidebarToggle.textContent = visible ? 'Hide sidebar' : 'Show sidebar';
    sidebarToggle.title = sidebarToggle.textContent;
    sidebarToggle.setAttribute('aria-expanded', String(visible));
    sidebarMessage.textContent = sidebarPreference.warning ?? '';
    sidebarMessage.hidden = !sidebarPreference.warning;
  }
  renderSidebarVisibility();
  let toastTimer: ReturnType<typeof setTimeout>;
  const announce = (message: string): void => {
    announcement.textContent = message;
  };
  const notify = (message: string): void => {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  };
  const warn = (message: string, dataSaved = false): void => {
    warning.textContent = message;
    warning.hidden = false;
    element('#save-status').textContent = dataSaved ? 'Saved on this device' : 'Not saved \u2014 export a backup';
  };
  const saved = (): void => {
    warning.hidden = true;
    element('#save-status').textContent = 'Saved on this device';
  };
  const store = new TravelStore(initial.entries, registry, storage, warn, saved);
  const popover = new StatusPopover(store, registry, announce, () => focusSidebar());
  const selectCountry: SelectTerritory = (id, anchor) => {
    map.focusCountry(id);
    popover.open(id, anchor);
  };
  const pauseScenery = element<HTMLButtonElement>('#pause-scenery');
  const toggleScenery = element<HTMLButtonElement>('#toggle-scenery');
  let sceneryState: SceneryState | undefined;
  function syncSceneryControls(state: SceneryState): void {
    sceneryState = state;
    const label = !state.visible ? 'Show scenery to enable animation controls'
      : state.reducedMotion ? 'Map animations disabled for reduced motion'
        : state.paused ? 'Resume map animations' : 'Pause map animations';
    pauseScenery.disabled = !state.visible || state.reducedMotion;
    pauseScenery.setAttribute('aria-label', label);
    pauseScenery.setAttribute('aria-pressed', String(state.paused));
    pauseScenery.title = label;
    pauseScenery.innerHTML = state.paused
      ? '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m7 4 9 6-9 6Z" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7 5v10m6-10v10"/></svg>';
    const visibilityLabel = state.visible ? 'Hide map scenery' : 'Show map scenery';
    toggleScenery.setAttribute('aria-label', visibilityLabel);
    toggleScenery.setAttribute('aria-pressed', String(state.visible));
    toggleScenery.title = visibilityLabel;
    toggleScenery.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.3"/>${state.visible ? '' : '<path d="m3 3 14 14"/>'}</svg>`;
    const explanation = !state.visible
      ? 'All map decorations are hidden. Show map scenery to use the animation control.'
      : state.reducedMotion ? 'Your system requests reduced motion. Decorations remain static; you can still hide them.'
        : 'Pause freezes them; hide removes them completely.';
    element('#scenery-description').textContent = `${themePreference.current.sceneryDescription} ${explanation}`;
  }
  const map = createMap(element('#map-canvas'), world.countries, world.background, registry, store, selectCountry, () => popover.close(false), syncSceneryControls, themePreference.current.artwork);
  const themePicker = element<HTMLSelectElement>('#theme-picker');
  for (const theme of THEMES) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    themePicker.append(option);
  }
  themePicker.value = themePreference.current.id;
  const themeMessage = element('#theme-message');
  function showThemeWarning(): void {
    themeMessage.textContent = themePreference.warning ?? '';
    themeMessage.hidden = !themePreference.warning;
  }
  showThemeWarning();
  themePicker.addEventListener('change', () => {
    themePreference.choose(themePicker.value);
    applyTheme(themePreference.current);
    popover.close(false);
    map.setThemeArtwork(themePreference.current.artwork);
    if (sceneryState) syncSceneryControls(sceneryState);
    showThemeWarning();
  });
  const sidebar = createSidebar(element('#country-sidebar'), registry, store, selectCountry, map.previewCountry, announce);
  createStatistics(element('#panel-stats'), registry, store);
  const loadCatalog = createBadgeCatalog(registry);
  const badges = createBadges(element('#panel-badges'), registry, store, loadCatalog);
  const tabs = createSidebarTabs(sidebarPanel, (tab) => {
    popover.close(false);
    sidebar.clearPreview();
    if (tab === 'badges') badges.activate();
  });
  function focusSidebar(): void {
    if (sidebarPanel.hidden) sidebarToggle.focus({ preventScroll: true });
    else if (tabs.current === 'manage') sidebar.focusSearch();
    else tabs.focus();
  }
  function updateSidebarVisibility(): void {
    const active = document.activeElement;
    const focusHiddenSidebar = !mobileLayout.matches && !sidebarPreference.visible && sidebarPanel.contains(active);
    const focusHiddenToggle = mobileLayout.matches && active === sidebarToggle;
    const focusClosedPopover = Boolean(active?.closest('.status-popover'));
    popover.close(false);
    sidebar.clearPreview();
    renderSidebarVisibility();
    if (focusClosedPopover) {
      if (mobileLayout.matches) focusSidebar();
      else sidebarToggle.focus({ preventScroll: true });
    } else if (focusHiddenSidebar) sidebarToggle.focus({ preventScroll: true });
    else if (focusHiddenToggle) focusSidebar();
  }
  sidebarToggle.addEventListener('click', () => {
    if (mobileLayout.matches) return;
    sidebarPreference.choose(!sidebarPreference.visible);
    updateSidebarVisibility();
  });
  sidebarToggle.addEventListener('blur', () => {
    if (!mobileLayout.matches) return;
    // CSS may hide the toggle before the media-query change event can recover focus.
    queueMicrotask(() => {
      if (mobileLayout.matches && document.activeElement === document.body) {
        updateSidebarVisibility();
        focusSidebar();
      }
    });
  });
  mobileLayout.addEventListener('change', updateSidebarVisibility);
  element('#zoom-in').addEventListener('click', map.zoomIn);
  element('#zoom-out').addEventListener('click', map.zoomOut);
  element('#reset-map').addEventListener('click', map.reset);
  pauseScenery.addEventListener('click', map.toggleSceneryMotion);
  toggleScenery.addEventListener('click', map.toggleSceneryVisibility);

  function updateStats(): void {
    const entries = store.snapshot();
    const visited = entries.filter((entry) => entry.status === 'visited').length;
    const lived = entries.filter((entry) => entry.status === 'lived').length;
    const wishlist = entries.filter((entry) => entry.status === 'want_to_visit').length;
    element('#visited-count').textContent = String(visited);
    element('#lived-count').textContent = String(lived);
    element('#wish-count').textContent = String(wishlist);
    element('#colored-count').textContent = `${visited + lived + wishlist} / ${registry.length}`;
    element('#progress-fill').style.width = `${(visited + lived + wishlist) / registry.length * 100}%`;
  }
  store.subscribe(updateStats);
  updateStats();
  if (initial.recovery) store.persist();
  else if (initial.warning || storageWarning) warn(initial.warning || storageWarning!);
  else if (initial.cleanupWarning) warn(initial.cleanupWarning, true);
  // The app is created once per page load, so long-lived components (map, popover,
  // sync controller) are intentionally never disposed; their listeners end with the page.
  createGoogleSync(element('#google-sync'), store, registry, storage, () => popover.close(false));
  const sharePicture = element<HTMLButtonElement>('#share-picture');
  let openPicture: (() => void) | undefined;
  sharePicture.addEventListener('click', async () => {
    sharePicture.disabled = true;
    try {
      if (!openPicture) {
        const { createInfographic } = await import('./infographic-ui');
        openPicture = createInfographic(store, registry, world.countries, loadCatalog, sharePicture, focusSidebar);
      }
      popover.close(false);
      sidebar.clearPreview();
      openPicture();
    } catch (error) {
      notify(`Could not open the picture generator. ${errorMessage(error)} Try Share picture again.`);
    } finally {
      sharePicture.disabled = false;
    }
  });

  element('#export-data').addEventListener('click', () => {
    download(store.exportJson(), 'passport-data.json');
    notify('JSON export prepared. Keep it as a backup or commit it as data/user-data.json.');
  });
  element('#copy-data').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(store.exportJson());
      notify('JSON copied. Paste it into data/user-data.json to keep it in Git.');
    } catch (error) {
      notify(`Could not copy JSON. ${errorMessage(error)} Use Export data to download it instead.`);
    }
  });
  const fileInput = element<HTMLInputElement>('#import-file');
  const importButton = element<HTMLButtonElement>('#import-data');
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    importButton.disabled = true;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('The import file must be 5 MB or smaller.');
      const entries: LocationEntry[] = parseData(await file.text(), registry);
      const { statuses: changed, favourites } = store.differences(entries);
      const confirmed = await confirmation('Replace your travel data?',
        `Importing ${file.name} will replace your current data, including subdivisions. ${changed} place statuses and ${favourites} favourite flags will change. Export a backup first if you want to keep the current version.`,
        'Replace data');
      if (confirmed) {
        popover.close(false);
        store.replace(entries);
        notify('Data imported. Your map and territory list are up to date.');
      }
    } catch (error) {
      notify(`Import rejected. ${errorMessage(error)} Your current data has not been changed.`);
    } finally {
      fileInput.value = '';
      importButton.disabled = false;
      importButton.focus();
    }
  });
}

function showFatal(message: string): void {
  app.replaceChildren();
  const panel = document.createElement('main');
  panel.className = 'loading-screen error-screen';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = 'We couldn\u2019t unfold your world.';
  const detail = document.createElement('p');
  detail.textContent = message;
  const retry = document.createElement('button');
  retry.className = 'button primary';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => window.location.reload());
  panel.append(title, detail, retry);
  app.append(panel);
}

boot().catch((error: unknown) => showFatal(errorMessage(error)));
