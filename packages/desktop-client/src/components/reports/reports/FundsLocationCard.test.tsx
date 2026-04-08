import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';

import { initServer } from 'loot-core/platform/client/connection';
import type { FundsLocationMonthEntity } from 'loot-core/types/models';

import { FundsLocationCard } from './FundsLocationCard';

import type { UseFormatResult } from '@desktop-client/hooks/useFormat';
import { createTestQueryClient, TestProviders } from '@desktop-client/mocks';

vi.mock('loot-core/platform/client/connection');
vi.mock('loot-core/shared/months', async () => {
  const actual = await vi.importActual('loot-core/shared/months');

  return {
    ...actual,
    currentMonth: () => '2019-02',
    format: () => 'February 2019',
  };
});
vi.mock('@desktop-client/hooks/useNavigate', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('@desktop-client/hooks/useIsInViewport', () => ({
  useIsInViewport: () => true,
}));
vi.mock('@desktop-client/hooks/useFormat', () => ({
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
vi.mock(
  '@desktop-client/components/reports/useDashboardWidgetCopyMenu',
  () => ({
    useDashboardWidgetCopyMenu: () => ({
      menuItems: [],
      handleMenuSelect: () => false,
    }),
  }),
);
vi.mock('@desktop-client/components/reports/ReportCardName', () => ({
  ReportCardName: ({ name }: { name: ReactNode }) => <div>{name}</div>,
}));

function renderCard() {
  const queryClient = createTestQueryClient();

  return render(
    <TestProviders queryClient={queryClient}>
      <FundsLocationCard
        widgetId="funds-widget"
        meta={null}
        onMetaChange={vi.fn()}
        onRemove={vi.fn()}
        onCopy={vi.fn()}
      />
    </TestProviders>,
  );
}

describe('FundsLocationCard', () => {
  test('renders allocated vs non-allocated ratio for the current month', async () => {
    const monthData: FundsLocationMonthEntity = {
      month: '2019-02',
      budgetType: 'envelope',
      supported: true,
      editableAccounts: [],
      readOnlyAccounts: [],
      categories: [],
      allocations: [],
      totals: {
        categoryBalance: 10000,
        categoryAllocated: 7000,
        categoryRemainder: 3000,
        accountBalance: 10000,
        accountAllocated: 7000,
        accountRemainder: 3000,
      },
    };

    initServer({
      'api/budget-months': async () => ['2019-02'],
      'funds-location/get-month': async () => monthData,
    });

    renderCard();

    expect(await screen.findByText('February 2019')).toBeInTheDocument();
    expect(screen.getByText('Allocated funds')).toBeInTheDocument();
    expect(screen.getByText('7000')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('Non-allocated funds')).toBeInTheDocument();
    expect(screen.getByText('3000')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  test('shows unsupported messaging for tracking budgets', async () => {
    const monthData: FundsLocationMonthEntity = {
      month: '2019-02',
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

    initServer({
      'api/budget-months': async () => ['2019-02'],
      'funds-location/get-month': async () => monthData,
    });

    renderCard();

    expect(
      await screen.findByText(
        'Funds Location is only available for envelope budgets.',
      ),
    ).toBeInTheDocument();
  });
});
