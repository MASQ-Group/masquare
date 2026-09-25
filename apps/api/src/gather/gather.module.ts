import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ManufacturerSourceService } from './manufacturer-source.service';
import { ProductFactsService } from './product-facts.service';
import { WebResearchService } from './web-research.service';

/**
 * The sources a gather can read, and the rules it reads them by.
 *
 * Separate from `listing` because the rules are not eBay's. The same provenance model and the same
 * "manufacturer first, two sources otherwise" standard govern product content generally; eBay item
 * specifics are simply the first thing built on top of them.
 */
@Module({
  imports: [PrismaModule],
  providers: [ManufacturerSourceService, ProductFactsService, WebResearchService],
  exports: [ManufacturerSourceService, ProductFactsService, WebResearchService],
})
export class GatherModule {}
