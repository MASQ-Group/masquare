/**
 * What changed between two versions of a record.
 *
 * The whole value of the activity log is here. "Someone edited this product" locates nothing; "the
 * purchase cost went from 12.50 to 1250.00" is the mistake, already found. So the diff has to be
 * both complete (never miss a real change) and quiet (never report one that did not happen) —
 * a log that cries wolf on every save is one nobody reads, and then it may as well not exist.
 */

export interface FieldChange {
  field: string;
  /** Human label, so the UI needs no field dictionary of its own. */
  label: string;
  from: string | null;
  to: string | null;
}

/** Fields that change on every write and mean nothing to a reader. */
const NOISE = new Set(['updatedAt', 'createdAt', 'updatedById', 'createdById', 'id', 'deletedAt']);

/**
 * Compare as strings, because that is how the values are stored and displayed.
 *
 * Prisma hands back Decimal objects, Dates and numbers for fields that a form submits as strings,
 * so `12.5 !== "12.50"` by identity while being the same price. Normalising both sides through the
 * same renderer is what stops a save that changed nothing from logging seven changes.
 */
export function renderValue(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(' | ') : null;
  if (typeof v === 'object') {
    // Decimal and anything else with a meaningful toString; a bare object would render "[object Object]".
    const s = String(v);
    return s === '[object Object]' ? JSON.stringify(v) : s;
  }
  if (typeof v === 'number') {
    // 12.50 and 12.5 are the same price. Trailing zeros differ by how the value was typed, not by
    // what it means, so they must not read as a change.
    return String(v);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null; // "" and null both mean "not set"
    // A numeric string normalises the same way a number does, so "12.50" and 12.5 agree.
    const n = Number(t);
    return t !== '' && Number.isFinite(n) && /^-?\d*\.?\d+$/.test(t) ? String(n) : t;
  }
  return String(v);
}

export interface DiffOptions {
  /** field -> human label. A field with no label is still reported, under its own name. */
  labels?: Record<string, string>;
  /**
   * field -> (id) => display name. Reference columns hold uuids, and "brandId changed from
   * 3f2a… to 9c14…" tells a reader nothing at all.
   */
  resolve?: Partial<Record<string, (id: string) => string | undefined>>;
  /** Fields to leave out entirely, on top of the always-noisy ones. */
  ignore?: string[];
}

/**
 * The changed fields between `before` and `after`.
 *
 * Only keys present in `after` are considered: a partial update carries the fields the caller
 * actually set, and treating an absent key as "cleared" would invent deletions on every edit.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: DiffOptions = {},
): FieldChange[] {
  if (!after) return [];
  const ignore = new Set([...NOISE, ...(opts.ignore ?? [])]);
  const labels = opts.labels ?? {};
  const resolve = opts.resolve ?? {};
  const out: FieldChange[] = [];

  for (const key of Object.keys(after)) {
    if (ignore.has(key)) continue;
    const rawFrom = before ? (before as any)[key] : undefined;
    const rawTo = (after as any)[key];

    const from = renderValue(rawFrom);
    const to = renderValue(rawTo);
    if (from === to) continue;

    // A reference column reads as a name, never a uuid. If the id cannot be resolved — the record
    // was deleted since — fall back to the id rather than dropping the change silently.
    // Partial<Record<>> above is what makes this genuinely optional: a plain Record claims every
    // key exists, so the compiler reads the guard as dead code while it is load-bearing at runtime.
    const asName = resolve[key];
    out.push({
      field: key,
      label: labels[key] ?? key,
      from: asName && from ? asName(from) ?? from : from,
      to: asName && to ? asName(to) ?? to : to,
    });
  }
  return out;
}

/** A one-line description for the feed, e.g. "Purchase cost, Brand and 2 more". */
export function summariseChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return 'No fields changed';
  const names = changes.map((c) => c.label);
  if (names.length <= 3) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}
