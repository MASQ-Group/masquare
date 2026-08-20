import { getConnector } from '../../integrations/connectors';

export type SpApiRegion = 'na' | 'eu' | 'fe';

/**
 * Which SQS queue serves which SP-API region.
 *
 * Amazon will only publish to a queue in the SAME AWS region as the endpoint serving that
 * marketplace, so one queue cannot cover all of them: EU -> eu-west-1, NA -> us-east-1,
 * FE -> us-west-2. Getting this wrong is silent — every status reads healthy and no message is
 * ever delivered — so the ARN is derived here rather than typed in by hand.
 */
const QUEUE_ENV: Record<SpApiRegion, string[]> = {
  // AMZ_SQS_QUEUE_URL is the original single-region variable, kept as the EU fallback.
  eu: ['AMZ_SQS_QUEUE_URL_EU', 'AMZ_SQS_QUEUE_URL'],
  na: ['AMZ_SQS_QUEUE_URL_NA'],
  fe: ['AMZ_SQS_QUEUE_URL_FE'],
};

/** SP-API region for a marketplace code ('UK', 'DE', 'US', …), or null if unknown. */
export function regionOfMarketplace(marketplace: string | null | undefined): SpApiRegion | null {
  if (!marketplace) return null;
  const iso = marketplace.trim().toUpperCase();
  const mkt = getConnector('amazon')?.marketplaces?.find((m) => m.id === iso);
  const region = (mkt?.meta as { region?: string } | undefined)?.region;
  return region === 'na' || region === 'eu' || region === 'fe' ? region : null;
}

/** `https://sqs.eu-west-1.amazonaws.com/123/name` -> `arn:aws:sqs:eu-west-1:123:name`. */
export function sqsArnFromUrl(queueUrl: string | null | undefined): string | null {
  if (!queueUrl) return null;
  const m = /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d+)\/(.+)$/.exec(queueUrl.trim());
  return m ? `arn:aws:sqs:${m[1]}:${m[2]}:${m[3]}` : null;
}

export interface MarketplaceQueue {
  marketplace: string | null;
  region: SpApiRegion | null;
  queueUrl: string | null;
  queueArn: string | null;
  /** Name of the env var that supplies it, so an unset region says which one to set. */
  envVar: string | null;
  configured: boolean;
  message: string | null;
}

/** The queue this marketplace's notifications must be delivered to. */
export function queueForMarketplace(marketplace: string | null | undefined): MarketplaceQueue {
  const iso = marketplace?.trim().toUpperCase() ?? null;
  const region = regionOfMarketplace(iso);
  if (!region) {
    return { marketplace: iso, region: null, queueUrl: null, queueArn: null, envVar: null, configured: false, message: iso ? `Unknown Amazon marketplace ${iso}` : 'No marketplace selected' };
  }
  const names = QUEUE_ENV[region];
  const hit = names.find((n) => (process.env[n] ?? '').trim());
  const queueUrl = hit ? (process.env[hit] as string).trim() : null;
  const queueArn = sqsArnFromUrl(queueUrl);
  if (!queueUrl) {
    return { marketplace: iso, region, queueUrl: null, queueArn: null, envVar: names[0], configured: false, message: `No queue configured for the ${region.toUpperCase()} region — set ${names[0]} to an SQS queue in that region.` };
  }
  if (!queueArn) {
    return { marketplace: iso, region, queueUrl, queueArn: null, envVar: hit ?? names[0], configured: false, message: `${hit} is not a recognisable SQS queue URL.` };
  }
  return { marketplace: iso, region, queueUrl, queueArn, envVar: hit ?? names[0], configured: true, message: null };
}
