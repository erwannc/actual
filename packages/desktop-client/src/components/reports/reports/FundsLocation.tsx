import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgArrowDown,
  SvgArrowUp,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { send } from 'loot-core/platform/client/connection';
import {
  deriveFundsLocationData,
  getFundsLocationAllocationKey,
} from 'loot-core/shared/funds-location';
import * as monthUtils from 'loot-core/shared/months';
import type {
  FundsLocationAllocationInput,
  FundsLocationMonthEntity,
} from 'loot-core/types/models';

import { MonthPicker } from '@desktop-client/components/budget/MonthPicker';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { Search } from '@desktop-client/components/common/Search';
import { FinancialText } from '@desktop-client/components/FinancialText';
import { MobileBackButton } from '@desktop-client/components/mobile/MobileBackButton';
import {
  MobilePageHeader,
  Page,
  PageHeader,
} from '@desktop-client/components/Page';
import { LoadingIndicator } from '@desktop-client/components/reports/LoadingIndicator';
import { useFormat } from '@desktop-client/hooks/useFormat';
import { useNavigate } from '@desktop-client/hooks/useNavigate';
import { addNotification } from '@desktop-client/notifications/notificationsSlice';
import { useDispatch } from '@desktop-client/redux';
import { fundsLocationQueries } from '@desktop-client/reports';

type DraftAllocationMap = Record<string, FundsLocationAllocationInput>;

const STICKY_COLUMNS = [
  'group',
  'category',
  'balance',
  'allocated',
  'remainder',
] as const;
const HIGH_ACCOUNT_COUNT_THRESHOLD = 5;
const ACCOUNT_SEARCH_THRESHOLD = 10;

type StickyReportColumn = (typeof STICKY_COLUMNS)[number];

type ReportSortColumn =
  | 'default'
  | 'group'
  | 'category'
  | 'balance'
  | 'allocated'
  | 'remainder'
  | 'summary'
  | 'account';
type ReportSortDirection = 'asc' | 'desc';
type DialogSortColumn =
  | 'default'
  | 'account'
  | 'balance'
  | 'currentAllocation'
  | 'maxAvailable'
  | 'allocation';
type DialogSortDirection = 'asc' | 'desc';

type CategoryDialogState = {
  categoryId: string;
  allocations: Record<string, number>;
  defaultOrder: string[];
  sortColumn: DialogSortColumn;
  sortDirection: DialogSortDirection;
};
type ReportSortState = {
  column: ReportSortColumn;
  direction: ReportSortDirection;
  accountId?: string;
};

function renderSortDirectionIcon(direction: 'asc' | 'desc') {
  const Icon = direction === 'asc' ? SvgArrowDown : SvgArrowUp;

  return (
    <span
      aria-hidden="true"
      style={{
        display: 'flex',
        color: theme.tableHeaderText,
      }}
    >
      <Icon width={10} height={10} style={{ marginLeft: 5 }} />
    </span>
  );
}

function getSortHeaderButtonStyle(
  align: 'left' | 'right' = 'left',
): CSSProperties {
  return {
    width: 'calc(100% + 10px)',
    marginLeft: -5,
    marginRight: -5,
    justifyContent: 'center',
    alignItems: align === 'right' ? 'flex-end' : 'flex-start',
    gap: 4,
    color: theme.tableHeaderText,
    fontWeight: 300,
  };
}

function getSortHeaderLabelStyle(align: 'left' | 'right' = 'left'): CSSProperties {
  return {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: align,
  };
}

function buildDraftAllocationMap(
  allocations: FundsLocationMonthEntity['allocations'],
): DraftAllocationMap {
  return Object.fromEntries(
    allocations.map(allocation => [
      getFundsLocationAllocationKey(
        allocation.category_id,
        allocation.account_id,
      ),
      {
        categoryId: allocation.category_id,
        accountId: allocation.account_id,
        amount: allocation.amount,
      },
    ]),
  );
}

async function findCarriedOverDraftAllocationMap({
  month,
  allMonths,
  queryClient,
  validCategoryIds,
  validEditableAccountIds,
}: {
  month: string;
  allMonths: string[];
  queryClient: ReturnType<typeof useQueryClient>;
  validCategoryIds: Set<string>;
  validEditableAccountIds: Set<string>;
}) {
  const currentMonthIndex = allMonths.indexOf(month);
  if (currentMonthIndex <= 0) {
    return {};
  }

  for (let index = currentMonthIndex - 1; index >= 0; index--) {
    const priorMonth = allMonths[index];
    const priorMonthData = await queryClient.ensureQueryData(
      fundsLocationQueries.month(priorMonth),
    );

    if (!priorMonthData.hasSavedSnapshot) {
      continue;
    }

    return buildDraftAllocationMap(
      priorMonthData.allocations.filter(
        allocation =>
          validCategoryIds.has(allocation.category_id) &&
          validEditableAccountIds.has(allocation.account_id),
      ),
    );
  }

  return {};
}

function serializeDraftAllocationMap(draftAllocations: DraftAllocationMap) {
  return JSON.stringify(
    Object.values(draftAllocations)
      .filter(allocation => allocation.amount !== 0)
      .sort((left, right) =>
        `${left.categoryId}:${left.accountId}`.localeCompare(
          `${right.categoryId}:${right.accountId}`,
        ),
      ),
  );
}

function toDraftAllocationArray(
  draftAllocations: DraftAllocationMap,
): FundsLocationAllocationInput[] {
  return Object.values(draftAllocations).filter(
    allocation => allocation.amount !== 0,
  );
}

function getStickyCellStyle(
  column: StickyReportColumn,
  left: number,
  extraStyle?: CSSProperties,
) {
  return {
    position: 'sticky',
    left,
    minWidth: getStickyColumnMinWidth(column),
    backgroundColor: theme.tableBackground,
    zIndex: 2,
    ...extraStyle,
  } satisfies CSSProperties;
}

function getStickyColumnMinWidth(column: StickyReportColumn) {
  switch (column) {
    case 'group':
    case 'category':
      return 100;
    case 'balance':
    case 'allocated':
    case 'remainder':
      return 103;
    default:
      return 100;
  }
}

function getDefaultStickyColumnWidths(): Record<StickyReportColumn, number> {
  return {
    group: getStickyColumnMinWidth('group'),
    category: getStickyColumnMinWidth('category'),
    balance: getStickyColumnMinWidth('balance'),
    allocated: getStickyColumnMinWidth('allocated'),
    remainder: getStickyColumnMinWidth('remainder'),
  };
}

