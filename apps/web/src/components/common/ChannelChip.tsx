import { useQuery } from '@tanstack/react-query';
import { salesChannelsApi } from '../../lib/api';

/** Fallback when a channel has no colours set (or isn't in the list yet). */
export const NEUTRAL_CHIP = { bg: '#F1F3F5', text: '#495057' };
const NEUTRAL = NEUTRAL_CHIP;

/* Chip palette per native country, as an ORDERED list of variants drawn from that flag's own
 * colours. Channels sharing a country take different variants so they stay tellable apart.
 * Kept in step with FLAG_CHIP_VARIANTS in apps/api/prisma/seed.ts, which seeds existing
 * channels; this copy pre-fills a NEW channel when its native country is chosen. */
export const FLAG_CHIP_VARIANTS: Record<string, { bg: string; text: string }[]> = {
  CY: [
    { bg: '#FDF1E0', text: '#B45F06' },
    { bg: '#EDF0E2', text: '#4A5730' },
    { bg: '#D57800', text: '#FFFFFF' },
    { bg: '#4E5B31', text: '#FFFFFF' },
    { bg: '#F6DDBB', text: '#8A4A05' },
  ],
  GB: [
    { bg: '#E6E9F0', text: '#012169' },
    { bg: '#FBE9EC', text: '#C8102E' },
    { bg: '#012169', text: '#FFFFFF' },
  ],
  DE: [{ bg: '#FFF6D6', text: '#7A5C00' }, { bg: '#FCE8E8', text: '#C1121F' }],
  ES: [{ bg: '#FBE9E9', text: '#AA151B' }, { bg: '#FFF7DA', text: '#8A6A00' }],
  FR: [{ bg: '#E6EEF6', text: '#0055A4' }, { bg: '#FDEBEA', text: '#C5342A' }],
  IT: [{ bg: '#E6F4EC', text: '#007A3D' }, { bg: '#FBEAEB', text: '#CD212A' }],
  AU: [{ bg: '#E7EBF5', text: '#00247D' }, { bg: '#FDE9E9', text: '#C41E1E' }],
  US: [{ bg: '#E9E9F1', text: '#3C3B6E' }, { bg: '#FAE9EB', text: '#B22234' }],
  CA: [{ bg: '#FDE9EA', text: '#C8102E' }, { bg: '#C8102E', text: '#FFFFFF' }],
  AE: [{ bg: '#E6F5EC', text: '#00753C' }],
  BE: [{ bg: '#FFF8DC', text: '#8A6D00' }],
  GR: [{ bg: '#E6EFF7', text: '#0D5EAF' }],
  IE: [{ bg: '#FFF1E3', text: '#C86A1A' }],
  JP: [{ bg: '#FCE8EC', text: '#BC002D' }],
  MX: [{ bg: '#E4EFE9', text: '#00614A' }],
  NL: [{ bg: '#FFF0E0', text: '#C25E00' }],
  PL: [{ bg: '#FCE9EC', text: '#C4123C' }],
  SA: [{ bg: '#E4EEE7', text: '#14532D' }],
  SE: [{ bg: '#E5F0F6', text: '#005E93' }],
  SG: [{ bg: '#FDEAEC', text: '#C31F2C' }],
};

/** Chip colours to pre-fill for a country — the first variant not already used by another
 *  channel of that country, so a new channel doesn't clash with its siblings. */
export function chipForCountry(isoCode?: string | null, taken: { bg?: string | null; text?: string | null }[] = []) {
  const variants = FLAG_CHIP_VARIANTS[(isoCode ?? '').toUpperCase()];
  if (!variants?.length) return NEUTRAL_CHIP;
  const used = new Set(taken.map((t) => `${t.bg ?? ''}|${t.text ?? ''}`));
  return variants.find((v) => !used.has(`${v.bg}|${v.text}`)) ?? variants[0];
}

/** Resolve every channel's chip colours by id. Backed by the same cached `sales-channels`
 *  query the pages already use, so this costs no extra request. */
export function useChannelChips() {
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const byId = new Map(channels.map((c) => [c.id, { bg: c.chipBgColor ?? NEUTRAL.bg, text: c.chipTextColor ?? NEUTRAL.text }]));
  return (channelId?: string | null) => (channelId ? byId.get(channelId) ?? NEUTRAL : NEUTRAL);
}

/** A sales channel shown as a coloured chip (colours come from its native country's flag,
 *  editable per channel in Global settings → Sales Channels). */
export function ChannelChip({ name, bg, text, className }: { name?: string | null; bg?: string | null; text?: string | null; className?: string }) {
  if (!name) return <span className="text-n-400">—</span>;
  return (
    <span
      className={`tag whitespace-nowrap ${className ?? ''}`}
      style={{ background: bg ?? NEUTRAL.bg, color: text ?? NEUTRAL.text }}
    >
      {name}
    </span>
  );
}
