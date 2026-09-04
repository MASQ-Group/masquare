import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';
import { SearchService, type SearchScope } from './search.service';
import { AccessArea } from '../access/access.decorators';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
// Global search reaches across all three; holding any one is reason enough to search.
@AccessArea('products', 'sales_transactions', 'inventory')
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Get()
  search(@Query('q') q = '', @Query('scope') scope: SearchScope = 'all', @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.search(q, scope, user, companyIds);
  }
}
