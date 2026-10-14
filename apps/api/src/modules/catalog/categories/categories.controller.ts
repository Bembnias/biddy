import { attributeDefinitionSchema, attributesJsonSchema } from '@biddy/shared';
import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import type { CategoryNode } from './category-tree.js';
import { CategoryService } from './category.service.js';

const categoryFields = {
  id: z.uuid(),
  parentId: z.uuid().nullable().describe('Kategoria nadrzędna albo null (kategoria główna)'),
  slug: z.string(),
  name: z.string(),
  path: z.array(z.string()).describe('Slugi od kategorii głównej do tej kategorii'),
  depth: z.int().min(0).describe('Poziom w drzewie (0 = kategoria główna)'),
  isLeaf: z.boolean().describe('Liść drzewa: tylko tu można wystawić przedmiot'),
  isRestricted: z
    .boolean()
    .describe('Kategoria z ograniczeniami (moderacja przed publikacją); dziedziczona'),
  isBrandSensitive: z
    .boolean()
    .describe('Kategoria narażona na podróbki (więcej zdjęć, metki i kody); dziedziczona'),
};

export class CategoryDto extends createZodDto(z.object(categoryFields)) {}

export class CategorySchemaDto extends createZodDto(
  z.object({
    ...categoryFields,
    attributes: z
      .array(attributeDefinitionSchema)
      .describe('Atrybuty obowiązujące w kategorii (także dziedziczone), w kolejności formularza'),
    listingNotice: z
      .string()
      .min(1)
      .nullable()
      .describe('Zasady wystawiania w tej kategorii albo null'),
    jsonSchema: z
      .record(z.string(), z.unknown())
      .describe('JSON Schema (2020-12) wartości atrybutów przedmiotu'),
  }),
) {}

class CategoryIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function toDto(node: CategoryNode): CategoryDto {
  return {
    id: node.id,
    parentId: node.parentId,
    slug: node.slug,
    name: node.name,
    path: [...node.path],
    depth: node.depth,
    isLeaf: node.isLeaf,
    isRestricted: node.isRestricted,
    isBrandSensitive: node.isBrandSensitive,
  };
}

/** Drzewo kategorii i atrybuty (F-11). Publiczne, z krótkim cache. */
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Aktywne kategorie',
    description: 'Płaska lista w kolejności drzewa (w głąb); drzewo buduje się z parentId.',
  })
  @ZodResponse({ status: 200, description: 'Kategorie', type: [CategoryDto] })
  async getCategories(): Promise<CategoryDto[]> {
    return (await this.categories.list()).map(toDto);
  }

  @Get(':id/schema')
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({ summary: 'Atrybuty, flagi i zasady kategorii' })
  @ZodResponse({ status: 200, description: 'Schemat kategorii', type: CategorySchemaDto })
  async getCategorySchema(@Param() params: CategoryIdParams): Promise<CategorySchemaDto> {
    const schema = UUID.test(params.id) ? await this.categories.schema(params.id) : undefined;
    if (schema === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono kategorii.' });
    }
    return {
      ...toDto(schema),
      attributes: [...schema.attributes],
      listingNotice: schema.listingNotice,
      jsonSchema: attributesJsonSchema(schema.attributes),
    };
  }
}
