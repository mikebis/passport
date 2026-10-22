import type { TravelStore } from './store';
import { continentProgress } from './statistics';
import { CONTINENTS, NON_ISO_LABEL, territorySymbol, STATUSES, STATUS_LABELS, type Continent, type SelectTerritory, type Territory, type TravelStatus } from './types';

interface TerritoryFilter {
  selected: ReadonlySet<TravelStatus>;
  status: (id: string) => TravelStatus;
  favourite?: (id: string) => boolean;
}

export function filterTerritories(registry: readonly Territory[], query: string, filters?: TerritoryFilter): Territory[] {
  const needle = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  return registry.filter((country) =>
    `${country.name} ${country.id} ${country.alpha2 ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').includes(needle)
    && (!filters?.selected.size || filters.selected.has(filters.status(country.id)))
    && (!filters?.favourite || filters.favourite(country.id)),
  ).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function createSidebar(
  container: HTMLElement,
  registry: readonly Territory[],
  store: TravelStore,
  select: SelectTerritory,
  preview: (id: string | undefined) => void,
  announce: (message: string) => void,
): { focusSearch: () => void; clearPreview: () => void } {
  const label = document.createElement('label');
  label.className = 'search-box';
  label.innerHTML = '<span aria-hidden="true">\u2315</span><span class="sr-only">Search places or codes</span>';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Find a place or territory';
  input.autocomplete = 'off';
  input.setAttribute('aria-controls', 'country-groups');
  label.append(input);
  const selected = new Set<TravelStatus>();
  let favouritesOnly = false;
  const filters = document.createElement('div');
  filters.className = 'status-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filter places');
  filters.setAttribute('aria-describedby', 'status-filter-hint');
  const filterLabel = document.createElement('span');
  filterLabel.className = 'status-filters-label';
  filterLabel.textContent = 'Filters';
  const hint = document.createElement('span');
  hint.id = 'status-filter-hint';
  hint.className = 'sr-only';
  hint.textContent = 'Combine statuses to include either. No selected statuses includes all statuses. The star shows only favourites. Text search narrows the results.';
  filters.append(filterLabel, hint);
  const filterButtons = new Map<TravelStatus, HTMLButtonElement>();
  for (const status of STATUSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-filter';
    button.dataset.status = status;
    const dot = document.createElement('span');
    dot.className = `status-dot ${status}`;
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
    button.title = `Filter by ${STATUS_LABELS[status]}`;
    button.setAttribute('aria-label', `Filter by ${STATUS_LABELS[status]}`);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'country-groups');
    button.addEventListener('click', () => {
      if (selected.has(status)) selected.delete(status);
      else selected.add(status);
      updateFilters();
    });
    filterButtons.set(status, button);
    filters.append(button);
  }
  const favouriteFilter = document.createElement('button');
  favouriteFilter.type = 'button';
  favouriteFilter.className = 'favourite-filter';
  const star = document.createElement('span');
  star.textContent = '\u2605';
  star.setAttribute('aria-hidden', 'true');
  favouriteFilter.append(star);
  favouriteFilter.title = 'Filter by Favourites';
  favouriteFilter.setAttribute('aria-label', 'Filter by Favourites');
  favouriteFilter.setAttribute('aria-pressed', 'false');
  favouriteFilter.setAttribute('aria-controls', 'country-groups');
  favouriteFilter.addEventListener('click', () => {
    favouritesOnly = !favouritesOnly;
    updateFilters();
  });
  filters.append(favouriteFilter);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'status-filter-reset';
  reset.textContent = '\u21ba';
  reset.title = 'Show all statuses';
  reset.setAttribute('aria-label', 'Show all statuses');
  reset.setAttribute('aria-controls', 'country-groups');
  reset.addEventListener('click', () => {
    selected.clear();
    updateFilters();
  });
  filters.append(reset);
  const meta = document.createElement('p');
  meta.className = 'sidebar-meta';
  meta.setAttribute('aria-live', 'polite');
  const groups = document.createElement('div');
  groups.id = 'country-groups';
  groups.className = 'country-groups';
  container.append(label, filters, meta, groups);
  const continents = [...CONTINENTS, 'Antarctica'] as const;
  const expanded = new Map<Continent, boolean>(continents.map((name) => [name, false]));
  const rows = new Map<string, {
    item: HTMLElement; button: HTMLButtonElement; favourite: HTMLButtonElement; badge: HTMLElement; country: Territory;
  }>();
  const progressElements = new Map<Continent, { count: HTMLElement; label: HTMLElement }>();
  const continentElements = new Map<Continent, HTMLDetailsElement>();
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  let hoveredId: string | undefined;
  let focusedId: string | undefined;

  function updatePreview(): void {
    preview(hoveredId ?? focusedId);
  }

  function clearPreview(): void {
    hoveredId = undefined;
    focusedId = undefined;
    updatePreview();
  }

  function isFiltering(): boolean {
    return input.value.trim().length > 0 || selected.size > 0 || favouritesOnly;
  }

  function updateFilters(): void {
    for (const [status, button] of filterButtons) button.setAttribute('aria-pressed', String(selected.has(status)));
    favouriteFilter.setAttribute('aria-pressed', String(favouritesOnly));
    updateMembership(true);
  }

  function updateMembership(revealGroups = false): void {
    const matching = new Set(filterTerritories(registry, input.value, {
      selected, status: (id) => store.status(id), favourite: (id) => !favouritesOnly || store.isFavourite(id),
    })
      .map((country) => country.id));
    let focusExcluded = false;
    for (const [id, { item, button }] of rows) {
      const excluded = !matching.has(id);
      if (excluded && item.contains(document.activeElement)) focusExcluded = true;
      item.hidden = excluded;
      button.hidden = excluded;
      if (excluded && hoveredId === id) hoveredId = undefined;
      if (excluded && focusedId === id) focusedId = undefined;
    }
    const visibleContinents = new Set(registry.filter((country) => matching.has(country.id)).map((country) => country.continent));
    for (const [continent, details] of continentElements) {
      const wasHidden = details.hidden;
      details.hidden = !visibleContinents.has(continent);
      if (revealGroups) details.open = isFiltering() || (expanded.get(continent) ?? false);
      else if (wasHidden && !details.hidden && isFiltering()) details.open = true;
    }
    updatePreview();
    if (focusExcluded) input.focus({ preventScroll: true });
    meta.textContent = isFiltering() ? `${matching.size} matching places` : `${registry.length} places. A world of possibilities.`;
    empty.hidden = matching.size > 0;
    empty.textContent = selected.size || favouritesOnly
      ? 'No places match these filters. Adjust your filters or change your search.'
      : 'No places found. Try a name or an ISO code.';
  }

  function addProgress(continent: Continent, parent: HTMLElement, label: HTMLElement): void {
    const count = document.createElement('span');
    count.className = 'continent-count';
    count.setAttribute('aria-hidden', 'true');
    parent.append(count);
    progressElements.set(continent, { count, label });
  }

  function render(): void {
    clearPreview();
    groups.replaceChildren();
    rows.clear();
    progressElements.clear();
    continentElements.clear();
    const filtered = filterTerritories(registry, input.value);

    function addRow(country: Territory, parent: HTMLElement): void {
      const item = document.createElement('div');
      item.className = 'country-item';
      const button = document.createElement('button');
      button.className = 'country-row';
      button.dataset.country = country.id;
      button.dataset.kind = country.kind;
      button.setAttribute('aria-haspopup', 'dialog');
      const icon = document.createElement('span');
      icon.className = 'country-flag';
      icon.textContent = territorySymbol(country);
      icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'country-name';
      name.textContent = country.name;
      if (country.kind === 'custom') {
        const kind = document.createElement('small');
        kind.className = 'territory-kind';
        kind.textContent = NON_ISO_LABEL;
        name.append(kind);
      }
      const code = document.createElement('span');
      code.className = 'country-code';
      code.textContent = country.id;
      const badge = document.createElement('span');
      badge.className = 'status-dot';
      badge.setAttribute('aria-hidden', 'true');
      button.append(icon, name, code, badge);
      const favourite = document.createElement('button');
      favourite.type = 'button';
      favourite.className = 'country-favourite';
      favourite.dataset.country = country.id;
      favourite.setAttribute('aria-label', `Favourite ${country.name}`);
      favourite.addEventListener('click', () => {
        store.setFavourite(country.id, !store.isFavourite(country.id));
        announce(`${country.name}: ${store.isFavourite(country.id) ? 'added to' : 'removed from'} favourites.`);
      });
      item.append(button, favourite);
      item.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        hoveredId = country.id;
        updatePreview();
      });
      const leave = (): void => {
        if (hoveredId !== country.id) return;
        hoveredId = undefined;
        updatePreview();
      };
      item.addEventListener('pointerleave', leave);
      item.addEventListener('pointercancel', leave);
      item.addEventListener('focusin', () => {
        focusedId = country.id;
        updatePreview();
      });
      item.addEventListener('focusout', (event) => {
        if (event.relatedTarget instanceof Node && item.contains(event.relatedTarget)) return;
        if (focusedId !== country.id) return;
        focusedId = undefined;
        updatePreview();
      });
      button.addEventListener('click', () => {
        const rect = button.getBoundingClientRect();
        select(country.id, { x: rect.left, y: rect.top, trigger: button });
      });
      rows.set(country.id, { item, button, favourite, badge, country });
      parent.append(item);
    }

    for (const continent of continents) {
      const countries = filtered.filter((country) => country.continent === continent);
      if (!countries.length) continue;
      const details = document.createElement('details');
      details.className = continent === 'Antarctica' ? 'continent antarctica' : 'continent';
      details.open = isFiltering() || (expanded.get(continent) ?? false);
      const summary = document.createElement('summary');
      const name = document.createElement('span');
      name.textContent = continent;
      summary.append(name);
      addProgress(continent, summary, summary);
      details.append(summary);
      countries.forEach((country) => addRow(country, details));
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (!isFiltering()) expanded.set(continent, details.open);
        if (!details.open) {
          if (hoveredId && rows.get(hoveredId)?.country.continent === continent) hoveredId = undefined;
          if (focusedId && rows.get(focusedId)?.country.continent === continent) focusedId = undefined;
          updatePreview();
        }
      });
      continentElements.set(continent, details);
      groups.append(details);
    }
    groups.append(empty);
    updateStatuses();
  }

  function updateStatuses(): void {
    const progress = continentProgress(registry, (id) => store.status(id));
    for (const [continent, { count, label }] of progressElements) {
      const { completed, total } = progress.get(continent)!;
      count.textContent = `(${completed}/${total})`;
      count.title = `${completed} of ${total} official ISO countries and territories visited or lived in`;
      label.setAttribute('aria-description', count.title);
    }
    for (const [id, { item, button, favourite, badge, country }] of rows) {
      const status = store.status(id);
      const isFavourite = store.isFavourite(id);
      badge.className = `status-dot ${status}`;
      item.dataset.status = status;
      button.dataset.status = status;
      button.dataset.favourite = String(isFavourite);
      favourite.textContent = isFavourite ? '\u2605' : '\u2606';
      favourite.setAttribute('aria-pressed', String(isFavourite));
      favourite.title = `${isFavourite ? 'Remove' : 'Add'} ${country.name} ${isFavourite ? 'from' : 'to'} favourites`;
      const kind = country.kind === 'custom' ? `${NON_ISO_LABEL} \u00b7 ` : '';
      button.setAttribute('aria-label', `${country.name} (${country.id}), ${kind}${STATUS_LABELS[status]}. ${isFavourite ? 'Favourite. ' : ''}Change status`);
      button.title = `${country.name} \u00b7 ${kind}${STATUS_LABELS[status]}${isFavourite ? ' \u00b7 Favourite' : ''}`;
    }
    updateMembership();
  }
  input.addEventListener('input', render);
  store.subscribe(updateStatuses);
  render();
  return { focusSearch: () => input.focus({ preventScroll: true }), clearPreview };
}
