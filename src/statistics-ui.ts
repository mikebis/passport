import { formatPercentage, travelStatistics } from './statistics';
import type { TravelStore } from './store';
import { STATUSES, STATUS_LABELS, type Territory } from './types';

export function createStatistics(container: HTMLElement, registry: readonly Territory[], store: TravelStore): void {
  container.innerHTML = '<h3>Travel statistics</h3><p class="insight-note">Official ISO countries and territories only. Includes Antarctica; excludes additional non-ISO places and subdivisions.</p>';
  const metrics = document.createElement('dl');
  metrics.className = 'statistics-grid';
  const counts = new Map<string, HTMLElement>();
  for (const [key, label] of [...STATUSES.map((status) => [status, STATUS_LABELS[status]]), ['completed', 'Visited or lived in'], ['continents', 'Continents visited or lived in']]) {
    const item = document.createElement('div');
    const title = document.createElement('dt');
    title.textContent = label!;
    const value = document.createElement('dd');
    value.dataset.stat = key;
    counts.set(key!, value);
    item.append(title, value);
    metrics.append(item);
  }
  const heading = document.createElement('h3');
  heading.textContent = 'By continent';
  const list = document.createElement('div');
  list.className = 'continent-statistics';
  const rows = new Map<string, { value: HTMLElement; progress: HTMLProgressElement }>();
  const initial = travelStatistics(registry, (id) => store.status(id));
  for (const continent of initial.continents.keys()) {
    const row = document.createElement('div');
    row.className = 'continent-statistic';
    row.dataset.continent = continent;
    const name = document.createElement('strong');
    name.textContent = continent;
    const value = document.createElement('span');
    const progress = document.createElement('progress');
    progress.className = 'insight-progress';
    progress.setAttribute('aria-label', `${continent}: ISO places visited or lived in`);
    row.append(name, value, progress);
    list.append(row);
    rows.set(continent, { value, progress });
  }
  container.append(metrics, heading, list);
  function update(): void {
    const stats = travelStatistics(registry, (id) => store.status(id));
    for (const status of STATUSES) counts.get(status)!.textContent = String(stats.counts[status]);
    counts.get('completed')!.textContent = `${stats.completed}/${stats.total} (${formatPercentage(stats.percentage)})`;
    counts.get('continents')!.textContent = `${stats.continentsCompleted}/${stats.continents.size}`;
    for (const [continent, count] of stats.continents) {
      const { value, progress } = rows.get(continent)!;
      const text = `${count.completed}/${count.total} (${formatPercentage(count.total ? count.completed / count.total * 100 : 0)})`;
      value.textContent = text;
      progress.max = count.total || 1;
      progress.value = count.completed;
      progress.setAttribute('aria-valuetext', text);
    }
  }
  store.subscribe(update);
  update();
}
