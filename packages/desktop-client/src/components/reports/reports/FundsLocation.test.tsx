import type { ReactNode } from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { initServer } from '@actual-app/core/platform/client/connection';
import { deriveFundsLocationData } from '@actual-app/core/shared/funds-location';
import type {
  FundsLocationAllocationInput,
  FundsLocationMonthEntity,
} from '@actual-app/core/types/models';

import { FundsLocation } from './FundsLocation';

import type { UseFormatResult } from '#hooks/useFormat';
import { createTestQueryClient, TestProviders } from '#mocks';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('../../../mocks/connection'),
);
vi.mock('@actual-app/core/shared/months', async () => {
  const actual = await vi.importActual('@actual-app/core/shared/months');

  return {
    ...actual,
    currentMonth: () => '2019-02',
  };
});
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: false }),
}));
vi.mock('#hooks/useNavigate', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('#hooks/useFormat', () => ({
  useFormat: () => {
    return Object.assign(
      (value: unknown) => {
        if (value == null || value === '') {
          return '0';
        }
        if (typeof value === 'string') {
          return value;
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        if (
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ) {
          return String(value);
        }
        return JSON.stringify(value);
      },
      {
        forEdit: (value: number) => String(value ?? 0),
        fromEdit: (value: string, defaultValue: number | null = 0) =>
          value === '' ? defaultValue : Number(value),
        currency: {
          code: 'USD',
          decimalPlaces: 2,
          symbol: '$',
        },
      },
    ) satisfies UseFormatResult;
  },
}));
vi.mock('#components/budget/MonthPicker', () => ({
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
vi.mock('#components/common/Modal', () => ({
  Modal: ({ name, children }: { name: string; children: ReactNode }) => (
    <div data-testid={`${name}-modal`}>{children}</div>
  ),
  ModalHeader: ({
    title,
    rightContent,
  }: {
    title?: ReactNode;
    rightContent?: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {rightContent}
    </div>
  ),
  ModalButtons: ({
    leftContent,
    children,
  }: {
    leftContent?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      {leftContent}
      {children}
    </div>
  ),
  ModalCloseButton: ({ onPress }: { onPress: () => void }) => (
    <button onClick={onPress} type="button">
      Close
    </button>
  ),
}));
vi.mock('#components/common/Search', () => ({
  Search: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      value={value}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
    />
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

const HIGH_ACCOUNT_ACCOUNTS = [
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `account-${index + 1}`,
    name: `Account ${String(index + 1).padStart(2, '0')}`,
    balance: 20000 - index * 750,
    isEditable: true,
  })),
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
  {
    id: 'vacation',
    name: 'Vacation',
    group_id: 'true-expenses',
    group_name: 'True Expenses',
    balance: 3000,
  },
];

let currentAccounts = BASE_ACCOUNTS;
let currentCategories = BASE_CATEGORIES;
let monthAccountOverrides: Partial<Record<string, typeof BASE_ACCOUNTS>> = {};
let monthCategoryOverrides: Partial<Record<string, typeof BASE_CATEGORIES>> = {};
let savedAllocations: Record<string, FundsLocationAllocationInput[]> = {};
let savedSnapshots: Record<string, boolean> = {};
let trackingBudget = false;

function useBaseFixture() {
  currentAccounts = BASE_ACCOUNTS;
  currentCategories = BASE_CATEGORIES;
  monthAccountOverrides = {};
  monthCategoryOverrides = {};
  savedAllocations = {
    '2019-02': [
      { categoryId: 'food', accountId: 'checking', amount: 3000 },
      { categoryId: 'utilities', accountId: 'savings', amount: 1200 },
    ],
    '2019-03': [],
  };
  savedSnapshots = {
    '2019-02': true,
    '2019-03': false,
  };
}

function useHighAccountFixture() {
  currentAccounts = HIGH_ACCOUNT_ACCOUNTS;
  currentCategories = BASE_CATEGORIES;
  monthAccountOverrides = {};
  monthCategoryOverrides = {};
  savedAllocations = {
    '2019-02': [
      { categoryId: 'food', accountId: 'account-1', amount: 3000 },
      { categoryId: 'food', accountId: 'account-2', amount: 1500 },
      { categoryId: 'food', accountId: 'account-3', amount: 1000 },
      { categoryId: 'food', accountId: 'account-4', amount: 500 },
      { categoryId: 'utilities', accountId: 'account-12', amount: 400 },
    ],
    '2019-03': [],
  };
  savedSnapshots = {
    '2019-02': true,
    '2019-03': false,
  };
}

function useDenseAccountBreakdownFixture() {
  currentAccounts = BASE_ACCOUNTS;
  currentCategories = [
    ...BASE_CATEGORIES,
    {
      id: 'medical',
      name: 'Medical',
      group_id: 'true-expenses',
      group_name: 'True Expenses',
      balance: 2000,
    },
  ];
  monthAccountOverrides = {};
  monthCategoryOverrides = {};
  savedAllocations = {
    '2019-02': [
      { categoryId: 'food', accountId: 'checking', amount: 3000 },
      { categoryId: 'utilities', accountId: 'checking', amount: 1200 },
      { categoryId: 'vacation', accountId: 'checking', amount: 900 },
      { categoryId: 'medical', accountId: 'checking', amount: 500 },
    ],
    '2019-03': [],
  };
  savedSnapshots = {
    '2019-02': true,
    '2019-03': false,
  };
}

function useFilteredCarryOverFixture() {
  useBaseFixture();
  monthCategoryOverrides = {
    '2019-03': BASE_CATEGORIES.filter(category => category.id !== 'utilities'),
  };
  monthAccountOverrides = {
    '2019-03': BASE_ACCOUNTS.map(account =>
      account.id === 'savings' ? { ...account, balance: 0, isEditable: false } : account,
    ),
  };
}

function buildMonthData(month: string): FundsLocationMonthEntity {
  if (trackingBudget) {
    return {
      month,
      budgetType: 'tracking',
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

  const accounts = monthAccountOverrides[month] ?? currentAccounts;
  const categories = monthCategoryOverrides[month] ?? currentCategories;
  const allocations = (savedAllocations[month] ?? []).map(allocation => ({
    id: `${month}-${allocation.categoryId}-${allocation.accountId}`,
    month,
    category_id: allocation.categoryId,
    account_id: allocation.accountId,
    amount: allocation.amount,
  }));
  const derived = deriveFundsLocationData({
    accounts,
    categories,
    allocations,
  });

  return {
    month,
    budgetType: 'envelope',
    supported: true,
    hasSavedSnapshot: savedSnapshots[month] ?? allocations.length > 0,
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
      savedSnapshots[month] = true;
      savedAllocations[month] = allocations.filter(
        allocation => allocation.amount !== 0,
      );

      return buildMonthData(month);
    },
  });
}

function getCategoryRow(categoryName: string) {
  const row = screen.getByText(categoryName).closest('tr');
  expect(row).not.toBeNull();
  return row!;
}

function getDialogAccountNames(modal: HTMLElement) {
  return within(modal)
    .getAllByRole('row')
    .slice(1)
    .map(row => within(row).getAllByRole('cell')[0].textContent ?? '');
}

function getReportCategoryNames() {
  const table = screen.getByTestId('funds-location-table');
  return Array.from(table.querySelectorAll('tbody tr')).map(row => {
    const cells = row.querySelectorAll('td');
    return cells[1]?.textContent ?? '';
  });
}

describe('FundsLocation', () => {
  beforeEach(() => {
    trackingBudget = false;
    useBaseFixture();
    setupMockServer();
  });

  test('renders grid mode when there are 6 or fewer editable accounts', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save allocations' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Allocation summary' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit accounts' }),
    ).not.toBeInTheDocument();
  });

  test('filters the report by group and category', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.change(screen.getByLabelText('Filter by group'), {
      target: { value: 'Usual Expenses' },
    });

    await waitFor(() => {
      expect(getReportCategoryNames()).toEqual(['Food', 'Utilities']);
    });

    fireEvent.change(screen.getByPlaceholderText('Filter categories'), {
      target: { value: 'util' },
    });

    await waitFor(() => {
      expect(getReportCategoryNames()).toEqual(['Utilities']);
    });

    expect(screen.queryByText('Vacation')).not.toBeInTheDocument();
  });

  test('switches to account view and shows account allocation details', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'By account' }));

    const accountTable = await screen.findByTestId(
      'funds-location-account-table',
    );

    expect(accountTable).toHaveTextContent('Checking');
    expect(accountTable).toHaveTextContent('Savings');
    expect(accountTable).toHaveTextContent('Food');
    expect(accountTable).toHaveTextContent('Utilities');
    expect(screen.queryByTestId('funds-location-account-detail')).not.toBeInTheDocument();
  });

  test('account view no longer renders a selected-account detail panel', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'By account' }));

    await screen.findByTestId('funds-location-account-table');

    expect(screen.queryByTestId('funds-location-account-detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Savings details' })).not.toBeInTheDocument();
  });

  test('filters the account view by account name', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'By account' }));

    const accountTable = await screen.findByTestId(
      'funds-location-account-table',
    );

    fireEvent.change(screen.getByPlaceholderText('Filter accounts'), {
      target: { value: 'sav' },
    });

    await waitFor(() => {
      expect(accountTable).toHaveTextContent('Savings');
    });

    expect(accountTable).not.toHaveTextContent('Checking');
  });

  test('accounts needing review note switches to account view sorted by usage descending', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'Balance' }));

    fireEvent.click(
      screen.getByRole('button', { name: /accounts need review/i }),
    );

    await screen.findByTestId('funds-location-account-table');

    expect(
      screen.getByRole('button', { name: 'Usage (descending)' }),
    ).toBeInTheDocument();
  });

  test('allocated categories summary can expand hidden categories in account view', async () => {
    useDenseAccountBreakdownFixture();
    setupMockServer();

    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'By account' }));

    const accountTable = await screen.findByTestId(
      'funds-location-account-table',
    );
    expect(accountTable).toBeInTheDocument();

    const checkingRow = within(accountTable).getByText('Checking').closest('tr');
    expect(checkingRow).not.toBeNull();

    expect(within(checkingRow!).getByText('Food')).toBeInTheDocument();
    expect(within(checkingRow!).getByText('Utilities')).toBeInTheDocument();
    expect(within(checkingRow!).getByText('Vacation')).toBeInTheDocument();
    expect(within(checkingRow!).queryByText('Medical')).not.toBeInTheDocument();

    fireEvent.click(
      within(checkingRow!).getByRole('button', { name: '+1 more' }),
    );

    expect(within(checkingRow!).getByText('Medical')).toBeInTheDocument();
    expect(
      within(checkingRow!).getByRole('button', { name: 'Show less' }),
    ).toBeInTheDocument();
  });

  test('sorts grid-mode report rows by account column', async () => {
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: 'Savings' }));

    expect(getReportCategoryNames()).toEqual(['Utilities', 'Food', 'Vacation']);

    fireEvent.click(
      screen.getByRole('button', { name: 'Savings (descending)' }),
    );

    expect(getReportCategoryNames()).toEqual(['Food', 'Vacation', 'Utilities']);
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
    fireEvent.change(utilitiesSavingsSlider, {
      target: { value: '1000' },
    });

    const foodRow = getCategoryRow('Food');
    const accountTotalsRow = getCategoryRow('Account totals');

    expect(within(foodRow).getByText('4500')).toBeInTheDocument();
    expect(accountTotalsRow).toHaveTextContent('3500');
    expect(accountTotalsRow).toHaveTextContent('Remainder: 12500');
    expect(accountTotalsRow).toHaveTextContent('Remainder: 6000');
    expect(foodCheckingSlider).toHaveAttribute('max', '7000');
    expect(utilitiesSavingsSlider).toHaveAttribute('max', '5000');
  });

  test('updates allocations from the main table inline amount editor', async () => {
    renderFundsLocation();

    await screen.findByLabelText('Food allocation in Checking');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Food allocation in Checking amount',
      }),
    );
    fireEvent.change(
      screen.getByLabelText('Edit Food allocation in Checking amount'),
      {
        target: { value: '2500' },
      },
    );
    fireEvent.keyUp(
      screen.getByLabelText('Edit Food allocation in Checking amount'),
      {
        key: 'Enter',
      },
    );

    await waitFor(() => {
      expect(getCategoryRow('Food')).toHaveTextContent('4500');
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '2500',
      );
    });

    await waitFor(() => {
      expect(savedAllocations['2019-02']).toEqual(
        expect.arrayContaining([
          { categoryId: 'food', accountId: 'checking', amount: 2500 },
        ]),
      );
    });
  });

  test('switching months carries over the latest saved snapshot', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(screen.getByRole('button', { name: '2019-03' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '3000',
      );
      expect(
        screen.getByLabelText('Utilities allocation in Savings'),
      ).toHaveValue('1200');
    });
  });

  test('clearing the selected month removes saved allocations', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved allocations' }),
    );
    const confirmationModal = await screen.findByTestId(
      'funds-location-clear-saved-month-confirmation-modal',
    );
    fireEvent.click(
      within(confirmationModal).getByRole('button', {
        name: 'Clear saved allocations',
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '0',
      );
    });
    expect(savedAllocations['2019-02']).toEqual([]);
  });

  test('clearing a later saved month keeps that month empty when revisiting it', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(screen.getByRole('button', { name: '2019-03' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '3000',
      );
    });

    await waitFor(() => {
      expect(savedAllocations['2019-03']).toEqual(
        expect.arrayContaining([
          { categoryId: 'food', accountId: 'checking', amount: 3000 },
          { categoryId: 'utilities', accountId: 'savings', amount: 1200 },
        ]),
      );
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved allocations' }),
    );
    const confirmationModal = await screen.findByTestId(
      'funds-location-clear-saved-month-confirmation-modal',
    );
    fireEvent.click(
      within(confirmationModal).getByRole('button', {
        name: 'Clear saved allocations',
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '0',
      );
      expect(
        screen.getByLabelText('Utilities allocation in Savings'),
      ).toHaveValue('0');
    });

    fireEvent.click(screen.getByRole('button', { name: '2019-02' }));
    await screen.findByLabelText('Food allocation in Checking');
    fireEvent.click(screen.getByRole('button', { name: '2019-03' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '0',
      );
      expect(
        screen.getByLabelText('Utilities allocation in Savings'),
      ).toHaveValue('0');
    });
  });

  test('clear saved month confirmation can be cancelled', async () => {
    renderFundsLocation();

    expect(
      await screen.findByLabelText('Food allocation in Checking'),
    ).toHaveValue('3000');

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved allocations' }),
    );

    expect(screen.getByText('Clear saved allocations?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Clear saved allocations?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
      '3000',
    );
    expect(savedAllocations['2019-02']).toEqual(
      expect.arrayContaining([
        { categoryId: 'food', accountId: 'checking', amount: 3000 },
        { categoryId: 'utilities', accountId: 'savings', amount: 1200 },
      ]),
    );
  });

  test('carry-over filters out accounts and categories that are not valid this month', async () => {
    useFilteredCarryOverFixture();
    setupMockServer();

    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(screen.getByRole('button', { name: '2019-03' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Food allocation in Checking')).toHaveValue(
        '3000',
      );
    });

    expect(screen.queryByText('Utilities')).not.toBeInTheDocument();
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(savedAllocations['2019-03']).toEqual([
        { categoryId: 'food', accountId: 'checking', amount: 3000 },
      ]);
    });
  });

  test('renders compact mode summary and actions when there are more than 6 editable accounts', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();

    await screen.findByRole('columnheader', { name: 'Allocation summary' });

    expect(
      screen.getByRole('columnheader', { name: 'Actions' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Account 01' }),
    ).not.toBeInTheDocument();

    const foodRow = getCategoryRow('Food');
    expect(within(foodRow).getByText('Account 01')).toBeInTheDocument();
    expect(within(foodRow).getByText('Account 02')).toBeInTheDocument();
    expect(within(foodRow).getByText('Account 03')).toBeInTheDocument();
    expect(within(foodRow).getByText('+1 more')).toBeInTheDocument();
    expect(
      within(foodRow).getByRole('button', { name: 'Edit accounts' }),
    ).toBeInTheDocument();
  });

  test('compact allocation summary can expand hidden allocations', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();

    await screen.findByRole('columnheader', { name: 'Allocation summary' });

    const foodRow = getCategoryRow('Food');

    expect(within(foodRow).queryByText('Account 04')).not.toBeInTheDocument();

    fireEvent.click(within(foodRow).getByRole('button', { name: '+1 more' }));

    expect(within(foodRow).getByText('Account 04')).toBeInTheDocument();
    expect(
      within(foodRow).getByRole('button', { name: 'Show less' }),
    ).toBeInTheDocument();
  });

  test('sorts compact-mode report rows by visible columns', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();

    await screen.findByRole('columnheader', { name: 'Allocation summary' });

    fireEvent.click(screen.getByRole('button', { name: 'Balance' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Balance (descending)' }),
    );

    expect(getReportCategoryNames()).toEqual(['Vacation', 'Utilities', 'Food']);
  });

  test('dialog search filters account rows and autosaves changes', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );

    expect(within(modal).getByText('Food')).toBeInTheDocument();

    fireEvent.change(within(modal).getByPlaceholderText('Search accounts'), {
      target: { value: 'Account 12' },
    });

    await waitFor(() => {
      expect(within(modal).getByText('Account 12')).toBeInTheDocument();
    });
    expect(within(modal).queryByText('Account 01')).not.toBeInTheDocument();

    fireEvent.change(
      within(modal).getByLabelText('Food allocation in Account 12'),
      {
        target: { value: '250' },
      },
    );

    await waitFor(() => {
      expect(savedAllocations['2019-02']).toEqual(
        expect.arrayContaining([
          { categoryId: 'food', accountId: 'account-12', amount: 250 },
        ]),
      );
    });

    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const reopenedModal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );
    expect(
      within(reopenedModal).getByLabelText('Food allocation in Account 01'),
    ).toHaveValue('3000');
    expect(
      within(reopenedModal).getByLabelText('Food allocation in Account 12'),
    ).toHaveValue('250');
  });

  test('default modal order stays stable while sliders are edited', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );
    const initialOrder = getDialogAccountNames(modal);

    fireEvent.change(
      within(modal).getByLabelText('Food allocation in Account 12'),
      {
        target: { value: '250' },
      },
    );

    expect(getDialogAccountNames(modal)).toEqual(initialOrder);
  });

  test('modal column headers sort account rows', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );

    fireEvent.click(within(modal).getByRole('button', { name: 'Balance' }));

    const sortedNames = getDialogAccountNames(modal);
    expect(sortedNames[0]).toBe('Account 01');
    expect(sortedNames.at(-1)).toBe('Account 12');

    fireEvent.click(
      within(modal).getByRole('button', { name: 'Balance (descending)' }),
    );

    const reverseSortedNames = getDialogAccountNames(modal);
    expect(reverseSortedNames[0]).toBe('Account 12');
    expect(reverseSortedNames.at(-1)).toBe('Account 01');
  });

  test('dialog clear rows only clears the selected category after confirmation', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );
    fireEvent.click(within(modal).getByRole('button', { name: 'Clear rows' }));
    const confirmationModal = await screen.findByTestId(
      'funds-location-clear-dialog-rows-confirmation-modal',
    );
    fireEvent.click(
      within(confirmationModal).getByRole('button', { name: 'Clear rows' }),
    );
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(
        within(getCategoryRow('Food')).getByText('Unassigned'),
      ).toBeInTheDocument();
    });
    expect(getCategoryRow('Utilities')).toHaveTextContent('Account 12');
    expect(getCategoryRow('Utilities')).toHaveTextContent('400');
  });

  test('dialog updates the main table and persists after reload', async () => {
    useHighAccountFixture();
    setupMockServer();

    const firstRender = renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );

    fireEvent.change(
      within(modal).getByLabelText('Food allocation in Account 02'),
      {
        target: { value: '0' },
      },
    );
    fireEvent.change(
      within(modal).getByLabelText('Food allocation in Account 04'),
      {
        target: { value: '1500' },
      },
    );
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(getCategoryRow('Food')).toHaveTextContent('5500');
    });
    expect(getCategoryRow('Food')).toHaveTextContent('1500');
    expect(getCategoryRow('Food')).toHaveTextContent('Account 04');
    expect(getCategoryRow('Food')).not.toHaveTextContent('+1 more');

    await waitFor(() => {
      expect(savedAllocations['2019-02']).toEqual(
        expect.arrayContaining([
          { categoryId: 'food', accountId: 'account-1', amount: 3000 },
          { categoryId: 'food', accountId: 'account-3', amount: 1000 },
          { categoryId: 'food', accountId: 'account-4', amount: 1500 },
        ]),
      );
    });

    firstRender.unmount();
    renderFundsLocation();

    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const reloadedModal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );
    expect(
      within(reloadedModal).getByLabelText('Food allocation in Account 02'),
    ).toHaveValue('0');
    expect(
      within(reloadedModal).getByLabelText('Food allocation in Account 04'),
    ).toHaveValue('1500');
  });

  test('dialog inline amount editor applies precise values', async () => {
    useHighAccountFixture();
    setupMockServer();

    renderFundsLocation();
    await screen.findByTestId('funds-location-table');

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const modal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );

    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'Edit Food allocation in Account 12 amount',
      }),
    );
    fireEvent.change(
      within(modal).getByLabelText('Edit Food allocation in Account 12 amount'),
      {
        target: { value: '250' },
      },
    );
    fireEvent.keyUp(
      within(modal).getByLabelText('Edit Food allocation in Account 12 amount'),
      {
        key: 'Enter',
      },
    );

    await waitFor(() => {
      expect(
        within(modal).getByLabelText('Food allocation in Account 12'),
      ).toHaveValue('250');
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    fireEvent.click(
      within(getCategoryRow('Food')).getByRole('button', {
        name: 'Edit accounts',
      }),
    );

    const reopenedModal = await screen.findByTestId(
      'funds-location-category-allocation-modal',
    );
    expect(
      within(reopenedModal).getByLabelText('Food allocation in Account 12'),
    ).toHaveValue('250');
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
