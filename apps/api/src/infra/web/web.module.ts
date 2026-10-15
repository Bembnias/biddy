import { Global, Module } from '@nestjs/common';

import { WebRevalidator } from './web-revalidator.js';

/** Integracja z aplikacją web (F-18): rewalidacja stron ISR. Globalny, jak realtime. */
@Global()
@Module({
  providers: [WebRevalidator],
  exports: [WebRevalidator],
})
export class WebModule {}
