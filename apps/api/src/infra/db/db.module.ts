// ZAŚLEPKA: implementacja w torze „dane i moduły” (F-03).
import { Global, Injectable, Module } from '@nestjs/common';

export const DRIZZLE = Symbol('DRIZZLE');

@Injectable()
export class DatabaseHealth {
  check(): Promise<void> {
    return Promise.reject(new Error('DatabaseHealth: brak implementacji'));
  }
}

@Global()
@Module({ providers: [DatabaseHealth], exports: [DatabaseHealth] })
export class DbModule {}
