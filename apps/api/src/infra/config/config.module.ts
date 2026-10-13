import { type DynamicModule, Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from './config.js';

/**
 * Globalny moduł konfiguracji: udostępnia zwalidowaną {@link AppConfig} pod tokenem APP_CONFIG.
 * Konfigurację wczytuje main.ts (loadConfig) przed utworzeniem aplikacji.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
