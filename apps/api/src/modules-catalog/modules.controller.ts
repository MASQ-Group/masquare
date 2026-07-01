import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { SetParticipantsDto } from './dto/sharing.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('modules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  list() {
    return this.modules.list();
  }

  @Put(':key/participants')
  @UseGuards(AdminGuard)
  setParticipants(@Param('key') key: string, @Body() dto: SetParticipantsDto) {
    return this.modules.setParticipants(key, dto.companyIds);
  }
}
