import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { StorageService } from '../../storage/storage.service';

/**
 * Product images as OnBuy will take them.
 *
 * OnBuy downloads each image from the URL it is given, and accepts only JPG, PNG or GIF, at most
 * 1,000 × 1,000 pixels and 10 MB. Ours are whatever was uploaded — 1,200-pixel JPEGs, 7 MB PNGs,
 * WebP — so each is converted once to a JPEG that fits inside 1,000 × 1,000, on a white ground
 * (a transparent PNG would otherwise turn black), and kept in the public product-image bucket
 * beside the original. Product photographs only: nothing personal goes here.
 *
 * Keyed on the media row, so the second product listing the same picture, or a retry, reuses the
 * copy rather than converting it again.
 */
@Injectable()
export class OnbuyImagesService {
  private readonly logger = new Logger(OnbuyImagesService.name);

  constructor(private readonly storage: StorageService) {}

  static readonly MAX_SIDE = 1000;

  async prepare(media: Array<{ id: string; url: string }>, limit = 10): Promise<{ urls: string[]; problems: string[] }> {
    const urls: string[] = [];
    const problems: string[] = [];
    for (const [i, m] of media.slice(0, limit).entries()) {
      const key = `onbuy/${m.id}.jpg`;
      const publicUrl = this.storage.publicUrl(key);
      try {
        const head = await fetch(publicUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (head?.ok) { urls.push(publicUrl); continue; }

        const res = await fetch(m.url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`the original could not be downloaded (${res.status})`);
        const original = Buffer.from(await res.arrayBuffer());
        const jpeg = await sharp(original)
          .rotate() // honour the camera's orientation before it is lost in the re-encode
          .resize(OnbuyImagesService.MAX_SIDE, OnbuyImagesService.MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 86, mozjpeg: true })
          .toBuffer();
        urls.push(await this.storage.putObject(key, jpeg, 'image/jpeg'));
      } catch (e: any) {
        this.logger.warn(`OnBuy image ${m.id} could not be prepared: ${e?.message ?? e}`);
        problems.push(`Image ${i + 1} could not be prepared for OnBuy (${e?.message ?? 'unknown error'}) and was left out.`);
      }
    }
    return { urls, problems };
  }
}
