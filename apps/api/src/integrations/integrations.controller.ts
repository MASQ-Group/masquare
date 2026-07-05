import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, TestIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';

// Admin-only across the board: managing third-party API credentials is privileged.
@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get('connectors')
  connectors() {
    return this.svc.connectors();
  }

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Body() dto: TestIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.test(id, dto.mode ?? 'test', user.sub);
  }

  @Post(':id/preview-orders')
  previewOrders(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.previewOrders(id, user.sub);
  }

  @Post(':id/preview-mapping')
  previewMapping(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.previewMapping(id, user.sub);
  }

  @Post(':id/verify-mapping')
  verifyMapping(@Param('id') id: string, @Body() dto: { confirmed?: boolean }, @CurrentUser() user: AuthUser) {
    return this.svc.verifyMapping(id, dto?.confirmed !== false, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.sub);
  }
}
