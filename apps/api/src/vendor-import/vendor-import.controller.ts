import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { SavedMapping, VendorImportService } from './vendor-import.service';

@ApiTags('vendor-import')
@UseGuards(JwtAuthGuard)
@Controller('vendor-import')
export class VendorImportController {
  constructor(private readonly svc: VendorImportService) {}

  /**
   * Read an uploaded price file and propose a column mapping. Read-only: nothing is written to
   * any product here, so it is safe to re-run while the user tries sheets and corrections.
   */
  @Post('analyse')
  @UseInterceptors(FileInterceptor('file'))
  analyse(
    @UploadedFile() file: any,
    @Body() body: { vendorId?: string; sheet?: string; profileId?: string },
  ) {
    return this.svc.analyse(file, body?.vendorId || undefined, body?.sheet || undefined, body?.profileId || undefined);
  }

  @Get('profiles')
  listProfiles(@Query('vendorId') vendorId?: string) {
    return this.svc.listProfiles(vendorId || undefined);
  }

  @Post('profiles')
  saveProfile(
    @Body() body: { id?: string; vendorId: string; name: string; sheetName?: string | null; currency: string; mapping: SavedMapping },
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.saveProfile(body, user.sub);
  }

  @Delete('profiles/:id')
  removeProfile(@Param('id') id: string) {
    return this.svc.removeProfile(id);
  }
}
