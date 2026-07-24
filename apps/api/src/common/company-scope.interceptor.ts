import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CompanyScopeService } from './company-scope';
import type { AuthUser } from './current-user.decorator';

export interface CompanyScope {
  allowedIds: string[];
  activeId: string | null;
  visibleIds: string[];
}

/**
 * Populates `req.companyScope` for every authenticated request from the user's grants
 * and the `x-company-id` header (validated). Owned controllers read it via the
 * @ActiveCompany / @VisibleCompanies decorators — the client can never widen its scope.
 */
@Injectable()
export class CompanyScopeInterceptor implements NestInterceptor {
  constructor(private readonly scope: CompanyScopeService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (user?.sub) {
      const header = req.headers['x-company-id'];
      const requested = Array.isArray(header) ? header[0] : header;
      req.companyScope = await this.scope.resolve(user, requested ?? null);
    }
    return next.handle();
  }
}
