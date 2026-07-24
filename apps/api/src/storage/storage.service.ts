import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

/** S3-compatible object storage. Local dev points at MinIO; prod points at GCS/S3 —
 *  same SDK, only the endpoint/credentials differ (set via env). Media upload is
 *  exercised from Module 3; the seam is built here in the foundation. */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.STORAGE_BUCKET ?? 'masquare-media';
  private readonly endpoint = process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000';
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      endpoint: this.endpoint,
      forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'masquare',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'masquare123',
      },
    });
  }

  /** Idempotently ensure the media bucket exists. Safe to call at startup. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(
          `Could not ensure bucket "${this.bucket}" — storage may be offline. ${String(err)}`,
        );
      }
    }
  }

  async putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    // Cloud object stores (e.g. Cloudflare R2) serve public objects from a domain
    // that differs from the S3 API endpoint. STORAGE_PUBLIC_URL overrides the base;
    // it falls back to the endpoint for MinIO/local where they coincide.
    const base = process.env.STORAGE_PUBLIC_URL ?? this.endpoint;
    return `${base.replace(/\/$/, '')}/${this.bucket}/${key}`;
  }
}
