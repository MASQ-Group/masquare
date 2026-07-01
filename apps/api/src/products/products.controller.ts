import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductsService, type ProductQuery } from './products.service';
import { CreateProductDto, ReorderMediaDto, UpdateProductDto } from './dto/product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';

const toArray = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('field') field?: string,
    @Query('vendorId') vendorId?: string | string[],
    @Query('brandId') brandId?: string | string[],
    @Query('fulfilmentTypeId') fulfilmentTypeId?: string | string[],
    @Query('productTypeId') productTypeId?: string | string[],
    @Query('categoryId') categoryId?: string | string[],
    @Query('country') country?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ProductQuery = {
      q, field, country,
      vendorId: toArray(vendorId),
      brandId: toArray(brandId),
      fulfilmentTypeId: toArray(fulfilmentTypeId),
      productTypeId: toArray(productTypeId),
      categoryId: toArray(categoryId),
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.products.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    return this.products.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.products.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }

  @Post(':id/media')
  @UseInterceptors(FileInterceptor('file'))
  addMedia(@Param('id') id: string, @UploadedFile() file: any) {
    return this.products.addMedia(id, file);
  }

  @Put(':id/media/order')
  reorderMedia(@Param('id') id: string, @Body() dto: ReorderMediaDto) {
    return this.products.reorderMedia(id, dto.orderedIds);
  }

  @Delete(':id/media/:mediaId')
  deleteMedia(@Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.products.deleteMedia(id, mediaId);
  }
}
