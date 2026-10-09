// KONTRAKT (wypełnia tor „dane i moduły”): publiczne API warstwy bazy danych.
// - DbModule: moduł globalny z połączeniem do Postgresa (pg.Pool + Drizzle).
// - DRIZZLE: token DI instancji Drizzle (NodePgDatabase<typeof schema>).
// - DatabaseHealth: serwis z check(): Promise<void>, rzuca błąd, gdy baza nie odpowiada.
export { DbModule, DRIZZLE, DatabaseHealth } from './db.module.js';
