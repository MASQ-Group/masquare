/** Two-letter avatar initials from a name (e.g. "A.M.A. MASQUARE LTD" -> "AM"). */
export function initials(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '–';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** dd/mm/yyyy — the platform default (Global Settings will make this configurable). */
export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
