import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { NoAccessCheck } from '../access/access.decorators';
import { CustomerUsersService } from './customer-users.service';

/**
 * Setting a password from an invitation.
 *
 * Public, and it has to be: the person holding the link has no account they can sign in to yet —
 * that is what the link is for. The token is the whole of the authorisation, which is why it is 32
 * random bytes, single-use, expires in a week, and is stored only as a hash.
 *
 * Nothing here says whether an address is known to us. A refused link reads the same whether it was
 * never real, has been used, or belongs to a disabled account, so the page cannot be used to find
 * out who has an account.
 */
@ApiTags('invites')
@Controller('invites')
@NoAccessCheck()
export class InvitesController {
  constructor(private readonly users: CustomerUsersService) {}

  /** What this link is worth, for the page the recipient lands on. */
  @Public()
  @Get(':token')
  describe(@Param('token') token: string) {
    return this.users.describeInvite(token);
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  accept(@Param('token') token: string, @Body() body: { password?: string }) {
    return this.users.acceptInvite(token, body?.password ?? '');
  }
}
