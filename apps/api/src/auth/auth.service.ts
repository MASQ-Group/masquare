import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.deletedAt || user.status === 'disabled') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });
    return {
      accessToken: token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    };
  }

  /** Full profile for the authenticated user, including the companies and modules
   *  they may use. Admins implicitly hold every grant (Module 1 §4.8). */
  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }

    const companies = user.isAdmin
      ? await this.prisma.company.findMany({
          where: { deletedAt: null },
          orderBy: { officialName: 'asc' },
        })
      : (
          await this.prisma.userCompanyAccess.findMany({
            where: { userId: user.id, company: { deletedAt: null } },
            include: { company: true },
          })
        ).map((row) => row.company);

    const modules = user.isAdmin
      ? await this.prisma.module.findMany({ orderBy: { sortOrder: 'asc' } })
      : (
          await this.prisma.userModuleAccess.findMany({
            where: { userId: user.id },
            include: { module: true },
          })
        )
          .map((row) => row.module)
          .sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isAdmin: user.isAdmin,
      status: user.status,
      companies: companies.map((c) => ({
        id: c.id,
        officialName: c.officialName,
        registrationNumber: c.registrationNumber,
        addressCountry: c.addressCountry,
        // 'orders' means this company's Amazon account is connected for order history only, so the
        // navigation hides the pages that would act on a seller account. The API refuses those
        // calls regardless — this only stops the app offering what it will not do.
        amazonScope: c.amazonScope,
      })),
      modules: modules.map((m) => ({ key: m.key, name: m.name, status: m.status })),
    };
  }
}
