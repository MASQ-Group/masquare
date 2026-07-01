import { Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import {
  CreateBrandDto, UpdateBrandDto,
  CreateProductTypeDto, UpdateProductTypeDto,
  CreateFulfilmentTypeDto, UpdateFulfilmentTypeDto,
} from './dto/simple.dto';

// --- Brands ---------------------------------------------------------------
@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}
  list(q?: string) {
    return this.prisma.brand.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
    });
  }
  async get(id: string) {
    const row = await this.prisma.brand.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Brand not found');
    return row;
  }
  create(dto: CreateBrandDto, actorId?: string) {
    return this.prisma.brand.create({ data: { ...dto, createdById: actorId, updatedById: actorId } });
  }
  async update(id: string, dto: UpdateBrandDto, actorId?: string) {
    await this.get(id);
    return this.prisma.brand.update({ where: { id }, data: { ...dto, updatedById: actorId } });
  }
  async remove(id: string) {
    await this.get(id);
    await this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('brands')
export class BrandsController {
  constructor(private readonly svc: BrandsService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Post() create(@Body() dto: CreateBrandDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateBrandDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

// --- Product types --------------------------------------------------------
@Injectable()
export class ProductTypesService {
  constructor(private readonly prisma: PrismaService) {}
  list(q?: string) {
    return this.prisma.productType.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
    });
  }
  async get(id: string) {
    const row = await this.prisma.productType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Product type not found');
    return row;
  }
  create(dto: CreateProductTypeDto, actorId?: string) {
    return this.prisma.productType.create({ data: { ...dto, createdById: actorId, updatedById: actorId } });
  }
  async update(id: string, dto: UpdateProductTypeDto, actorId?: string) {
    await this.get(id);
    return this.prisma.productType.update({ where: { id }, data: { ...dto, updatedById: actorId } });
  }
  async remove(id: string) {
    await this.get(id);
    await this.prisma.productType.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-types')
export class ProductTypesController {
  constructor(private readonly svc: ProductTypesService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Post() create(@Body() dto: CreateProductTypeDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProductTypeDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

// --- Fulfilment types -----------------------------------------------------
@Injectable()
export class FulfilmentTypesService {
  constructor(private readonly prisma: PrismaService) {}
  list(q?: string) {
    return this.prisma.fulfilmentType.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
    });
  }
  async get(id: string) {
    const row = await this.prisma.fulfilmentType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Fulfilment type not found');
    return row;
  }
  create(dto: CreateFulfilmentTypeDto, actorId?: string) {
    return this.prisma.fulfilmentType.create({ data: { ...dto, createdById: actorId, updatedById: actorId } });
  }
  async update(id: string, dto: UpdateFulfilmentTypeDto, actorId?: string) {
    await this.get(id);
    return this.prisma.fulfilmentType.update({ where: { id }, data: { ...dto, updatedById: actorId } });
  }
  async remove(id: string) {
    await this.get(id);
    await this.prisma.fulfilmentType.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fulfilment-types')
export class FulfilmentTypesController {
  constructor(private readonly svc: FulfilmentTypesService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Post() create(@Body() dto: CreateFulfilmentTypeDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateFulfilmentTypeDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
