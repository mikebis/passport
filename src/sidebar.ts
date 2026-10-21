import type { TravelStore } from './store';
import { CONTINENTS, NON_ISO_LABEL, territorySymbol, STATUS_LABELS, type Continent, type SelectTerritory, type Territory, type TravelStatus } from './types';

export function filterTerritories(registry: readonly Territory[], query: string): Territory[] {
  const needle = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  return registry.filter((country) =>
    `${country.name} ${country.id} ${country.alpha2 ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').includes(needle),
  ).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function continentProgress(
  registry: readonly Territory[],
  status: (id: string) => TravelStatus,
): Map<Continent, { completed: number; total: number }> {
  const progress = new Map<Continent, { completed: number; total: number }>(
    ([...CONTINENTS, 'Antarctica'] as const).map((continent) => [continent, { completed: 0, total: 0 }]),
  );
  for (const country of registry) {
    if (country.kind !== 'iso') continue;
    const count = progress.get(country.continent)!;
    count.total++;
    const current = status(country.id);
    if (current === 'visited' || current === 'lived') count.completed++;
  }
  return progress;
}

export function createSidebar(
  container: HTMLElement,
  registry: readonly Territory[],
  store: TravelStore,
  select: SelectTerritory,
  preview: (id: string | undefined) => void,
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
  const meta = document.createElement('p');
  meta.className = 'sidebar-meta';
  meta.setAttribute('aria-live', 'polite');
  const groups = document.createElement('div');
  groups.id = 'country-groups';
  groups.className = 'country-groups';
  container.append(label, meta, groups);
  const continents = [...CONTINENTS, 'Antarctica'] as const;
  const expanded = new Map<Continent, boolean>(continents.map((name) => [name, false]));
  const rows = new Map<string, { button: HTMLButtonElement; badge: HTMLElement; country: Territory }>();
  const progressElements = new Map<Continent, { count: HTMLElement; label: HTMLElement }>();
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
    const filtered = filterTerritories(registry, input.value);
    const searching = input.value.trim().length > 0;
    meta.textContent = searching ? `${filtered.length} matching places` : `${registry.length} places. A world of possibilities.`;
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No places found. Try a name or an ISO code.';
      groups.append(empty);
      return;
    }

    function addRow(country: Territory, parent: HTMLElement): void {
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
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        hoveredId = country.id;
        updatePreview();
      });
      const leave = (): void => {
        if (hoveredId !== country.id) return;
        hoveredId = undefined;
        updatePreview();
      };
      button.addEventListener('pointerleave', leave);
      button.addEventListener('pointercancel', leave);
      button.addEventListener('focus', () => {
        focusedId = country.id;
        updatePreview();
      });
      button.addEventListener('blur', () => {
        if (focusedId !== country.id) return;
        focusedId = undefined;
        updatePreview();
      });
      button.addEventListener('click', () => {
        const rect = button.getBoundingClientRect();
        select(country.id, { x: rect.left, y: rect.top, trigger: button });
      });
      rows.set(country.id, { button, badge, country });
      parent.append(button);
    }

    for (const continent of continents) {
      const countries = filtered.filter((country) => country.continent === continent);
      if (!countries.length) continue;
      const details = document.createElement('details');
      details.className = continent === 'Antarctica' ? 'continent antarctica' : 'continent';
      details.open = searching || (expanded.get(continent) ?? false);
      const summary = document.createElement('summary');
      const name = document.createElement('span');
      name.textContent = continent;
      summary.append(name);
      addProgress(continent, summary, summary);
      details.append(summary);
      countries.forEach((country) => addRow(country, details));
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (!searching) expanded.set(continent, details.open);
        if (!details.open) {
          if (hoveredId && rows.get(hoveredId)?.country.continent === continent) hoveredId = undefined;
          if (focusedId && rows.get(focusedId)?.country.continent === continent) focusedId = undefined;
          updatePreview();
        }
      });
      groups.append(details);
    }
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
    for (const [id, { button, badge, country }] of rows) {
      const status = store.status(id);
      badge.className = `status-dot ${status}`;
      button.dataset.status = status;
      const kind = country.kind === 'custom' ? `${NON_ISO_LABEL} \u00b7 ` : '';
      button.setAttribute('aria-label', `${country.name} (${country.id}), ${kind}${STATUS_LABELS[status]}. Change status`);
      button.title = `${country.name} \u00b7 ${kind}${STATUS_LABELS[status]}`;
    }
  }
  input.addEventListener('input', render);
  store.subscribe(updateStatuses);
  render();
  return { focusSearch: () => input.focus({ preventScroll: true }), clearPreview };
}
