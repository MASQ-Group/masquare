import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The page header is one height, on every page and every tab.
 *
 * Pages legitimately offer different actions per tab — Shipments hides Export and Import where
 * neither describes what you are looking at, Availability drops its primary button and its filters
 * on two of its three tabs. When a slot is rendered only if something fills it, the bar loses that
 * slot's height and every row on the page jumps up to meet it. Measured on Shipments: 107px on four
 * tabs and 99px on the other two.
 *
 * So both slots are always rendered, each with a floor equal to the tallest control its row holds.
 * That is a property of markup rather than behaviour, and jsdom does no layout, so there is nothing
 * to measure here — the file is read instead, the way route-coverage reads its controllers. It
 * catches the regression that actually happens: somebody wrapping a slot in `{actions && ...}`
 * again because an empty div looked pointless.
 *
 * The heights themselves were checked in a browser against every tab of the three pages that vary
 * their slots; all eleven came to 107px.
 */

const SOURCE = readFileSync(join(__dirname, 'PageHeader.tsx'), 'utf8');

describe('the header reserves its slots', () => {
  it('never renders the actions slot conditionally', () => {
    // `{actions && (` or `{(actions || primary) && (` — any guard around the whole slot.
    expect(SOURCE).not.toMatch(/\{\s*\(?\s*actions\b[^}]*&&\s*\(/);
    expect(SOURCE).not.toMatch(/\{\s*\(?[^}]*\bprimary\)?\s*&&\s*\(\s*\n?\s*<div/);
  });

  it('never renders the toolbar slot conditionally', () => {
    expect(SOURCE).not.toMatch(/\{\s*toolbar\s*&&\s*\(/);
  });

  it('gives each slot a height floor', () => {
    // The actions row holds .hbtn and .hbtn-primary, both 32px.
    expect(SOURCE).toMatch(/min-h-8[^"`]*"[^>]*>\s*\n?\s*\{actions\}/);
    // The toolbar row holds dense Selects, which are h-9. A 32px floor here left four pixels of
    // movement between a tab with filters and a tab without.
    expect(SOURCE).toContain('min-h-9');
  });

  it('still renders both slots', () => {
    expect(SOURCE).toContain('{actions}');
    expect(SOURCE).toContain('{toolbar}');
  });
});
