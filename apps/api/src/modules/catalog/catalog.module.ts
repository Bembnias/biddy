import { Module } from '@nestjs/common';

import { CategoriesController } from './categories/categories.controller.js';
import { CategoryService } from './categories/category.service.js';

/**
 * Moduł domenowy `catalog` (PROJECT.md §10.3): drzewo kategorii i atrybuty (F-11); przedmioty
 * w F-14. Publiczne API: ./index.ts.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CatalogModule {}
