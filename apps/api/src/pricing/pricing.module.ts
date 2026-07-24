import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingFxService } from './fx.service';

/** Forward-looking pricing: what to list a product at, and what it earns. Read-only —
 *  it calculates from the catalogue, channels and shipping tables but writes nothing. */
@Module({
  imports: [PrismaModule],
  controllers: [PricingController],
  providers: [PricingService, PricingFxService],
  exports: [PricingService],
})
export class PricingModule {}
