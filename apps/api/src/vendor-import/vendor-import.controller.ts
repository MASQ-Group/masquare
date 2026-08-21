import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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

  /**
   * Match the file's rows to our products using the confirmed mapping. Read-only — this answers
   * "how much of this file do we recognise" before any change is proposed.
   */
  @Post('match')
  @UseInterceptors(FileInterceptor('file'))
  match(
    @UploadedFile() file: any,
    @Body() body: { vendorId: string; sheet?: string; mapping?: string },
  ) {
    return this.svc.match(file, body?.vendorId, this.parseMapping(body?.mapping), body?.sheet || undefined);
  }

  /** Multipart carries the mapping as text, so it arrives JSON-encoded. */
  private parseMapping(raw?: string): Record<string, number> {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new BadRequestException('The column mapping could not be read.');
    }
  }

  /** What applying this file WOULD change. Writes nothing. */
  @Post('preview')
  @UseInterceptors(FileInterceptor('file'))
  preview(@UploadedFile() file: any, @Body() body: { vendorId: string; sheet?: string; mapping?: string; currency?: string }) {
    return this.svc.preview(file, body?.vendorId, this.parseMapping(body?.mapping), body?.currency ?? 'EUR', body?.sheet || undefined);
  }

  /** Apply the file. Reversible: every previous value is recorded against the run. */
  @Post('apply')
  @UseInterceptors(FileInterceptor('file'))
  apply(
    @UploadedFile() file: any,
    @Body() body: { vendorId: string; sheet?: string; mapping?: string; currency?: string; profileId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.apply(file, body?.vendorId, this.parseMapping(body?.mapping), body?.currency ?? 'EUR', body?.sheet || undefined, body?.profileId || undefined, user.sub);
  }

  @Get('runs')
  listRuns(@Query('vendorId') vendorId?: string) {
    return this.svc.listRuns(vendorId || undefined);
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.svc.getRun(id);
  }

  @Post('runs/:id/rollback')
  rollback(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.rollback(id, user.sub);
  }

  @Get('aliases')
  listAliases(@Query('vendorId') vendorId: string) {
    return this.svc.listAliases(vendorId);
  }

  @Post('aliases')
  saveAlias(@Body() body: { vendorId: string; vendorSku: string; productId: string }, @CurrentUser() user: AuthUser) {
    return this.svc.saveAlias(body, user.sub);
  }

  @Delete('aliases/:id')
  removeAlias(@Param('id') id: string) {
    return this.svc.removeAlias(id);
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
