import { Module } from '@nestjs/common';
import { ManufacturerSourceService } from './manufacturer-source.service';
import { WebResearchService } from './web-research.service';

/**
 * The sources a gather can read, and the rules it reads them by.
 *
 * Separate from `listing` because the rules are not eBay's. The same provenance model and the same
 * "manufacturer first, two sources otherwise" standard govern product content generally; eBay item
 * specifics are simply the first thing built on top of them.
 */
@Module({
  providers: [ManufacturerSourceService, WebResearchService],
  exports: [ManufacturerSourceService, WebResearchService],
})
export class GatherModule {}
