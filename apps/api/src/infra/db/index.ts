// Publiczne API warstwy bazy danych (PROJECT.md §11.2, ADR-10).
// - DbModule: moduł globalny z połączeniem do Postgresa (pg.Pool + Drizzle), zamyka pulę przy
//   zamykaniu aplikacji.
// - DRIZZLE: token DI instancji Drizzle. Moduł typuje ją jako Database<typeof własneTabele>:
//   typ nie zna tabel innych modułów (pełny schemat, AppDatabase, zostaje w infra).
// - PG_POOL: token DI puli pg (surowe zapytania, LISTEN/NOTIFY).
// - DatabaseHealth: check(): Promise<void>, odrzuca, gdy baza nie odpowie na `select 1` w ~2 s.
// - newId / idColumn: UUIDv7 generowane w aplikacji i kolumna klucza głównego dla tabel.
// - runMigrations: programowe migracje Drizzle pod blokadą doradczą, ze sprawdzeniem dziennika
//   (CLI: migrate.ts, `db:migrate`).
export { DATABASE_HEALTH_TIMEOUT_MS, DatabaseHealth } from './database-health.js';
export { DRIZZLE, PG_POOL, type Database } from './database.js';
export { DbModule } from './db.module.js';
export { idColumn, newId } from './ids.js';
export {
  MIGRATIONS_FOLDER,
  MigrationsError,
  runMigrations,
  type RunMigrationsOptions,
} from './migrations.js';
