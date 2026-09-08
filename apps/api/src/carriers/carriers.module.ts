import { Module } from '@nestjs/common';
import { CarriersService } from './carriers.service';
import { CarriersController } from './carriers.controller';
import { CryptoModule } from '../crypto/crypto.module';
import { TrackingSweepService } from './tracking-sweep.service';

/**
 * Carrier accounts and, in time, everything that runs on them — rating, labels, pickups, tracking.
 *
 * Exported because the shipments module will need `token()` once there is more than authentication
 * to do, and every FedEx call has to go through the one cache.
 */
@Module({
  imports: [CryptoModule],
  controllers: [CarriersController],
  providers: [CarriersService, TrackingSweepService],
  exports: [CarriersService],
})
export class CarriersModule {}
