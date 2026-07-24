import { Module } from '@nestjs/common';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseDefinitionsService } from './expense-definitions.service';
import { ExpenseDefinitionsController } from './expense-definitions.controller';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { ExpenseTagsService } from './expense-tags.service';
import { ExpenseTagsController } from './expense-tags.controller';

@Module({
  controllers: [ExpenseCategoriesController, ExpenseDefinitionsController, ExpensesController, ExpenseTagsController],
  providers: [ExpenseCategoriesService, ExpenseDefinitionsService, ExpensesService, ExpenseTagsService],
  exports: [ExpenseCategoriesService, ExpenseDefinitionsService, ExpensesService, ExpenseTagsService],
})
export class ExpensesModule {}
