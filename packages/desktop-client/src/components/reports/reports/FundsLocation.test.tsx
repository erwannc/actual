import React from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { initServer } from 'loot-core/platform/client/connection';
import { deriveFundsLocationData } from 'loot-core/shared/funds-location';
import type {
  FundsLocationAllocationInput,
  FundsLocationMonthEntity,
} from 'loot-core/types/models';

import { FundsLocation } from './FundsLocation';

import { createTestQueryClient, TestProviders } from '@desktop-client/mocks';

vi.mock('loot-core/platform/client/connection');
vi.mock('loot-core/shared/months', async () => {
  const actual = await vi.importActual('loot-core/shared/months');

  return {
    ...actual,
    currentMonth: () => '2019-02',
  };
});
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: false }),
}));
vi.mock('@desktop-client/hooks/useNavigate', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('@desktop-client/hooks/useFormat', () => ({
  useFormat: () => {
    const format = ((value: unknown) => String(value ?? 0)) as {
      (value: unknown): string;
      forEdit: (value: number) => string;
      fromEdit: (value: string, defaultValue?: number | null) => number | null;
      currency: { code: string; decimalPlaces: number; symbol: string };
    };

    format.forEdit = value => String(value ?? 0);
    format.fromEdit = (value, defaultValue = 0) =>
      value === '' ? defaultValue : Number(value);
    format.currency = {
      code: 'USD',
      decimalPlaces: 2,
      symbol: '$',
    };

    return format;
  },
}));
vi.mock('@desktop-client/components/budget/MonthPicker', () => ({
  MonthPicker: ({
    startMonth,
    monthBounds,
    onSelect,
  }: {
    startMonth: string;
    monthBounds: { start: string; end: string };
    onSelect: (month: string) => void;
  }) => (
    <div>
      <span data-testid="selected-month">{startMonth}</span>
      <button onClick={() => onSelect(monthBounds.start)} type="button">
        {monthBounds.start}
      </button>
      <button onClick={() => onSelect(monthBounds.end)} type="button">
        {monthBounds.end}
      </button>
    </div>
  ),
}));

const MONTHS = ['2019-02', '2019-03'];

const BASE_ACCOUNTS = [
  {
    id: 'checking',
    name: 'Checking',
    balance: 15000,
    isEditable: true,
  },
  {
    id: 'savings',
    name: 'Savings',
    balance: 7000,
    isEditable: true,
  },
  {
    id: 'credit-card',
    name: 'Credit Card',
    balance: -3000,
    isEditable: false,
  },
];

const BASE_CATEGORIES = [
  {
    id: 'food',
    name: 'Food',
    group_id: 'usual-expenses',
    group_name: 'Usual Expenses',
    balance: 7000,
  },
  {
    id: 'utilities',
    name: 'Utilities',
    group_id: 'usual-expenses',
    group_name: 'Usual Expenses',
    balance: 5000,
  },
];

let savedAllocations: Record<string, FundsLocationAllocationInput[]> = {};
let trackingBudget = false;

function buildMonthData(month: string): FundsLocationMonthEntity {
  if (trackingBudget) {
    return {
      month,
      budgetType: 'tracking',
      supported: false,
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

  const allocations = (savedAllocations[month] ?? []).map(allocation => ({
    id: `${month}-${allocation.categoryId}-${allocation.accountId}`,
    month,
    category_id: allocation.categoryId,
    account_id: allocation.accountId,
    amount: allocation.amount,
  }));
  const derived = deriveFundsLocationData({
    accounts: BASE_ACCOUNTS,
    categories: BASE_CATEGORIES,
    allocations,
  });

  return {
    month,
    budgetType: 'envelope',
    supported: true,
    editableAccounts: derived.accounts.filter(account => account.isEditable),
    readOnlyAccounts: derived.accounts.filter(account => !account.isEditable),
    categories: derived.categories,
    allocations,
    totals: derived.totals,
  };
}

function renderFundsLocation() {
  const queryClient = createTestQueryClient();

  return render(
    <TestProviders queryClient={queryClient}>
      <FundsLocation />
    </TestProviders>,
  );
}

function setupMockServer() {
  initServer({
    'api/budget-months': async () => MONTHS,
    'funds-location/get-month': async ({ month }: { month: string }) =>
      buildMonthData(month),
    'funds-location/save-month': async ({
      month,
      allocations,
    }: {
      month: string;
      allocations: FundsLocationAllocationInput[];
    }) => {
      savedAllocations[month] = allocations.filter(
        allocation => allocation.amount !== 0,
      );

      return buildMonthData(month);
    },
  });
}

describe('FundsLocation', () => {
  beforeEach(() => {
    trackingBudget = false;
    savedAllocations = {
      '2019-02': [
        { categoryId: 'food', accountId: 'checking', amount: 3000 },
        { categoryId: 'utilities', accountId: 'savings', amount: 1200 },
      ],
      '2019-03': [{ categoryId: 'food', accountId: 'checking', amount: 500 }],
    };

    setupMockServer();
  });

  test('renders saved allocations after a reload', async () => {
    const firstRender = renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');
    expect(
      screen.getByLabelText('Utilities allocation in Savings'),
    ).toHaveValue('1200');

    firstRender.unmount();

    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');
    expect(
      screen.getByLabelText('Utilities allocation in Savings'),
    ).toHaveValue('1200');
  });

  test('updates row remainders and account totals as inputs change', async () => {
    renderFundsLocation();

    const foodCheckingSlider = await screen.findByLabelText(
      'Food allocation in Checking',
    );
    const utilitiesSavingsSlider = screen.getByLabelText(
      'Utilities allocation in Savings',
    );

    expect(foodCheckingSlider).toHaveAttribute('max', '7000');
    expect(utilitiesSavingsSlider).toHaveAttribute('max', '5000');

    fireEvent.change(foodCheckingSlider, {
      target: { value: '2500' },
    });
    fireEvent.change(screen.getByLabelText('Utilities allocation in Savings'), {
      target: { value: '1000' },
    });

    const foodRow = screen.getByText('Food').closest('tr');
    const accountTotalsRow = screen.getByText('Account totals').closest('tr');

    expect(foodRow).not.toBeNull();
    expect(accountTotalsRow).not.toBeNull();
    expect(within(foodRow!).getByText('4500')).toBeInTheDocument();
    expect(accountTotalsRow).toHaveTextContent('3500');
    expect(accountTotalsRow).toHaveTextContent('Remainder: 12500');
    expect(accountTotalsRow).toHaveTextContent('Remainder: 6000');
    expect(foodCheckingSlider).toHaveAttribute('max', '7000');
    expect(utilitiesSavingsSlider).toHaveAttribute('max', '5000');
  });

  test('switching months loads the matching snapshot', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(screen.getByRole('button', { name: '2019-03' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '500',
      );
    });
  });

  test('clearing the selected month removes saved allocations', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(screen.getByRole('button', { name: 'Clear saved month' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '0',
      );
    });
    expect(savedAllocations['2019-02']).toEqual([]);
  });

  test('shows unsupported messaging for tracking budgets', async () => {
    trackingBudget = true;
    setupMockServer();

    renderFundsLocation();

    expect(
      await screen.findByText(
        'Funds Location is only available for envelope budgets.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('funds-location-table'),
    ).not.toBeInTheDocument();
  });
});
