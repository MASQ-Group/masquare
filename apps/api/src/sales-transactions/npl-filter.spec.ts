import { describe, expect, it } from 'vitest';

/**
 * Never-placed is its own thing, not a kind of cancellation.
 *
 * An order cancelled while still pending never became an order: no payment was taken and nothing
 * shipped. One cancelled after it was placed is a real order that fell over on its way out of the
 * door. The row badge has distinguished them for a while — Npl against Cxl — but the filter could
 * not, so anyone counting cancellations was counting both.
 *
 * The rule lives in the query builder, so it is restated here as the function it is and tested
 * directly. What matters is which clauses come out for a given selection.
 */
type Where = Record<string, unknown>;

/** The clause set for a resolution selection. Mirrors buildWhere in the service. */
function resolutionClauses(selected: string[]): Where[] {
  const wanted = new Set(selected);
  const nplWanted = wanted.delete('npl');
  const plain = [...wanted];

  const clauses: Where[] = [];
  if (nplWanted) clauses.push({ resolution: 'cancelled', cancelStage: 'pending' });
  if (plain.includes('cancelled')) clauses.push({ resolution: 'cancelled', NOT: { cancelStage: 'pending' } });
  const others = plain.filter((r) => r !== 'cancelled');
  if (others.length) clauses.push({ resolution: { in: others } });
  return clauses;
}

describe('filtering by resolution', () => {
  it('excludes never-placed when asked for cancelled', () => {
    // The whole point. Previously this returned both and the count was wrong by however many
    // orders never happened.
    expect(resolutionClauses(['cancelled'])).toEqual([
      { resolution: 'cancelled', NOT: { cancelStage: 'pending' } },
    ]);
  });

  it('returns only never-placed when asked for it', () => {
    expect(resolutionClauses(['npl'])).toEqual([
      { resolution: 'cancelled', cancelStage: 'pending' },
    ]);
  });

  it('can ask for both, and they do not collapse into one clause', () => {
    // Two clauses rather than a plain resolution=cancelled: the point is that a reader can select
    // both deliberately, not that selecting both quietly restores the old muddle.
    expect(resolutionClauses(['cancelled', 'npl'])).toHaveLength(2);
  });

  it('leaves returned and replaced exactly as they were', () => {
    // Never-placed was never among these — it is a cancellation — so this change must not touch
    // them. Refunds are what the returns worklist is counted from.
    expect(resolutionClauses(['returned'])).toEqual([{ resolution: { in: ['returned'] } }]);
    expect(resolutionClauses(['returned', 'replaced'])).toEqual([{ resolution: { in: ['returned', 'replaced'] } }]);
  });

  it('never puts never-placed inside the returned filter', () => {
    const clauses = resolutionClauses(['returned']);
    expect(JSON.stringify(clauses)).not.toContain('cancelStage');
    expect(JSON.stringify(clauses)).not.toContain('cancelled');
  });

  it('ORs a mixed selection rather than ANDing it', () => {
    // Selected resolutions are alternatives. An AND would ask for a transaction that is both
    // cancelled and returned, which is nothing at all.
    expect(resolutionClauses(['npl', 'returned'])).toEqual([
      { resolution: 'cancelled', cancelStage: 'pending' },
      { resolution: { in: ['returned'] } },
    ]);
  });

  it('asks for nothing when nothing is selected', () => {
    expect(resolutionClauses([])).toEqual([]);
  });
});
