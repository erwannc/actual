import type {
  FundsLocationAccountSummary,
  FundsLocationAllocationEntity,
  FundsLocationCategorySummary,
  FundsLocationTotals,
} from '../types/models';

export type FundsLocationDerivableAccount = Pick<
  FundsLocationAccountSummary,
  'id' | 'name' | 'balance' | 'isEditable'
>;

export type FundsLocationDerivableCategory = Pick<
  FundsLocationCategorySummary,
  'id' | 'name' | 'group_id' | 'group_name' | 'balance'
>;

export function getFundsLocationAllocationKey(
  categoryId: string,
  accountId: string,
) {
  return `${categoryId}::${accountId}`;
}

export function buildFundsLocationAllocationMap(
  allocations: Pick<
    FundsLocationAllocationEntity,
    'category_id' | 'account_id' | 'amount'
  >[],
) {
  return new Map(
    allocations.map(allocation => [
      getFundsLocationAllocationKey(
        allocation.category_id,
        allocation.account_id,
      ),
      allocation.amount,
    ]),
  );
}

export function deriveFundsLocationData({
  accounts,
  categories,
  allocations,
}: {
  accounts: FundsLocationDerivableAccount[];
  categories: FundsLocationDerivableCategory[];
  allocations: Pick<
    FundsLocationAllocationEntity,
    'category_id' | 'account_id' | 'amount'
  >[];
}) {
  const allocationMap = buildFundsLocationAllocationMap(allocations);

  const categoryAllocatedTotals = new Map<string, number>();
  const accountAllocatedTotals = new Map<string, number>();

  for (const allocation of allocations) {
    categoryAllocatedTotals.set(
      allocation.category_id,
      (categoryAllocatedTotals.get(allocation.category_id) ?? 0) +
        allocation.amount,
    );
    accountAllocatedTotals.set(
      allocation.account_id,
      (accountAllocatedTotals.get(allocation.account_id) ?? 0) + allocation.amount,
    );
  }

  const derivedCategories: FundsLocationCategorySummary[] = categories.map(
    category => {
      const categoryAllocations = Object.fromEntries(
        accounts
          .map(account => [
            account.id,
            allocationMap.get(
              getFundsLocationAllocationKey(category.id, account.id),
            ) ?? 0,
          ])
          .filter(([, amount]) => amount !== 0),
      );

      const allocated = categoryAllocatedTotals.get(category.id) ?? 0;
      const remainder = category.balance - allocated;

      return {
        ...category,
        allocations: categoryAllocations,
        allocated,
        remainder,
        isOverallocated: allocated > category.balance,
        isPartiallyAllocated: allocated !== 0 && allocated < category.balance,
      };
    },
  );

  const derivedAccounts: FundsLocationAccountSummary[] = accounts.map(account => {
    const allocated = accountAllocatedTotals.get(account.id) ?? 0;
    const remainder = account.balance - allocated;

    return {
      ...account,
      allocated,
      remainder,
      isOverallocated: allocated > account.balance,
    };
  });

  const totals = derivedCategories.reduce<FundsLocationTotals>(
    (summary, category) => {
      summary.categoryBalance += category.balance;
      summary.categoryAllocated += category.allocated;
      summary.categoryRemainder += category.remainder;
      return summary;
    },
    derivedAccounts.reduce<FundsLocationTotals>(
      (summary, account) => {
        summary.accountBalance += account.balance;
        summary.accountAllocated += account.allocated;
        summary.accountRemainder += account.remainder;
        return summary;
      },
      {
        categoryBalance: 0,
        categoryAllocated: 0,
        categoryRemainder: 0,
        accountBalance: 0,
        accountAllocated: 0,
        accountRemainder: 0,
      },
    ),
  );

  return {
    categories: derivedCategories,
    accounts: derivedAccounts,
    totals,
  };
}