function getReportTableMinWidth({
  editableAccountCount,
  isHighAccountCount,
}: {
  editableAccountCount: number;
  isHighAccountCount: boolean;
}) {
  return (
    STICKY_COLUMNS.reduce(
      (sum, column) => sum + getStickyColumnMinWidth(column),
      0,
    ) + (isHighAccountCount ? 260 + 140 : editableAccountCount * 140)
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const format = useFormat();

  let color = theme.pageText;
  if (tone === 'warning') {
    color = theme.noticeText;
  } else if (tone === 'danger') {
    color = theme.errorText;
  }

  return (
    <Block
      style={{
        flex: '1 1 160px',
        minWidth: 160,
        padding: 14,
        backgroundColor: theme.tableBackground,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
      }}
    >
      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextSubdued,
          display: 'block',
          marginBottom: 8,
        }}
      >
        {label}
      </Text>
      <FinancialText style={{ color, ...styles.tnum }}>
        {format(value, 'financial')}
      </FinancialText>
    </Block>
  );
}

function getAllocationSliderMax({
  currentValue,
  categoryRemainder,
  accountRemainder,
}: {
  currentValue: number;
  categoryRemainder: number;
  accountRemainder: number;
}) {
  return (
    currentValue +
    Math.min(Math.max(0, categoryRemainder), Math.max(0, accountRemainder))
  );
}

