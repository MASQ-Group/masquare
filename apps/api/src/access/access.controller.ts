import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessService } from './access.service';
import { NoAccessCheck } from './access.decorators';
import { AREAS, CAPABILITIES, areasByGroup } from './catalogue';

@ApiTags('access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
// Both routes describe only the caller and the catalogue of what CAN be granted. Neither
// reveals anything about anyone else, and the Access page needs them before it can render
// what the user is allowed to see.
@NoAccessCheck()
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  /**
   * The catalogue itself, so the Access page renders from the same definition the guard enforces
   * rather than a copy that can drift out of step with it.
   *
   * Readable by any signed-in user: it is a list of what CAN be granted, not what anyone holds.
   */
  @Get('catalogue')
  catalogue() {
    return { areas: AREAS, groups: areasByGroup(), capabilities: CAPABILITIES };
  }

  /** What the caller themselves may do — what the sidebar and the in-page buttons are built from. */
  @Get('me')
  async mine(@CurrentUser() user: AuthUser) {
    return this.access.forUser(user.sub);
  }
}
