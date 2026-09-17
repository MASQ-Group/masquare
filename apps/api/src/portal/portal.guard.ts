import { CanActivate, ExecutionContext, ForbiddenException, Injectable, createParamDecorator } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LOGISTICS, hasType } from '../customers/customer-types';

/**
 * The portal's own door.
 *
 * Establishes one fact and puts it on the request: which customer this person belongs to. Every
 * route then works from that, never from anything the caller sent — there is no customer id in a
 * path, a body or a query string anywhere in the portal, so there is nothing to tamper with.
 *
 * It refuses three kinds of caller, all with the same answer, because the difference is none of
 * their business: one of our own staff (who have the platform instead), somebody whose customer no
 * longer takes the logistics service, and somebody whose customer has been deactivated.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.sub as string | undefined;
    if (!userId) throw new ForbiddenException('Sign in to use the portal.');

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'active' },
      select: { customerId: true, customer: { select: { id: true, active: true, types: true } } },
    });

    const customer = user?.customer;
    if (!user?.customerId || !customer || !customer.active || !hasType(customer, LOGISTICS)) {
      throw new ForbiddenException('This account cannot use the shipments portal.');
    }

    req.portalCustomerId = customer.id;
    return true;
  }
}

/** The customer this request belongs to, as the guard established it. */
export const PortalCustomer = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest();
  const customerId = req.portalCustomerId as string | undefined;
  // Unreachable behind the guard; thrown rather than returning undefined so that a route which
  // somehow escaped it fails loudly instead of querying for `undefined` and returning everything.
  if (!customerId) throw new ForbiddenException('This account cannot use the shipments portal.');
  return customerId;
});
