export type FundsLocationAllocationEntity = {
  id: string;
  month: string;
  category_id: string;
  account_id: string;
  amount: number;
  tombstone?: boolean;
};

export type FundsLocationAllocationInput = {
  categoryId: string;
  accountId: string;
  amount: number;
};

export type FundsLocationSavedMonthEntity = {
  id: string;
  has_snapshot?: boolean;
  tombstone?: boolean;
};

export type FundsLocationAccountSummary = {
  id: string;
  name: string;
  balance: number;
  allocated: number;
  remainder: number;
  isEditable: boolean;
  isOverallocated: boolean;
};

export type FundsLocationCategorySummary = {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  balance: number;
  allocated: number;
  remainder: number;
  isOverallocated: boolean;
  isPartiallyAllocated: boolean;
  allocations: Record<string, number>;
};

export type FundsLocationTotals = {
  categoryBalance: number;
  categoryAllocated: number;
  categoryRemainder: number;
  accountBalance: number;
  accountAllocated: number;
  accountRemainder: number;
};

export type FundsLocationMonthEntity = {
  month: string;
  budgetType: 'envelope' | 'tracking';
  supported: boolean;
  hasSavedSnapshot: boolean;
  editableAccounts: FundsLocationAccountSummary[];
  readOnlyAccounts: FundsLocationAccountSummary[];
  categories: FundsLocationCategorySummary[];
  allocations: FundsLocationAllocationEntity[];
  totals: FundsLocationTotals;
};
