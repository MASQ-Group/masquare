import { Module } from '@nestjs/common';
import { CustomsFxService } from './customs-fx.service';
import { CustomsFxController } from './customs-fx.controller';

@Module({
  controllers: [CustomsFxController],
  providers: [CustomsFxService],
  exports: [CustomsFxService],
})
export class CustomsFxModule {}
