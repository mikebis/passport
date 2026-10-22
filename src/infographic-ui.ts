import './styles/infographic.css';
import type { BadgeCatalogLoader } from './badge-catalog';
import type { Boundaries } from './geography';
import { currentAppAddress, DEFAULT_FORMAT, infographicData, infographicFormat, INFOGRAPHIC_FORMATS, isLocalAddress, TEXT_LIMITS, validatePersonalization } from './infographic';
import { renderInfographic } from './infographic-renderer';
import type { TravelStore } from './store';
import { errorMessage, type Territory } from './types';

export function createInfographic(
  store: TravelStore, registry: readonly Territory[], countries: Boundaries,
  loadCatalog: BadgeCatalogLoader, trigger: HTMLButtonElement, focusFallback: () => void,
): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'infographic-dialog';
  dialog.setAttribute('aria-labelledby', 'infographic-heading');
  dialog.innerHTML = `
    <header class="infographic-heading"><div><h2 id="infographic-heading">Your travel passport</h2><p>Create a picture to keep or share. Everything is generated on this device.</p></div><button type="button" class="icon-button" aria-label="Close picture generator">\u00d7</button></header>
    <label class="infographic-format">Picture format<select name="format"></select></label>
    <div class="infographic-fields"></div>
    <p class="infographic-address">QR destination: <span></span></p>
    <p class="infographic-local-warning" hidden>The QR points to a local/private app address and may not work for others. Open the deployed app to create a publicly usable link.</p>
    <p class="infographic-message" role="status" aria-live="polite"></p>
    <div class="infographic-preview"><img alt="Your personalized travel passport" hidden /></div>
    <div class="infographic-actions"><button type="button" class="button secondary infographic-retry" hidden>Retry picture</button><button type="button" class="button primary infographic-download" disabled>Download PNG</button><button type="button" class="button secondary infographic-close">Close</button></div>
    <p class="infographic-note"><span class="infographic-resolution"></span> The QR links to this app, not a public copy of your personal map. No picture or travel data is uploaded.</p>`;
  const formatSelect = dialog.querySelector<HTMLSelectElement>('.infographic-format select')!;
  for (const format of Object.values(INFOGRAPHIC_FORMATS)) {
    const option = document.createElement('option');
    option.value = format.id;
    option.textContent = `${format.label} (${format.width} \u00d7 ${format.height})`;
    formatSelect.append(option);
  }
  formatSelect.value = DEFAULT_FORMAT;
  formatSelect.addEventListener('change', () => refresh());
  const resolution = dialog.querySelector<HTMLSpanElement>('.infographic-resolution')!;
  const fields = dialog.querySelector<HTMLDivElement>('.infographic-fields')!;
  const label = document.createElement('label');
  label.textContent = 'Name (optional)';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'name';
  nameInput.maxLength = TEXT_LIMITS.name;
  nameInput.autocomplete = 'off';
  label.append(nameInput);
  fields.append(label);
  nameInput.addEventListener('input', () => refresh());
  const message = dialog.querySelector<HTMLParagraphElement>('.infographic-message')!;
  const preview = dialog.querySelector<HTMLImageElement>('.infographic-preview img')!;
  const previewContainer = dialog.querySelector<HTMLDivElement>('.infographic-preview')!;
  const download = dialog.querySelector<HTMLButtonElement>('.infographic-download')!;
  const retry = dialog.querySelector<HTMLButtonElement>('.infographic-retry')!;
  const addressLabel = dialog.querySelector<HTMLSpanElement>('.infographic-address span')!;
  const localWarning = dialog.querySelector<HTMLParagraphElement>('.infographic-local-warning')!;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let previewUrl: string | undefined;
  let rendered: Blob | undefined;
  let address = '';

  function clearPreview(): void {
    preview.hidden = true;
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    rendered = undefined;
  }
  function fail(error: unknown): void {
    clearPreview();
    download.disabled = true;
    retry.hidden = false;
    message.setAttribute('role', 'alert');
    message.textContent = `Could not prepare your picture. ${errorMessage(error)}`;
  }
  async function generate(job: number): Promise<void> {
    let candidateUrl: string | undefined;
    try {
      address = currentAppAddress(window.location.origin, import.meta.env.BASE_URL);
      addressLabel.textContent = address;
      localWarning.hidden = !isLocalAddress(address);
      const format = infographicFormat(formatSelect.value);
      resolution.textContent = `${format.width} \u00d7 ${format.height} PNG.${format.id === 'horizontal' ? '' : ` ${format.label} portrait; up to ${format.flagLimit} flags per group.`}`;
      const personal = validatePersonalization({
        name: nameInput.value,
      });
      const entries = store.snapshot();
      const catalog = await loadCatalog();
      if (!dialog.open || job !== generation) return;
      const data = infographicData(registry, entries, catalog, format.id);
      const blob = await renderInfographic({ data, countries, registry, personal, address });
      if (!dialog.open || job !== generation) return;
      candidateUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = candidateUrl;
      await image.decode();
      if (!dialog.open || job !== generation) return;
      clearPreview();
      previewUrl = candidateUrl;
      candidateUrl = undefined;
      preview.src = previewUrl;
      preview.alt = `${personal.name ? `${personal.name}. ` : ''}${data.stats.completed} of ${data.stats.total} ISO places visited or lived in; ${data.earnedCount} badges earned. Four flag groups: Visited, Lived, Want to Visit and Favourites. ${format.label}, ${format.width} by ${format.height} PNG.`;
      preview.hidden = false;
      rendered = blob;
      download.disabled = false;
      message.textContent = 'Picture ready. Preview and download use the same image.';
    } catch (error) {
      if (dialog.open && job === generation) fail(error);
    } finally {
      if (candidateUrl) URL.revokeObjectURL(candidateUrl);
      if (job === generation) previewContainer.setAttribute('aria-busy', 'false');
    }
  }
  function refresh(delay = 250): void {
    if (!dialog.open) return;
    const job = ++generation;
    clearTimeout(timer);
    rendered = undefined;
    download.disabled = true;
    retry.hidden = true;
    message.setAttribute('role', 'status');
    message.textContent = 'Preparing your picture\u2026';
    previewContainer.setAttribute('aria-busy', 'true');
    timer = setTimeout(() => { void generate(job); }, delay);
  }
  download.addEventListener('click', () => {
    if (!rendered) { fail(new Error('Wait for a finished picture before downloading.')); return; }
    let url: string | undefined;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(rendered);
      link.href = url;
      link.download = 'passport-infographic.png';
      document.body.append(link);
      link.click();
    } catch (error) {
      fail(error);
    } finally {
      link.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('.infographic-close,.infographic-heading > button')) {
    button.addEventListener('click', () => dialog.close());
  }
  retry.addEventListener('click', () => refresh(0));
  dialog.addEventListener('close', () => {
    generation++;
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = undefined;
    clearPreview();
    if (trigger.isConnected && trigger.checkVisibility() && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    else focusFallback();
  });
  document.body.append(dialog);
  return () => {
    if (dialog.open) return;
    dialog.showModal();
    nameInput.focus({ preventScroll: true });
    unsubscribe = store.subscribe(() => refresh());
    refresh(0);
  };
}
