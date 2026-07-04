import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CustomsFxService } from './customs-fx.service';

@ApiTags('customs-fx')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customs-fx')
export class CustomsFxController {
  constructor(private readonly svc: CustomsFxService) {}

  @Get()
  list(@Query('year') year?: string) {
    return this.svc.list(year ? Number(year) : undefined);
  }

  @Post('sync')
  @UseGuards(AdminGuard)
  sync() {
    return this.svc.sync('manual');
  }
}
