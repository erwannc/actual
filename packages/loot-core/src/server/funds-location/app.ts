import { v4 as uuidv4 } from 'uuid';

import { deriveFundsLocationData } from '../../shared/funds-location';
import * as monthUtils from '../../shared/months';
import { q } from '../../shared/query';
import type {
  FundsLocationAllocationEntity,
  FundsLocationAllocationInput,
  FundsLocationMonthEntity,
  FundsLocationSavedMonthEntity,
} from '../../types/models';
import { createApp } from '../app';
import { aqlQuery } from '../aql';
import { getBudgetType } from '../budget/base';
import * as db from '../db';
import { ValidationError } from '../errors';
import { send } from '../main-app';
import { requiredFields } from '../models';
import { mutator } from '../mutators';
import { undoable } from '../undo';

type BudgetMonthCategory = {
  id: string;
  name: string;
  is_income?: boolean;
  balance: number;
};

type BudgetMonthCategoryGroup = {
  id: string;
  name: string;
  is_income?: boolean;
  categories: BudgetMonthCategory[];
};

function validateMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new ValidationError(`Invalid month: ${month}`);
  }
}

function validateAllocation(
  allocation: FundsLocationAllocationInput,
  categoryIds: Set<string>,
  accountIds: Set<string>,
) {
  requiredFields('Funds location allocation', allocation, [
    'categoryId',
    'accountId',
    'amount',
  ]);

  if (!categoryIds.has(allocation.categoryId)) {
    throw new ValidationError(
      `Unknown funds location category: ${allocation.categoryId}`,
    );
  }

  if (!accountIds.has(allocation.accountId)) {
    throw new ValidationError(
      `Unknown funds location account: ${allocation.accountId}`,
    );
  }

  if (!Number.isInteger(allocation.amount)) {
    throw new ValidationError(
      `Funds location amount must be an integer: ${allocation.amount}`,
    );
  }
}

async function getStoredAllocations(
  month: string,
): Promise<FundsLocationAllocationEntity[]> {
  const { data }: { data: FundsLocationAllocationEntity[] } = await aqlQuery(
    q('funds_location_allocations').filter({ month }).select('*'),
  );
  return data;
}

async function getStoredMonth(month: string): Promise<FundsLocationSavedMonthEntity | null> {
  return await db.first<FundsLocationSavedMonthEntity>(
    `SELECT id, has_snapshot, tombstone
     FROM funds_location_months
     WHERE id = ? AND tombstone = 0`,
    [month],
  );
}

async function ensureStoredMonth(month: string) {
  const existingMonth = await db.first<{
    id: string;
    has_snapshot: 1 | 0;
    tombstone: 1 | 0;
  }>(
    `SELECT id, has_snapshot, tombstone
     FROM funds_location_months
     WHERE id = ?`,
    [month],
  );

  if (!existingMonth) {
    await db.insertWithSchema('funds_location_months', {
      id: month,
      has_snapshot: true,
    });
    return;
  }

  if (existingMonth.tombstone) {
    await db.updateWithSchema('funds_location_months', {
      id: month,
      has_snapshot: true,
      tombstone: false,
    });
  }
}

