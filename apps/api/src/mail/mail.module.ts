import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { CryptoModule } from '../crypto/crypto.module';

/**
 * Sending email.
 *
 * Global, because everything that will want to send — user invitations, a customer shipment filed,
 * a sync that failed — belongs to a different module each time, and threading an import through all
 * of them adds nothing. It depends only on Prisma and the crypto envelope, so it cannot take part in
 * an import cycle.
 */
@Global()
@Module({
  imports: [CryptoModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
