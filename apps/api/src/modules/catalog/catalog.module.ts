import { Module } from '@nestjs/common';

import { CategoriesController } from './categories/categories.controller.js';
import { CategoryService } from './categories/category.service.js';
import { ItemService } from './items/item.service.js';

/**
 * Moduł domenowy `catalog` (PROJECT.md §10.3): drzewo kategorii i atrybuty (F-11), przedmioty
 * (F-14). Publiczne API: ./index.ts.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoryService, ItemService],
  exports: [CategoryService, ItemService],
})
export class CatalogModule {}
