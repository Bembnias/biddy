// Kontroler tylko dla testów integracyjnych (montowany przez createApp({ extraModules })).
// DTO z nestjs-zod sprawdza globalny ZodValidationPipe, a poprawne żądanie przechodzi przez
// DI do Drizzle i prawdziwego Postgresa (ltree z migracji init).
import { Body, Controller, Inject, Module, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type Database, DRIZZLE, newId } from '../../../src/infra/db/index.js';

/** Nazwa schematu DTO w dokumencie OpenAPI (components.schemas). */
export const LISTING_DTO_SCHEMA = 'IntegrationListingDto';

export class IntegrationListingDto extends createZodDto(
  z.object({
    title: z.string().min(3).max(80),
    startingPrice: z.object({
      amount: z.number().int().positive(),
      currency: z.literal('PLN'),
    }),
    /** Ścieżka kategorii w formacie ltree, np. moda.obuwie.sneakersy. */
    categoryPath: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/),
  }),
) {}

export interface CreatedListing {
  readonly id: string;
  readonly title: string;
  readonly categoryDepth: number;
}

@Controller('integration-test')
export class ListingsTestController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Post('listings')
  async create(@Body() body: IntegrationListingDto): Promise<CreatedListing> {
    const result = await this.db.execute<{ depth: number }>(
      sql`select nlevel(${body.categoryPath}::ltree) as depth`,
    );
    return { id: newId(), title: body.title, categoryDepth: result.rows[0]?.depth ?? 0 };
  }
}

@Module({ controllers: [ListingsTestController] })
export class ListingsTestModule {}
