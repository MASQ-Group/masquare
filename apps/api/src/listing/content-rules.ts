/**
 * What each channel wants of our words, written down once.
 *
 * The cost of a new channel used to be a service, a tab, a connector tool, a prompt section and a
 * set of columns — five places to change, and five to forget. Most of what actually differs between
 * channels is four facts: how long a title may be, whether the channel shows our words at all,
 * whether a category has to be chosen first, and what format the description goes in.
 *
 * So those four are a declaration. Adding Shopify becomes an entry in this table plus whatever is
 * genuinely peculiar to Shopify — not another copy of the same machinery.
 *
 * PURE.
 */
import { EBAY_TITLE_MAX, renderTitle, type ProductCopy } from '../gather/product-copy';

export interface ChannelContentRules {
  label: string;
  /**
   * How long a title may be, or null where the channel never shows ours.
   *
   * Amazon shows its own catalogue page whatever we write, so a title for it is not a shorter
   * title — it is a field nobody reads.
   */
  titleMax: number | null;
  /** Whether a buyer on this channel ever reads words we wrote. */
  showsOurWords: boolean;
  /** Whether a category must be chosen here before anything else can be known. */
  needsCategory: boolean;
  /** How the description reaches the channel. `template` is rendered by maSquare from its parts. */
  descriptionFormat: 'html' | 'plain' | 'template' | null;
}

/**
 * The channels as they actually behave, not as they are grouped in the code.
 *
 * Amazon and Jinius both attach an offer to a catalogue entry somebody else owns, so neither reads
 * our copy — but Jinius takes a category when we CREATE a product in its catalogue, which Amazon
 * never lets us do. OnBuy sits in between: it shows our words only for a product we created there.
 */
export const CHANNEL_CONTENT_RULES: Record<string, ChannelContentRules> = {
  ebay: { label: 'eBay', titleMax: EBAY_TITLE_MAX, showsOurWords: true, needsCategory: true, descriptionFormat: 'template' },
  onbuy: { label: 'OnBuy', titleMax: 150, showsOurWords: true, needsCategory: true, descriptionFormat: 'html' },
  jinius: { label: 'Jinius', titleMax: 150, showsOurWords: true, needsCategory: true, descriptionFormat: 'plain' },
  amazon: { label: 'Amazon', titleMax: null, showsOurWords: false, needsCategory: false, descriptionFormat: null },
};

export const contentRulesFor = (channelType: string): ChannelContentRules | null =>
  CHANNEL_CONTENT_RULES[channelType] ?? null;

/** Where a piece of content on a channel came from. */
export type ContentSource = 'channel' | 'shared' | 'none';

export interface ChannelContentState {
  channelType: string;
  label: string;
  /** Null where the channel never shows our words — there is nothing to be ready. */
  title: { source: ContentSource; value: string | null; fits: boolean; limit: number | null } | null;
  description: { source: ContentSource } | null;
  category: { needed: boolean; chosen: boolean; name: string | null };
  /** What stops this channel being listed from what we hold. Marketplace checks happen on its tab. */
  blockers: string[];
}

export interface ChannelContentInput {
  channelType: string;
  /** The title this channel holds of its own, if any. */
  ownTitle?: string | null;
  /** Whether this channel holds a description of its own. */
  hasOwnDescription?: boolean;
  categoryRef?: string | null;
  categoryName?: string | null;
}

/**
 * What one channel has, and what it still wants — from what we hold, without asking a marketplace.
 *
 * Deliberately local. A readiness view that called eBay and OnBuy for every channel on every product
 * would be slow enough that nobody opened it, and the answer it gave would still be a snapshot. The
 * marketplace's own checks stay where they are, on the channel's tab, where they are asked for
 * deliberately and mean something at the moment they are asked.
 */
export function channelContentState(input: ChannelContentInput, copy: ProductCopy): ChannelContentState | null {
  const rules = contentRulesFor(input.channelType);
  if (!rules) return null;

  const blockers: string[] = [];
  const own = (input.ownTitle ?? '').trim();

  let title: ChannelContentState['title'] = null;
  if (rules.titleMax != null) {
    const shared = renderTitle(copy.title, rules.titleMax);
    const value = own || shared || null;
    const source: ContentSource = own ? 'channel' : shared ? 'shared' : 'none';
    const fits = !value || value.length <= rules.titleMax;
    title = { source, value, fits, limit: rules.titleMax };
    if (!value) blockers.push('No title — nothing written here and nothing to assemble one from.');
    // A title over the limit is refused by the marketplace, so it is a blocker here rather than a note.
    else if (!fits) blockers.push(`The title is ${value.length} characters and ${rules.label} allows ${rules.titleMax}.`);
  }

  let description: ChannelContentState['description'] = null;
  if (rules.showsOurWords && rules.descriptionFormat) {
    const shared = (copy.paragraphs ?? []).length > 0;
    const source: ContentSource = input.hasOwnDescription ? 'channel' : shared ? 'shared' : 'none';
    description = { source };
    if (source === 'none') blockers.push('No description — nothing written here and no paragraphs to render.');
  }

  const chosen = !!(input.categoryRef ?? '').trim();
  if (rules.needsCategory && !chosen) {
    blockers.push(`No ${rules.label} category chosen — it decides which fields exist.`);
  }

  return {
    channelType: input.channelType,
    label: rules.label,
    title,
    description,
    category: { needed: rules.needsCategory, chosen, name: input.categoryName ?? null },
    blockers,
  };
}

/** One sentence for the whole product: how many channels are ready, and what the rest are waiting on. */
export function contentSummary(states: readonly ChannelContentState[]): string {
  if (!states.length) return 'No channel here shows words of ours.';
  const ready = states.filter((s) => !s.blockers.length);
  if (ready.length === states.length) return `Ready on all ${states.length} channels.`;
  const waiting = states.filter((s) => s.blockers.length);
  // Named rather than counted: "2 channels need something" makes a person open all of them to find out.
  return `Ready on ${ready.length} of ${states.length}. Waiting: ${waiting.map((s) => s.label).join(', ')}.`;
}
