let nextId = 0;

/** Returns a document-unique element ID so concurrently open dialogs never share labels. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

/** Downloads text through an attached temporary link (detached links are ignored by some browsers). */
export function downloadText(text: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
