import { describe, it, expect, afterEach } from 'vitest';
import { sqsArnFromUrl, regionOfMarketplace, queueForMarketplace } from './notification-queues';

const KEYS = ['AMZ_SQS_QUEUE_URL', 'AMZ_SQS_QUEUE_URL_EU', 'AMZ_SQS_QUEUE_URL_NA', 'AMZ_SQS_QUEUE_URL_FE'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('notification queues', () => {
  it('derives an ARN from a queue URL', () => {
    expect(sqsArnFromUrl('https://sqs.eu-west-1.amazonaws.com/631245465175/masquare-spapi-notifications'))
      .toBe('arn:aws:sqs:eu-west-1:631245465175:masquare-spapi-notifications');
  });

  it('rejects anything that is not an SQS queue URL', () => {
    expect(sqsArnFromUrl('not-a-url')).toBeNull();
    expect(sqsArnFromUrl(null)).toBeNull();
  });

  it('maps marketplaces to their SP-API region', () => {
    expect(regionOfMarketplace('UK')).toBe('eu');
    expect(regionOfMarketplace('de')).toBe('eu');
    expect(regionOfMarketplace('US')).toBe('na');
    expect(regionOfMarketplace('AU')).toBe('fe');
    expect(regionOfMarketplace('ZZ')).toBeNull();
  });

  it('resolves the EU queue, preferring the region-specific variable', () => {
    process.env.AMZ_SQS_QUEUE_URL = 'https://sqs.eu-north-1.amazonaws.com/1/old';
    process.env.AMZ_SQS_QUEUE_URL_EU = 'https://sqs.eu-west-1.amazonaws.com/1/new';
    const q = queueForMarketplace('UK');
    expect(q.configured).toBe(true);
    expect(q.queueArn).toBe('arn:aws:sqs:eu-west-1:1:new');
  });

  it('falls back to the original single-region variable for EU', () => {
    delete process.env.AMZ_SQS_QUEUE_URL_EU;
    process.env.AMZ_SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/1/q';
    expect(queueForMarketplace('DE').queueArn).toBe('arn:aws:sqs:eu-west-1:1:q');
  });

  it('never serves an EU queue for a marketplace in another region', () => {
    process.env.AMZ_SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/1/q';
    delete process.env.AMZ_SQS_QUEUE_URL_NA;
    const q = queueForMarketplace('US');
    expect(q.configured).toBe(false);
    expect(q.queueArn).toBeNull();
    expect(q.message).toContain('AMZ_SQS_QUEUE_URL_NA');
  });
});
