import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { NoAccessCheck, PortalRoute } from '../access/access.decorators';
import { Public } from './public.decorator';

@ApiTags('auth')
@Controller('auth')
// Signing in and reading your own profile: there is no grant to check yet.
@NoAccessCheck()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // The only route on this controller with no user at all. `me` below deliberately is NOT public:
  // it reports your own profile and has to know whose.
  @PortalRoute()
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // Portal users sign in here too, and reading your own profile is how the app learns which of the
  // two you are.
  @PortalRoute()
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
