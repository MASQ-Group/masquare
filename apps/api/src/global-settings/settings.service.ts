import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Platform settings are a singleton; create defaults on first read. */
  async get() {
    const existing = await this.prisma.platformSettings.findFirst();
    if (existing) return existing;
    return this.prisma.platformSettings.create({ data: {} });
  }

  async update(dto: UpdateSettingsDto) {
    const current = await this.get();
    return this.prisma.platformSettings.update({
      where: { id: current.id },
      data: { measurementSystem: dto.measurementSystem, dateFormat: dto.dateFormat },
    });
  }
}
