import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { EnvKeyProvider, KEY_PROVIDER } from './key-provider';

/** Global so any module can inject CryptoService without re-importing.
 *  Swap the KEY_PROVIDER factory to move from env to a KMS/Vault backend. */
@Global()
@Module({
  providers: [
    { provide: KEY_PROVIDER, useFactory: () => new EnvKeyProvider() },
    CryptoService,
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
