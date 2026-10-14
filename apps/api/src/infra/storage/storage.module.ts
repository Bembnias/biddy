import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { OBJECT_STORAGE, type ObjectStorage, S3ObjectStorage } from './object-storage.js';

/** Magazyn plików S3 (F-12): adapter OBJECT_STORAGE dla API i workera. */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStorage => new S3ObjectStorage(config.storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  onApplicationShutdown(): void {
    if (this.storage instanceof S3ObjectStorage) {
      this.storage.destroy();
    }
  }
}