function AllocationSlider({
  label,
  value,
  maxValue,
  onUpdate,
  showSummary = true,
}: {
  label: string;
  value: number;
  maxValue: number;
  onUpdate: (value: number) => void;
  showSummary?: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();

  return (
    <View style={{ gap: 6 }}>
      <input
        aria-label={label}
        type="range"
        min={0}
        max={maxValue}
        step={1}
        value={value}
        onChange={event => onUpdate(Number(event.target.value) || 0)}
        style={{
          width: '100%',
          margin: 0,
          accentColor: theme.buttonPrimaryBackground,
        }}
      />
      {showSummary ? (
        <View
          style={{
            gap: 8,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <FinancialText style={styles.tnum}>
            {format(value, 'financial')}
          </FinancialText>
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            {t('Max: {{amount}}', {
              amount: format(maxValue, 'financial'),
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function getDraftAllocationAmount(
  draftAllocations: DraftAllocationMap,
  categoryId: string,
  accountId: string,
) {
  return (
    draftAllocations[getFundsLocationAllocationKey(categoryId, accountId)]
      ?.amount ?? 0
  );
}

function getCategoryDialogDraftAllocations(
  categoryId: string,
  accountIds: string[],
  draftAllocations: DraftAllocationMap,
) {
  return Object.fromEntries(
    accountIds.map(accountId => [
      accountId,
      getDraftAllocationAmount(draftAllocations, categoryId, accountId),
    ]),
  );
}

function replaceCategoryDraftAllocations({
  draftAllocations,
  categoryId,
  accountAllocations,
}: {
  draftAllocations: DraftAllocationMap;
  categoryId: string;
  accountAllocations: Record<string, number>;
}) {
  const nextDraftAllocations = Object.fromEntries(
    Object.entries(draftAllocations).filter(
      ([, allocation]) => allocation.categoryId !== categoryId,
    ),
  ) as DraftAllocationMap;

  for (const [accountId, amount] of Object.entries(accountAllocations)) {
    if (amount === 0) {
      continue;
    }

    nextDraftAllocations[getFundsLocationAllocationKey(categoryId, accountId)] =
      {
        categoryId,
        accountId,
        amount,
      };
  }

  return nextDraftAllocations;
}

function getCategorySummaryAllocations({
  categoryId,
  editableAccounts,
  draftAllocations,
}: {
  categoryId: string;
  editableAccounts: Array<{ id: string; name: string }>;
  draftAllocations: DraftAllocationMap;
}) {
  return editableAccounts
    .map(account => ({
      accountId: account.id,
      accountName: account.name,
      amount: getDraftAllocationAmount(
        draftAllocations,
        categoryId,
        account.id,
      ),
    }))
    .filter(allocation => allocation.amount > 0)
    .sort((left, right) => {
      if (right.amount !== left.amount) {
        return right.amount - left.amount;
      }

      return left.accountName.localeCompare(right.accountName);
    });
}

function getInitialDialogAccountOrder({
  editableAccounts,
  allocations,
}: {
  editableAccounts: Array<{ id: string; name: string; balance: number }>;
  allocations: Record<string, number>;
}) {
  return editableAccounts
    .slice()
    .sort((left, right) => {
      const leftHasAllocation = (allocations[left.id] ?? 0) > 0;
      const rightHasAllocation = (allocations[right.id] ?? 0) > 0;

      if (leftHasAllocation !== rightHasAllocation) {
        return leftHasAllocation ? -1 : 1;
      }

      if (right.balance !== left.balance) {
        return right.balance - left.balance;
      }

      return left.name.localeCompare(right.name);
    })
    .map(account => account.id);
}

function getDefaultDialogSortDirection(column: DialogSortColumn) {
  switch (column) {
    case 'account':
      return 'asc';
    case 'default':
      return 'desc';
    case 'balance':
    case 'currentAllocation':
    case 'maxAvailable':
    case 'allocation':
      return 'desc';
    default:
      return 'desc';
  }
}

function getDefaultReportSortDirection(column: ReportSortColumn) {
  switch (column) {
    case 'group':
    case 'category':
    case 'summary':
      return 'asc';
    case 'default':
      return 'asc';
    case 'balance':
    case 'allocated':
    case 'remainder':
    case 'account':
      return 'desc';
    default:
      return 'asc';
  }
}

export function FundsLocation() {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();

  const { data: allMonths, isPending: isMonthsPending } = useQuery(
    fundsLocationQueries.months(),
  );

  const [selectedMonth, setSelectedMonth] = useState(monthUtils.currentMonth());
  const [draftAllocations, setDraftAllocations] = useState<DraftAllocationMap>(
    {},
  );
  const [reportSort, setReportSort] = useState<ReportSortState>({
    column: 'default',
    direction: getDefaultReportSortDirection('default'),
  });
  const [groupFilter, setGroupFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryDialogState, setCategoryDialogState] =
    useState<CategoryDialogState | null>(null);
  const [dialogSearch, setDialogSearch] = useState('');
  const stickyHeaderRefs = useRef<
    Partial<Record<StickyReportColumn, HTMLTableCellElement | null>>
  >({});
  const [stickyColumnWidths, setStickyColumnWidths] = useState<
    Record<StickyReportColumn, number>
  >(() => getDefaultStickyColumnWidths());

  useEffect(() => {
    if (!allMonths || allMonths.length === 0) {
      return;
    }

    if (!allMonths.includes(selectedMonth)) {
      setSelectedMonth(allMonths[allMonths.length - 1]);
    }
  }, [allMonths, selectedMonth]);

  const resolvedMonth =
    allMonths && allMonths.includes(selectedMonth)
      ? selectedMonth
      : (allMonths?.[allMonths.length - 1] ?? null);

  const fundsLocationQuery = useQuery(
    fundsLocationQueries.month(resolvedMonth),
  );
  const monthData = fundsLocationQuery.data;

  useEffect(() => {
    if (!monthData || !resolvedMonth) {
      return;
    }

    const currentMonthData = monthData;
    const month = resolvedMonth;
    let isCancelled = false;

    async function syncDraftAllocations() {
      const validCategoryIds = new Set(
        currentMonthData.categories.map(category => category.id),
      );
      const validEditableAccountIds = new Set(
        currentMonthData.editableAccounts.map(account => account.id),
      );
      const nextDraftAllocations =
        currentMonthData.hasSavedSnapshot || !allMonths
          ? buildDraftAllocationMap(currentMonthData.allocations)
          : await findCarriedOverDraftAllocationMap({
              month,
              allMonths,
              queryClient,
              validCategoryIds,
              validEditableAccountIds,
            });

      if (!isCancelled) {
        setDraftAllocations(nextDraftAllocations);
      }
    }

    void syncDraftAllocations();

    return () => {
      isCancelled = true;
    };
  }, [allMonths, monthData, queryClient, resolvedMonth]);

  useEffect(() => {
    setCategoryDialogState(null);
    setDialogSearch('');
  }, [resolvedMonth]);

  const displayData = useMemo(() => {
    if (!monthData) {
      return null;
    }

    const allAccounts = [
      ...monthData.editableAccounts,
      ...monthData.readOnlyAccounts,
    ].map(account => ({
      id: account.id,
      name: account.name,
      balance: account.balance,
      isEditable: account.isEditable,
    }));

    const categories = monthData.categories.map(category => ({
      id: category.id,
      name: category.name,
      group_id: category.group_id,
      group_name: category.group_name,
      balance: category.balance,
    }));

    const derived = deriveFundsLocationData({
      accounts: allAccounts,
      categories,
      allocations: toDraftAllocationArray(draftAllocations).map(allocation => ({
        category_id: allocation.categoryId,
        account_id: allocation.accountId,
        amount: allocation.amount,
      })),
    });

    return {
      ...monthData,
      editableAccounts: derived.accounts.filter(account => account.isEditable),
      readOnlyAccounts: derived.accounts.filter(account => !account.isEditable),
      categories: derived.categories,
      totals: derived.totals,
    };
  }, [draftAllocations, monthData]);

  const categoryRows = useMemo(() => {
    if (!displayData) {
      return [];
    }

    return displayData.categories.map((category, index) => {
      const summaryAllocations = getCategorySummaryAllocations({
        categoryId: category.id,
        editableAccounts: displayData.editableAccounts,
        draftAllocations,
      });
      const accountAmounts = Object.fromEntries(
        displayData.editableAccounts.map(account => [
          account.id,
          getDraftAllocationAmount(draftAllocations, category.id, account.id),
        ]),
      ) as Record<string, number>;

      return {
        category,
        index,
        summaryAllocations,
        summarySortValue:
          summaryAllocations.length > 0
            ? summaryAllocations
                .map(
                  allocation =>
                    `${allocation.accountName}:${String(allocation.amount).padStart(12, '0')}`,
                )
                .join('|')
            : 'Unassigned',
        accountAmounts,
      };
    });
  }, [displayData, draftAllocations]);

  useEffect(() => {
    if (
      groupFilter !== '' &&
      !categoryRows.some(row => row.category.group_name === groupFilter)
    ) {
      setGroupFilter('');
    }
  }, [categoryRows, groupFilter]);

  const groupFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(categoryRows.map(row => row.category.group_name)),
      ).sort((left, right) => left.localeCompare(right)),
    [categoryRows],
  );

  const filteredSortedCategoryRows = useMemo(() => {
    const normalizedCategoryFilter = categoryFilter.trim().toLocaleLowerCase();

    return categoryRows
      .filter(
        row =>
          (groupFilter === '' || row.category.group_name === groupFilter) &&
          (normalizedCategoryFilter === '' ||
            row.category.name
              .toLocaleLowerCase()
              .includes(normalizedCategoryFilter)),
      )
      .sort((left, right) => {
        const compareByDefaultOrder = () => left.index - right.index;

        switch (reportSort.column) {
          case 'default':
            return compareByDefaultOrder();
          case 'group': {
            const comparison =
              left.category.group_name.localeCompare(
                right.category.group_name,
              ) * (reportSort.direction === 'asc' ? 1 : -1);

            return (
              comparison ||
              left.category.name.localeCompare(right.category.name) ||
              compareByDefaultOrder()
            );
          }
          case 'category': {
            const comparison =
              left.category.name.localeCompare(right.category.name) *
              (reportSort.direction === 'asc' ? 1 : -1);

            return (
              comparison ||
              left.category.group_name.localeCompare(
                right.category.group_name,
              ) ||
              compareByDefaultOrder()
            );
          }
          case 'balance':
          case 'allocated':
          case 'remainder': {
            const comparison =
              ((left.category[reportSort.column] as number) -
                (right.category[reportSort.column] as number)) *
              (reportSort.direction === 'asc' ? 1 : -1);

            return (
              comparison ||
              left.category.name.localeCompare(right.category.name) ||
              compareByDefaultOrder()
            );
          }
          case 'summary': {
            const comparison =
              left.summarySortValue.localeCompare(right.summarySortValue) *
              (reportSort.direction === 'asc' ? 1 : -1);

            return comparison || compareByDefaultOrder();
          }
          case 'account': {
            const accountId = reportSort.accountId;
            const comparison =
              ((left.accountAmounts[accountId ?? ''] ?? 0) -
                (right.accountAmounts[accountId ?? ''] ?? 0)) *
              (reportSort.direction === 'asc' ? 1 : -1);

            return comparison || compareByDefaultOrder();
          }
          default:
            return compareByDefaultOrder();
        }
      });
  }, [categoryFilter, categoryRows, groupFilter, reportSort]);

  const saveMutation = useMutation<
    FundsLocationMonthEntity,
    Error,
    FundsLocationAllocationInput[]
  >({
    mutationFn: async (allocations: FundsLocationAllocationInput[]) => {
      if (!resolvedMonth) {
        throw new Error('Month is required to save funds location data');
      }

      return await send('funds-location/save-month', {
        month: resolvedMonth,
        allocations,
      });
    },
    onSuccess: async data => {
      queryClient.setQueryData(
        fundsLocationQueries.month(data.month).queryKey,
        data,
      );
      await queryClient.invalidateQueries({
        queryKey: fundsLocationQueries.all(),
      });
      dispatch(
        addNotification({
          notification: {
            type: 'message',
            message: t('Funds location saved.'),
          },
        }),
      );
    },
  });

  const monthBounds = useMemo(() => {
    if (!allMonths || allMonths.length === 0) {
      const currentMonth = monthUtils.currentMonth();
      return { start: currentMonth, end: currentMonth };
    }

    return {
      start: allMonths[0],
      end: allMonths[allMonths.length - 1],
    };
  }, [allMonths]);

  const initialSerialized = useMemo(
    () =>
      serializeDraftAllocationMap(
        buildDraftAllocationMap(monthData?.allocations ?? []),
      ),
    [monthData?.allocations],
  );
  const draftSerialized = useMemo(
    () => serializeDraftAllocationMap(draftAllocations),
    [draftAllocations],
  );
  const isDirty = initialSerialized !== draftSerialized;

  const accountWarningCount =
    displayData?.editableAccounts.filter(account => account.remainder !== 0)
      .length ?? 0;
  const isHighAccountCount =
    (displayData?.editableAccounts.length ?? 0) > HIGH_ACCOUNT_COUNT_THRESHOLD;

  const selectedDialogCategory = useMemo(() => {
    if (!displayData || !categoryDialogState) {
      return null;
    }

    return (
      displayData.categories.find(
        category => category.id === categoryDialogState.categoryId,
      ) ?? null
    );
  }, [categoryDialogState, displayData]);

  const setStickyHeaderRef =
    (column: StickyReportColumn) =>
    (element: HTMLTableCellElement | null) => {
      stickyHeaderRefs.current[column] = element;
    };

  useLayoutEffect(() => {
    if (!displayData) {
      return;
    }

    function measureStickyColumns() {
      setStickyColumnWidths(current => {
        const next = { ...current };
        let hasChanged = false;

        for (const column of STICKY_COLUMNS) {
          const element = stickyHeaderRefs.current[column];
          const width = Math.max(
            getStickyColumnMinWidth(column),
            Math.ceil(element?.getBoundingClientRect().width ?? 0),
          );

          if (current[column] !== width) {
            next[column] = width;
            hasChanged = true;
          }
        }

        return hasChanged ? next : current;
      });
    }

    measureStickyColumns();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => measureStickyColumns());

    for (const column of STICKY_COLUMNS) {
      const element = stickyHeaderRefs.current[column];
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [displayData, isHighAccountCount, isNarrowWidth, reportSort]);

  const dialogAllocatedTotal = useMemo(() => {
    if (!categoryDialogState) {
      return 0;
    }

    return Object.values(categoryDialogState.allocations).reduce(
      (sum, amount) => sum + amount,
      0,
    );
  }, [categoryDialogState]);

  const dialogRemainder = selectedDialogCategory
    ? selectedDialogCategory.balance - dialogAllocatedTotal
    : 0;

  const dialogAccountRows = useMemo(() => {
    if (!displayData || !categoryDialogState || !selectedDialogCategory) {
      return [];
    }

    const normalizedSearch = dialogSearch.trim().toLocaleLowerCase();
    const defaultOrderIndex = new Map(
      categoryDialogState.defaultOrder.map((accountId, index) => [
        accountId,
        index,
      ]),
    );
    const compareByDefaultOrder = (
      leftAccountId: string,
      rightAccountId: string,
    ) =>
      (defaultOrderIndex.get(leftAccountId) ?? Number.MAX_SAFE_INTEGER) -
      (defaultOrderIndex.get(rightAccountId) ?? Number.MAX_SAFE_INTEGER);

    return displayData.editableAccounts
      .map(account => {
        const value = categoryDialogState.allocations[account.id] ?? 0;
        const globalValue = getDraftAllocationAmount(
          draftAllocations,
          selectedDialogCategory.id,
          account.id,
        );
        const accountRemainder = account.remainder + globalValue - value;

        return {
          account,
          value,
          maxValue: getAllocationSliderMax({
            currentValue: value,
            categoryRemainder: dialogRemainder,
            accountRemainder,
          }),
        };
      })
      .sort((left, right) => {
        switch (categoryDialogState.sortColumn) {
          case 'default':
            return compareByDefaultOrder(left.account.id, right.account.id);
          case 'account': {
            const direction =
              categoryDialogState.sortDirection === 'asc' ? 1 : -1;
            const comparison =
              left.account.name.localeCompare(right.account.name) * direction;

            return (
              comparison ||
              compareByDefaultOrder(left.account.id, right.account.id)
            );
          }
          case 'balance':
          case 'currentAllocation':
          case 'maxAvailable':
          case 'allocation': {
            const direction =
              categoryDialogState.sortDirection === 'asc' ? 1 : -1;
            const leftValue =
              categoryDialogState.sortColumn === 'balance'
                ? left.account.balance
                : categoryDialogState.sortColumn === 'maxAvailable'
                  ? left.maxValue
                  : left.value;
            const rightValue =
              categoryDialogState.sortColumn === 'balance'
                ? right.account.balance
                : categoryDialogState.sortColumn === 'maxAvailable'
                  ? right.maxValue
                  : right.value;
            const comparison = (leftValue - rightValue) * direction;

            return (
              comparison ||
              compareByDefaultOrder(left.account.id, right.account.id)
            );
          }
          default:
            return compareByDefaultOrder(left.account.id, right.account.id);
        }
      })
      .filter(
        row =>
          normalizedSearch === '' ||
          row.account.name.toLocaleLowerCase().includes(normalizedSearch),
      );
  }, [
    categoryDialogState,
    dialogRemainder,
    dialogSearch,
    displayData,
    draftAllocations,
    selectedDialogCategory,
  ]);

  const updateAllocation = (
    categoryId: string,
    accountId: string,
    amount: number,
  ) => {
    setDraftAllocations(current => {
      const key = getFundsLocationAllocationKey(categoryId, accountId);
      if (amount === 0) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [key]: {
          categoryId,
          accountId,
          amount,
        },
      };
    });
  };

  const openCategoryDialog = (categoryId: string) => {
    if (!displayData) {
      return;
    }

    const allocations = getCategoryDialogDraftAllocations(
      categoryId,
      displayData.editableAccounts.map(account => account.id),
      draftAllocations,
    );

    setCategoryDialogState({
      categoryId,
      allocations,
      defaultOrder: getInitialDialogAccountOrder({
        editableAccounts: displayData.editableAccounts,
        allocations,
      }),
      sortColumn: 'default',
      sortDirection: getDefaultDialogSortDirection('default'),
    });
    setDialogSearch('');
  };

  const closeCategoryDialog = () => {
    setCategoryDialogState(null);
    setDialogSearch('');
  };

  const updateDialogAllocation = (accountId: string, amount: number) => {
    setCategoryDialogState(current =>
      current
        ? {
            ...current,
            allocations: {
              ...current.allocations,
              [accountId]: amount,
            },
          }
        : current,
    );
  };

  const updateDialogSort = (column: DialogSortColumn) => {
    setCategoryDialogState(current => {
      if (!current) {
        return current;
      }

      if (column === 'default') {
        return {
          ...current,
          sortColumn: 'default',
          sortDirection: getDefaultDialogSortDirection('default'),
        };
      }

      const nextDirection =
        current.sortColumn === column
          ? current.sortDirection === 'asc'
            ? 'desc'
            : 'asc'
          : getDefaultDialogSortDirection(column);

      return {
        ...current,
        sortColumn: column,
        sortDirection: nextDirection,
      };
    });
  };

  const updateReportSort = (
    column: ReportSortColumn,
    options?: { accountId?: string },
  ) => {
    setReportSort(current => {
      const isSameAccountColumn =
        column === 'account' &&
        current.column === 'account' &&
        current.accountId === options?.accountId;
      const isSameColumn =
        current.column === column &&
        (column !== 'account' || isSameAccountColumn);
      const nextDirection = isSameColumn
        ? current.direction === 'asc'
          ? 'desc'
          : 'asc'
        : getDefaultReportSortDirection(column);

      return {
        column,
        direction: nextDirection,
        accountId: options?.accountId,
      };
    });
  };

  const clearDialogRow = () => {
    if (!displayData || !categoryDialogState) {
      return;
    }

    setCategoryDialogState({
      ...categoryDialogState,
      allocations: Object.fromEntries(
        displayData.editableAccounts.map(account => [account.id, 0]),
      ),
    });
  };

  const applyDialogAllocations = () => {
    if (!categoryDialogState) {
      return;
    }

    setDraftAllocations(current =>
      replaceCategoryDraftAllocations({
        draftAllocations: current,
        categoryId: categoryDialogState.categoryId,
        accountAllocations: categoryDialogState.allocations,
      }),
    );
    closeCategoryDialog();
  };

  const renderDialogSortHeader = (
    label: string,
    column: DialogSortColumn,
    align: 'left' | 'right' = 'left',
  ) => {
    const isActive = categoryDialogState?.sortColumn === column;
    const sortLabel = isActive
      ? categoryDialogState.sortDirection === 'asc'
        ? t('{{label}} (ascending)', { label })
        : t('{{label}} (descending)', { label })
      : label;

    return (
      <Button
        variant="bare"
        aria-label={sortLabel}
        onPress={() => updateDialogSort(column)}
        style={getSortHeaderButtonStyle(align)}
      >
        <View
          style={{
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          <span style={getSortHeaderLabelStyle(align)}>{label}</span>
          {isActive && renderSortDirectionIcon(categoryDialogState.sortDirection)}
        </View>
      </Button>
    );
  };

  const renderReportSortHeader = (
    label: string,
    column: ReportSortColumn,
    options?: {
      align?: 'left' | 'right';
      accountId?: string;
      subtitle?: string;
    },
  ) => {
    const align = options?.align ?? 'left';
    const isActive =
      reportSort.column === column &&
      (column !== 'account' || reportSort.accountId === options?.accountId);
    const sortLabel = isActive
      ? reportSort.direction === 'asc'
        ? t('{{label}} (ascending)', { label })
        : t('{{label}} (descending)', { label })
      : label;

    return (
      <Button
        variant="bare"
        aria-label={sortLabel}
        onPress={() =>
          updateReportSort(column, { accountId: options?.accountId })
        }
        style={getSortHeaderButtonStyle(align)}
      >
        <View
          style={{
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          <span style={getSortHeaderLabelStyle(align)}>{label}</span>
          {isActive && renderSortDirectionIcon(reportSort.direction)}
        </View>
        {options?.subtitle ? (
          <Text
            style={{
              ...styles.smallText,
              color: theme.tableTextSubdued,
            }}
          >
            {options.subtitle}
          </Text>
        ) : null}
      </Button>
    );
  };

  if (isMonthsPending || fundsLocationQuery.isPending || !displayData || !monthData) {
    return <LoadingIndicator message={t('Loading funds location...')} />;
  }

  const currentMonthData = monthData;

  const header = isNarrowWidth ? (
    <MobilePageHeader
      title={t('Funds Location')}
      leftContent={<MobileBackButton onPress={() => navigate('/reports')} />}
    />
  ) : (
    <PageHeader title={t('Funds Location')} />
  );

  const stickyOffsets = {
    group: 0,
    category: stickyColumnWidths.group,
    balance: stickyColumnWidths.group + stickyColumnWidths.category,
    allocated:
      stickyColumnWidths.group +
      stickyColumnWidths.category +
      stickyColumnWidths.balance,
    remainder:
      stickyColumnWidths.group +
      stickyColumnWidths.category +
      stickyColumnWidths.balance +
      stickyColumnWidths.allocated,
  };
  const reportTableMinWidth = getReportTableMinWidth({
    editableAccountCount: displayData.editableAccounts.length,
    isHighAccountCount,
  });

  return (
    <Page header={header} padding={0}>
      <View style={{ gap: 16, padding: isNarrowWidth ? 10 : 20 }}>
        <View
          style={{
            gap: 12,
            padding: isNarrowWidth ? 12 : 16,
            backgroundColor: theme.tableBackground,
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
          }}
        >
          <View
            style={{
              gap: 12,
              flexDirection: isNarrowWidth ? 'column' : 'row',
              alignItems: isNarrowWidth ? 'stretch' : 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  ...styles.smallText,
                  color: theme.pageTextSubdued,
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                <Trans>Selected month</Trans>
              </Text>
              <MonthPicker
                startMonth={selectedMonth}
                numDisplayed={1}
                monthBounds={monthBounds}
                style={{ paddingTop: 0 }}
                onSelect={month => setSelectedMonth(month)}
              />
            </View>

            <View
              style={{
                gap: 8,
                flexDirection: isNarrowWidth ? 'column' : 'row',
              }}
            >
              <Button
                isDisabled={
                  saveMutation.isPending ||
                  !currentMonthData.hasSavedSnapshot ||
                  currentMonthData.allocations.length === 0
                }
                onPress={() => saveMutation.mutate([])}
              >
                <Trans>Clear saved month</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={saveMutation.isPending || !isDirty}
                onPress={() =>
                  saveMutation.mutate(toDraftAllocationArray(draftAllocations))
                }
              >
                <Trans>Save allocations</Trans>
              </Button>
            </View>
          </View>

          {!displayData.supported ? (
            <Block
              style={{
                padding: 16,
                border: `1px solid ${theme.pillBorder}`,
                backgroundColor: theme.noticeBackgroundLight,
              }}
            >
              <Trans>
                Funds Location is only available for envelope budgets.
              </Trans>
            </Block>
          ) : (
            <>
              <View
                style={{
                  gap: 12,
                  flexWrap: 'wrap',
                  flexDirection: 'row',
                }}
              >
                <SummaryStat
                  label={t('Category balance total')}
                  value={displayData.totals.categoryBalance}
                />
                <SummaryStat
                  label={t('Allocated total')}
                  value={displayData.totals.categoryAllocated}
                />
                <SummaryStat
                  label={t('Category remainder')}
                  value={displayData.totals.categoryRemainder}
                  tone={
                    displayData.totals.categoryRemainder === 0
                      ? 'default'
                      : displayData.totals.categoryRemainder > 0
                        ? 'warning'
                        : 'danger'
                  }
                />
                <SummaryStat
                  label={t('Editable account remainder')}
                  value={displayData.editableAccounts.reduce(
                    (sum, account) => sum + account.remainder,
                    0,
                  )}
                  tone={accountWarningCount === 0 ? 'default' : 'warning'}
                />
              </View>

              <View
                style={{
                  gap: 12,
                  flexDirection: isNarrowWidth ? 'column' : 'row',
                  alignItems: isNarrowWidth ? 'stretch' : 'center',
                }}
              >
                {/* <Block
                  style={{
                    flex: 1,
                    padding: 12,
                    border: `1px solid ${theme.pillBorder}`,
                    backgroundColor: theme.noticeBackgroundLight,
                  }}
                >
                  <Text>
                    <Trans>
                      {{ categoryWarningCount }} categories and{' '}
                      {{ accountWarningCount }} accounts currently have a
                      remainder.
                    </Trans>
                  </Text>
                </Block> */}

                {/* {displayData.readOnlyAccounts.length > 0 && (
                  <Block
                    style={{
                      flex: 1,
                      padding: 12,
                      border: `1px solid ${theme.pillBorder}`,
                    }}
                  >
                    <Block style={{ marginBottom: 8 }}>
                      <strong>{t('Read-only accounts')}</strong>
                    </Block>
                    <View style={{ gap: 6 }}>
                      {displayData.readOnlyAccounts.map(account => (
                        <View
                          key={account.id}
                          style={{
                            gap: 8,
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Text>{account.name}</Text>
                          <FinancialText style={styles.tnum}>
                            {format(account.balance, 'financial')}
                          </FinancialText>
                        </View>
                      ))}
                    </View>
                  </Block>
                )} */}
              </View>

              <View
                style={{
                  gap: 8,
                  paddingBottom: 8,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'stretch',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    flex: '1 1 220px',
                    minWidth: 220,
                  }}
                >
                  <Text
                    style={{
                      ...styles.smallText,
                      color: theme.pageTextSubdued,
                    }}
                  >
                    <Trans>Filter by group</Trans>
                  </Text>
                  <select
                    aria-label={t('Filter by group')}
                    value={groupFilter}
                    onChange={event => setGroupFilter(event.target.value)}
                    style={{
                      height: 36,
                      padding: '0 10px',
                      borderRadius: 4,
                      border: `1px solid ${theme.tableBorder}`,
                      backgroundColor: theme.tableBackground,
                      color: theme.pageText,
                    }}
                  >
                    <option value="">
                      <Trans>All groups</Trans>
                    </option>
                    {groupFilterOptions.map(groupName => (
                      <option key={groupName} value={groupName}>
                        {groupName}
                      </option>
                    ))}
                  </select>
                </label>

                <View
                  style={{
                    flex: '2 1 280px',
                    minWidth: 240,
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      ...styles.smallText,
                      color: theme.pageTextSubdued,
                    }}
                  >
                    <Trans>Filter by category</Trans>
                  </Text>
                  <Search
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    placeholder={t('Filter categories')}
                    width="100%"
                  />
                </View>

                {groupFilter !== '' || categoryFilter.trim() !== '' ? (
                  <Button
                    style={{
                      alignSelf: isNarrowWidth ? 'stretch' : 'flex-end',
                    }}
                    onPress={() => {
                      setGroupFilter('');
                      setCategoryFilter('');
                    }}
                  >
                    <Trans>Clear filters</Trans>
                  </Button>
                ) : null}
              </View>

              {displayData.categories.length === 0 ? (
                <Block
                  style={{
                    padding: 16,
                    border: `1px solid ${theme.pillBorder}`,
                  }}
                >
                  <Trans>
                    There are no positive category balances to allocate for this
                    month.
                  </Trans>
                </Block>
              ) : filteredSortedCategoryRows.length === 0 ? (
                <Block
                  style={{
                    padding: 16,
                    border: `1px solid ${theme.pillBorder}`,
                  }}
                >
                  <Trans>No categories match the current filters.</Trans>
                </Block>
              ) : (
                <div
                  style={{
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: isNarrowWidth
                      ? undefined
                      : 'calc(100vh - 320px)',
                    border: `1px solid ${theme.pillBorder}`,
                    backgroundColor: theme.tableBackground,
                  }}
                  data-testid="funds-location-table"
                >
                  <table
                    style={{
                      width: '100%',
                      minWidth: reportTableMinWidth,
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          ref={setStickyHeaderRef('group')}
                          style={{
                            ...getStickyCellStyle(
                              'group',
                              stickyOffsets.group,
                              { top: 0, zIndex: 5 },
                            ),
                            padding: 12,
                            textAlign: 'left',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {renderReportSortHeader(t('Group'), 'group')}
                        </th>
                        <th
                          ref={setStickyHeaderRef('category')}
                          style={{
                            ...getStickyCellStyle(
                              'category',
                              stickyOffsets.category,
                              { top: 0, zIndex: 5 },
                            ),
                            padding: 12,
                            textAlign: 'left',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {renderReportSortHeader(t('Category'), 'category')}
                        </th>
                        <th
                          ref={setStickyHeaderRef('balance')}
                          style={{
                            ...getStickyCellStyle(
                              'balance',
                              stickyOffsets.balance,
                              { top: 0, zIndex: 5 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {renderReportSortHeader(t('Balance'), 'balance', {
                            align: 'right',
                          })}
                        </th>
                        <th
                          ref={setStickyHeaderRef('allocated')}
                          style={{
                            ...getStickyCellStyle(
                              'allocated',
                              stickyOffsets.allocated,
                              { top: 0, zIndex: 5 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {renderReportSortHeader(t('Allocated'), 'allocated', {
                            align: 'right',
                          })}
                        </th>
                        <th
                          ref={setStickyHeaderRef('remainder')}
                          style={{
                            ...getStickyCellStyle(
                              'remainder',
                              stickyOffsets.remainder,
                              { top: 0, zIndex: 5 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {renderReportSortHeader(t('Remainder'), 'remainder', {
                            align: 'right',
                          })}
                        </th>
                        {isHighAccountCount ? (
                          <>
                            <th
                              style={{
                                minWidth: 260,
                                padding: 12,
                                verticalAlign: 'bottom',
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                position: 'sticky',
                                top: 0,
                                zIndex: 4,
                                backgroundColor: theme.tableBackground,
                              }}
                            >
                              {renderReportSortHeader(
                                t('Allocation summary'),
                                'summary',
                              )}
                            </th>
                            <th
                              style={{
                                minWidth: 140,
                                padding: 12,
                                verticalAlign: 'bottom',
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                position: 'sticky',
                                top: 0,
                                zIndex: 4,
                                backgroundColor: theme.tableBackground,
                              }}
                            >
                              <Trans>Actions</Trans>
                            </th>
                          </>
                        ) : (
                          displayData.editableAccounts.map(account => (
                            <th
                              key={account.id}
                              style={{
                                minWidth: 140,
                                padding: 12,
                                verticalAlign: 'bottom',
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                position: 'sticky',
                                top: 0,
                                zIndex: 4,
                                backgroundColor: theme.tableBackground,
                              }}
                            >
                              {renderReportSortHeader(account.name, 'account', {
                                accountId: account.id,
                                subtitle: format(account.balance, 'financial'),
                              })}
                            </th>
                          ))
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSortedCategoryRows.map(row => {
                        const { category, summaryAllocations, accountAmounts } =
                          row;
                        const visibleSummaryAllocations =
                          summaryAllocations.slice(0, 3);
                        const hiddenSummaryCount =
                          summaryAllocations.length -
                          visibleSummaryAllocations.length;

                        return (
                          <tr key={category.id}>
                            <td
                              style={{
                                ...getStickyCellStyle(
                                  'group',
                                  stickyOffsets.group,
                                ),
                                padding: 12,
                                borderBottom: `1px solid ${theme.tableBorder}`,
                              }}
                            >
                              {category.group_name}
                            </td>
                            <td
                              style={{
                                ...getStickyCellStyle(
                                  'category',
                                  stickyOffsets.category,
                                ),
                                padding: 12,
                                borderBottom: `1px solid ${theme.tableBorder}`,
                              }}
                            >
                              {category.name}
                            </td>
                            <td
                              style={{
                                ...getStickyCellStyle(
                                  'balance',
                                  stickyOffsets.balance,
                                ),
                                padding: 12,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                ...styles.tnum,
                              }}
                            >
                              <FinancialText>
                                {format(category.balance, 'financial')}
                              </FinancialText>
                            </td>
                            <td
                              style={{
                                ...getStickyCellStyle(
                                  'allocated',
                                  stickyOffsets.allocated,
                                ),
                                padding: 12,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                color: category.isOverallocated
                                  ? theme.errorText
                                  : theme.pageText,
                                ...styles.tnum,
                              }}
                            >
                              <FinancialText>
                                {format(category.allocated, 'financial')}
                              </FinancialText>
                            </td>
                            <td
                              style={{
                                ...getStickyCellStyle(
                                  'remainder',
                                  stickyOffsets.remainder,
                                ),
                                padding: 12,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.tableBorder}`,
                                color:
                                  category.remainder === 0
                                    ? theme.pageText
                                    : category.remainder > 0
                                      ? theme.noticeText
                                      : theme.errorText,
                                ...styles.tnum,
                              }}
                            >
                              <FinancialText>
                                {format(category.remainder, 'financial')}
                              </FinancialText>
                            </td>
                            {isHighAccountCount ? (
                              <>
                                <td
                                  style={{
                                    minWidth: 260,
                                    padding: 12,
                                    borderBottom: `1px solid ${theme.tableBorder}`,
                                    verticalAlign: 'top',
                                  }}
                                >
                                  {visibleSummaryAllocations.length > 0 ? (
                                    <View style={{ gap: 4 }}>
                                      {visibleSummaryAllocations.map(
                                        allocation => (
                                          <View
                                            key={`${category.id}-${allocation.accountId}`}
                                            style={{
                                              gap: 8,
                                              flexDirection: 'row',
                                              justifyContent: 'space-between',
                                            }}
                                          >
                                            <Text>
                                              {allocation.accountName}
                                            </Text>
                                            <FinancialText style={styles.tnum}>
                                              {format(
                                                allocation.amount,
                                                'financial',
                                              )}
                                            </FinancialText>
                                          </View>
                                        ),
                                      )}
                                      {hiddenSummaryCount > 0 ? (
                                        <Text
                                          style={{
                                            ...styles.smallText,
                                            color: theme.pageTextSubdued,
                                          }}
                                        >
                                          {t('+{{count}} more', {
                                            count: hiddenSummaryCount,
                                          })}
                                        </Text>
                                      ) : null}
                                    </View>
                                  ) : (
                                    <Text
                                      style={{
                                        color: theme.pageTextSubdued,
                                      }}
                                    >
                                      <Trans>Unassigned</Trans>
                                    </Text>
                                  )}
                                </td>
                                <td
                                  style={{
                                    minWidth: 140,
                                    padding: 12,
                                    borderBottom: `1px solid ${theme.tableBorder}`,
                                    verticalAlign: 'top',
                                  }}
                                >
                                  <Button
                                    onPress={() =>
                                      openCategoryDialog(category.id)
                                    }
                                  >
                                    <Trans>Edit accounts</Trans>
                                  </Button>
                                </td>
                              </>
                            ) : (
                              displayData.editableAccounts.map(account => {
                                const value = accountAmounts[account.id] ?? 0;
                                const maxAllocation = getAllocationSliderMax({
                                  currentValue: value,
                                  categoryRemainder: category.remainder,
                                  accountRemainder: account.remainder,
                                });

                                return (
                                  <td
                                    key={`${category.id}-${account.id}`}
                                    style={{
                                      minWidth: 140,
                                      padding: 8,
                                      borderBottom: `1px solid ${theme.tableBorder}`,
                                    }}
                                  >
                                    <AllocationSlider
                                      label={t(
                                        '{{category}} allocation in {{account}}',
                                        {
                                          category: category.name,
                                          account: account.name,
                                        },
                                      )}
                                      value={value}
                                      maxValue={maxAllocation}
                                      onUpdate={nextValue =>
                                        updateAllocation(
                                          category.id,
                                          account.id,
                                          Math.min(nextValue, maxAllocation),
                                        )
                                      }
                                    />
                                  </td>
                                );
                              })
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td
                          style={{
                            ...getStickyCellStyle(
                              'group',
                              stickyOffsets.group,
                              { top: 'auto', zIndex: 3 },
                            ),
                            padding: 12,
                            borderTop: `1px solid ${theme.tableBorder}`,
                            fontWeight: 600,
                          }}
                        >
                          <Trans>Account totals</Trans>
                        </td>
                        <td
                          style={{
                            ...getStickyCellStyle(
                              'category',
                              stickyOffsets.category,
                              { top: 'auto', zIndex: 3 },
                            ),
                            padding: 12,
                            borderTop: `1px solid ${theme.tableBorder}`,
                          }}
                        />
                        <td
                          style={{
                            ...getStickyCellStyle(
                              'balance',
                              stickyOffsets.balance,
                              { top: 'auto', zIndex: 3 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderTop: `1px solid ${theme.tableBorder}`,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(
                              displayData.totals.accountBalance,
                              'financial',
                            )}
                          </FinancialText>
                        </td>
                        <td
                          style={{
                            ...getStickyCellStyle(
                              'allocated',
                              stickyOffsets.allocated,
                              { top: 'auto', zIndex: 3 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderTop: `1px solid ${theme.tableBorder}`,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(
                              displayData.totals.accountAllocated,
                              'financial',
                            )}
                          </FinancialText>
                        </td>
                        <td
                          style={{
                            ...getStickyCellStyle(
                              'remainder',
                              stickyOffsets.remainder,
                              { top: 'auto', zIndex: 3 },
                            ),
                            padding: 12,
                            textAlign: 'right',
                            borderTop: `1px solid ${theme.tableBorder}`,
                            color:
                              displayData.totals.accountRemainder === 0
                                ? theme.pageText
                                : theme.noticeText,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(
                              displayData.totals.accountRemainder,
                              'financial',
                            )}
                          </FinancialText>
                        </td>
                        {isHighAccountCount ? (
                          <>
                            <td
                              style={{
                                minWidth: 260,
                                padding: 12,
                                borderTop: `1px solid ${theme.tableBorder}`,
                                color: theme.pageTextSubdued,
                              }}
                            >
                              <Trans>
                                Use each row's editor to adjust accounts.
                              </Trans>
                            </td>
                            <td
                              style={{
                                minWidth: 140,
                                padding: 12,
                                borderTop: `1px solid ${theme.tableBorder}`,
                              }}
                            />
                          </>
                        ) : (
                          displayData.editableAccounts.map(account => (
                            <td
                              key={account.id}
                              style={{
                                minWidth: 140,
                                padding: 12,
                                borderTop: `1px solid ${theme.tableBorder}`,
                                verticalAlign: 'top',
                              }}
                            >
                              <Block
                                style={{ ...styles.tnum, marginBottom: 4 }}
                              >
                                <FinancialText>
                                  {format(account.allocated, 'financial')}
                                </FinancialText>
                              </Block>
                              <Text
                                style={{
                                  ...styles.smallText,
                                  color:
                                    account.remainder === 0
                                      ? theme.pageTextSubdued
                                      : theme.noticeText,
                                }}
                              >
                                <Trans>
                                  Remainder:{' '}
                                  <FinancialText>
                                    {format(account.remainder, 'financial')}
                                  </FinancialText>
                                </Trans>
                              </Text>
                            </td>
                          ))
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </View>
      </View>

      {selectedDialogCategory && categoryDialogState ? (
        <Modal
          name="funds-location-category-allocation"
          onClose={closeCategoryDialog}
          containerProps={{
            style: {
              minWidth: 'min(960px, 95vw)',
              maxWidth: 'min(960px, 95vw)',
            },
          }}
        >
          <ModalHeader
            title={selectedDialogCategory.name}
            rightContent={<ModalCloseButton onPress={closeCategoryDialog} />}
          />

          <View style={{ gap: 16, padding: 12 }}>
            <View
              style={{
                gap: 12,
                flexWrap: 'wrap',
                flexDirection: 'row',
              }}
            >
              <SummaryStat
                label={t('Category balance')}
                value={selectedDialogCategory.balance}
              />
              <SummaryStat
                label={t('Currently allocated')}
                value={dialogAllocatedTotal}
              />
              <SummaryStat
                label={t('Remainder')}
                value={dialogRemainder}
                tone={
                  dialogRemainder === 0
                    ? 'default'
                    : dialogRemainder > 0
                      ? 'warning'
                      : 'danger'
                }
              />
            </View>

            {displayData.editableAccounts.length > ACCOUNT_SEARCH_THRESHOLD ? (
              <Search
                value={dialogSearch}
                onChange={setDialogSearch}
                placeholder={t('Search accounts')}
                isInModal
                width="100%"
              />
            ) : null}

            <div
              style={{
                overflowY: 'auto',
                maxHeight: 'min(60vh, 640px)',
                border: `1px solid ${theme.tableBorder}`,
                backgroundColor: theme.tableBackground,
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: 12,
                        textAlign: 'left',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      {renderDialogSortHeader(t('Account'), 'account')}
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: 'right',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      {renderDialogSortHeader(t('Balance'), 'balance', 'right')}
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: 'right',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      {renderDialogSortHeader(
                        t('Current allocation'),
                        'currentAllocation',
                        'right',
                      )}
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: 'right',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      {renderDialogSortHeader(
                        t('Max available'),
                        'maxAvailable',
                        'right',
                      )}
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: 'left',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      {renderDialogSortHeader(t('Allocation'), 'allocation')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dialogAccountRows.length > 0 ? (
                    dialogAccountRows.map(row => (
                      <tr key={row.account.id}>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: `1px solid ${theme.tableBorder}`,
                          }}
                        >
                          {row.account.name}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(row.account.balance, 'financial')}
                          </FinancialText>
                        </td>
                        <td
                          style={{
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(row.value, 'financial')}
                          </FinancialText>
                        </td>
                        <td
                          style={{
                            padding: 12,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            ...styles.tnum,
                          }}
                        >
                          <FinancialText>
                            {format(row.maxValue, 'financial')}
                          </FinancialText>
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            minWidth: 280,
                          }}
                        >
                          <AllocationSlider
                            label={t('{{category}} allocation in {{account}}', {
                              category: selectedDialogCategory.name,
                              account: row.account.name,
                            })}
                            value={row.value}
                            maxValue={row.maxValue}
                            showSummary={false}
                            onUpdate={nextValue =>
                              updateDialogAllocation(
                                row.account.id,
                                Math.min(nextValue, row.maxValue),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: 16,
                          color: theme.pageTextSubdued,
                        }}
                      >
                        <Trans>No accounts match this search.</Trans>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <ModalButtons
              leftContent={
                <Button onPress={clearDialogRow}>
                  <Trans>Clear row</Trans>
                </Button>
              }
            >
              <View style={{ gap: 8, flexDirection: 'row' }}>
                <Button onPress={closeCategoryDialog}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button variant="primary" onPress={applyDialogAllocations}>
                  <Trans>Apply</Trans>
                </Button>
              </View>
            </ModalButtons>
          </View>
        </Modal>
      ) : null}
    </Page>
  );
}
