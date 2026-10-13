import { describe, expect, it } from 'vitest';

import { turboRunArgs, workspaceTaskEnv } from './database.js';
import { ROOT_DIR } from './paths.js';
import { run } from './process.js';

describe('turboRunArgs', () => {
  it('uruchamia zadania w trybie --env-mode=loose (inaczej migracje nie dostaną DATABASE_URL)', () => {
    expect(turboRunArgs('db:migrate')).toContain('--env-mode=loose');
    expect(turboRunArgs('db:seed', ['--dry=json'])).toEqual([
      'exec',
      'turbo',
      'run',
      'db:seed',
      '--env-mode=loose',
      '--dry=json',
    ]);
  });

  // Prawdziwe turbo (bez Dockera): w trybie strict, domyślnym w Turborepo 2, zadanie dostałoby
  // tylko zmienne zadeklarowane w turbo.json, czyli bez DATABASE_URL.
  it.each(['db:migrate', 'db:seed'])(
    'turbo potwierdza tryb loose dla zadania %s',
    async (task) => {
      const result = await run('pnpm', turboRunArgs(task, ['--dry=json']), {
        cwd: ROOT_DIR,
        output: 'capture',
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const dryRun = JSON.parse(result.stdout) as {
        envMode: string;
        tasks: { taskId: string; envMode: string }[];
      };
      expect(dryRun.envMode).toBe('loose');
      expect(dryRun.tasks.length).toBeGreaterThan(0);
      for (const entry of dryRun.tasks) {
        expect(entry.envMode, entry.taskId).toBe('loose');
      }
    },
    30_000,
  );
});

describe('workspaceTaskEnv', () => {
  it('podmienia DATABASE_URL na adres sprawdzony przez bezpiecznik, resztę zostawia', () => {
    const env = workspaceTaskEnv(
      { host: '::1', port: 5433, user: 'biddy', password: 'p@ss', database: 'biddy' },
      {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://biddy:p%40ss@localhost:5433/biddy?host=db.example.com',
        MEILI_URL: 'http://localhost:7700',
      },
    );
    expect(env).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://biddy:p%40ss@[::1]:5433/biddy',
      MEILI_URL: 'http://localhost:7700',
    });
  });
});
