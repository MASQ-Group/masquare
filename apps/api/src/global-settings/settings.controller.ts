import { Body, Controller, Delete, Get, NotFoundException, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AccessArea, NoAccessCheck } from '../access/access.decorators';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
@AccessArea('global_settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  get() {
    return this.svc.get();
  }

  @Put()
  @UseGuards(AdminGuard)
  update(@Body() dto: UpdateSettingsDto) {
    return this.svc.update(dto);
  }

  /**
   * The browser tab icon, for `<link rel="icon">` in index.html.
   *
   * Public because the browser asks for it before anyone signs in — on the sign-in page itself — and
   * it reveals nothing but an image. A redirect rather than the bytes, so the image is served by
   * storage, and `no-cache` on the redirect so a new icon shows on the next load instead of a week later.
   */
  @Get('favicon')
  @Public()
  @NoAccessCheck()
  async favicon(@Res() res: Response) {
    const url = await this.svc.faviconUrl();
    if (!url) throw new NotFoundException('No favicon set');
    res.setHeader('Cache-Control', 'no-cache');
    res.redirect(302, url);
  }

  @Post('favicon')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file'))
  setFavicon(@UploadedFile() file: any) {
    return this.svc.setFavicon(file);
  }

  @Delete('favicon')
  @UseGuards(AdminGuard)
  removeFavicon() {
    return this.svc.removeFavicon();
  }
}