async function getMonth({
  month,
}: {
  month: string;
}): Promise<FundsLocationMonthEntity> {
  validateMonth(month);

  const budgetType = getBudgetType() === 'tracking' ? 'tracking' : 'envelope';
  if (budgetType !== 'envelope') {
    return {
      month,
      budgetType,
      supported: false,
      hasSavedSnapshot: false,
      editableAccounts: [],
      readOnlyAccounts: [],
      categories: [],
      allocations: [],
      totals: {
        categoryBalance: 0,
        categoryAllocated: 0,
        categoryRemainder: 0,
        accountBalance: 0,
        accountAllocated: 0,
        accountRemainder: 0,
      },
    };
  }

  const cutoff = monthUtils.getMonthEnd(`${month}-01`);
  const allAccounts = (await send('accounts-get')).filter(
    account => !account.closed && !account.offbudget,
  );
  const accountsWithBalances = await Promise.all(
    allAccounts.map(async account => ({
      id: account.id,
      name: account.name,
      balance: await send('account-balance', { id: account.id, cutoff }),
      isEditable: false,
    })),
  );

  for (const account of accountsWithBalances) {
    account.isEditable = account.balance > 0;
  }

  const budgetMonth = (await send('api/budget-month', {
    month,
  })) as unknown as {
    categoryGroups: BudgetMonthCategoryGroup[];
  };

  const categories = budgetMonth.categoryGroups
    .filter(group => !group.is_income)
    .flatMap(group =>
      group.categories
        .filter(category => category.balance > 0 && !category.is_income)
        .map(category => ({
          id: category.id,
          name: category.name,
          group_id: group.id,
          group_name: group.name,
          balance: category.balance,
        })),
    );

  const editableAccountIds = new Set(
    accountsWithBalances
      .filter(account => account.isEditable)
      .map(account => account.id),
  );
  const categoryIds = new Set(categories.map(category => category.id));
  const storedAllocations = await getStoredAllocations(month);
  const storedMonth = await getStoredMonth(month);
  const allocations = storedAllocations.filter(
    allocation =>
      categoryIds.has(allocation.category_id) &&
      editableAccountIds.has(allocation.account_id),
  );
  const derived = deriveFundsLocationData({
    accounts: accountsWithBalances,
    categories,
    allocations,
  });

  return {
    month,
    budgetType,
    supported: true,
    hasSavedSnapshot: storedMonth !== null || storedAllocations.length > 0,
    editableAccounts: derived.accounts.filter(account => account.isEditable),
    readOnlyAccounts: derived.accounts.filter(account => !account.isEditable),
    categories: derived.categories,
    allocations,
    totals: derived.totals,
  };
}

async function saveMonth({
  month,
  allocations,
}: {
  month: string;
  allocations: FundsLocationAllocationInput[];
}): Promise<FundsLocationMonthEntity> {
  validateMonth(month);

  if (!Array.isArray(allocations)) {
    throw new ValidationError('Funds location allocations must be an array');
  }

  const budgetType = getBudgetType() === 'tracking' ? 'tracking' : 'envelope';
  if (budgetType !== 'envelope') {
    throw new ValidationError(
      'Funds location allocations are only available for envelope budgets',
    );
  }

  const monthData = await getMonth({ month });
  const editableAccountIds = new Set(
    monthData.editableAccounts.map(account => account.id),
  );
  const categoryIds = new Set(
    monthData.categories.map(category => category.id),
  );

  const normalizedAllocations = new Map<string, FundsLocationAllocationInput>();

  for (const allocation of allocations) {
    validateAllocation(allocation, categoryIds, editableAccountIds);

    const key = `${allocation.categoryId}::${allocation.accountId}`;
    const existing = normalizedAllocations.get(key);
    normalizedAllocations.set(key, {
      categoryId: allocation.categoryId,
      accountId: allocation.accountId,
      amount: (existing?.amount ?? 0) + allocation.amount,
    });
  }

  await ensureStoredMonth(month);

  const existingAllocations = await getStoredAllocations(month);
  await Promise.all(
    existingAllocations.map(allocation =>
      db.delete_('funds_location_allocations', allocation.id),
    ),
  );

  await Promise.all(
    [...normalizedAllocations.values()]
      .filter(allocation => allocation.amount !== 0)
      .map(allocation =>
        db.insertWithSchema('funds_location_allocations', {
          id: uuidv4(),
          month,
          category_id: allocation.categoryId,
          account_id: allocation.accountId,
          amount: allocation.amount,
        }),
      ),
  );

  return getMonth({ month });
}

export type FundsLocationHandlers = {
  'funds-location/get-month': typeof getMonth;
  'funds-location/save-month': typeof saveMonth;
};

export const app = createApp<FundsLocationHandlers>();

app.method('funds-location/get-month', getMonth);
app.method('funds-location/save-month', mutator(undoable(saveMonth)));
