import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CompanyScope } from './company-scope.interceptor';

const scopeOf = (ctx: ExecutionContext): CompanyScope =>
  (ctx.switchToHttp().getRequest().companyScope as CompanyScope) ?? { allowedIds: [], activeId: null, visibleIds: [] };

/** Company ids a list/read may return: the active company, else everything the user is allowed. */
export const VisibleCompanies = createParamDecorator((_d, ctx: ExecutionContext): string[] => scopeOf(ctx).visibleIds);

/** All company ids the user may access. */
export const AllowedCompanies = createParamDecorator((_d, ctx: ExecutionContext): string[] => scopeOf(ctx).allowedIds);

/** The active company id, or null when a multi-company user hasn't selected one. */
export const ActiveCompany = createParamDecorator((_d, ctx: ExecutionContext): string | null => scopeOf(ctx).activeId);

/**
 * The company a write must belong to: the active company, or the sole allowed one.
 * Throws if the user has several companies and hasn't picked one — a create can't
 * guess which company owns the new record.
 */
export const WriteCompany = createParamDecorator((_d, ctx: ExecutionContext): string => {
  const s = scopeOf(ctx);
  const id = s.activeId ?? (s.allowedIds.length === 1 ? s.allowedIds[0] : null);
  if (!id) throw new BadRequestException('Select a company first — this record must belong to one.');
  return id;
});
