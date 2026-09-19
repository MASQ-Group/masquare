import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';
import { DutyRulesService, type DutyRuleInput } from './duty-rules.service';

/**
 * The FedEx duty rules, under Global settings: a business decision about how we ship, made once and
 * applied to every order booked, which is the same kind of setting as a country's VAT rate.
 */
@ApiTags('fedex-duty-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fedex-duty-rules')
@AccessArea('global_settings')
export class DutyRulesController {
  constructor(private readonly svc: DutyRulesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() body: DutyRuleInput, @CurrentUser() user: AuthUser) {
    return this.svc.create(body ?? {}, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: DutyRuleInput, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, body ?? {}, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
