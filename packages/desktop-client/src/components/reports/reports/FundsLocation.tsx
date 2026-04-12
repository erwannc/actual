import React, { useEffect, useMemo, useRef, useState } from 'react';
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

import { AllocationSlider } from './FundsLocationAllocationSlider';
import { MobileFundsLocationPage } from './FundsLocationMobilePage';

type DraftAllocationMap = Record<string, FundsLocationAllocationInput>;
type FundsLocationReportView = 'category' | 'account';

const STICKY_COLUMNS = [
  'group',
  'category',
  'balance',
  'allocated',
] as const;
const HIGH_ACCOUNT_COUNT_THRESHOLD = 5;
const ACCOUNT_SEARCH_THRESHOLD = 10;

type StickyReportColumn = (typeof STICKY_COLUMNS)[number];

type ReportSortColumn =
  | 'default'
  | 'accountName'
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
  maxAvailableOrder?: string[];
};
type ReportSortState = {
  column: ReportSortColumn;
  direction: ReportSortDirection;
  accountId?: string;
};

type SaveMutationVariables = {
  month: string;
  allocations: FundsLocationAllocationInput[];
  silent?: boolean;
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

function toDraftAllocationArray(
  draftAllocations: DraftAllocationMap,
): FundsLocationAllocationInput[] {
  return Object.values(draftAllocations).filter(
    allocation => allocation.amount !== 0,
  );
}

function getStickyColumnMinWidth(column: StickyReportColumn) {
  switch (column) {
    case 'group':
    case 'category':
      return 100;
    case 'balance':
    case 'allocated':
      return 103;
    default:
      return 100;
  }
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

function CompactUsage({
  allocated,
  balance,
  remainder,
  textColor,
  subduedColor,
  trackColor,
}: {
  allocated: number;
  balance: number;
  remainder: number;
  textColor: string;
  subduedColor: string;
  trackColor: string;
}) {
  const format = useFormat();
  const usageColor =
    remainder < 0
      ? theme.reportsRed
      : allocated === 0
        ? theme.reportsGray
        : remainder === 0
          ? theme.reportsGreen
          : theme.reportsBlue;
  const usageRatio =
    balance > 0 ? Math.max(0, Math.min(1, allocated / balance)) : 0;

  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          gap: 4,
          flexDirection: 'row',
          alignItems: 'baseline',
          color: textColor,
          ...styles.tnum,
        }}
      >
        <FinancialText style={{ color: textColor }}>
          {format(allocated, 'financial')}
        </FinancialText>
        <Text style={{ color: subduedColor }}>/</Text>
        <FinancialText style={{ color: subduedColor }}>
          {format(balance, 'financial')}
        </FinancialText>
      </View>

      <div
        aria-hidden="true"
        style={{
          height: 6,
          width: '100%',
          overflow: 'hidden',
          borderRadius: 999,
          backgroundColor: trackColor,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${usageRatio * 100}%`,
            borderRadius: 999,
            backgroundColor: usageColor,
          }}
        />
      </div>

      <Text
        style={{
          ...styles.smallText,
          color: usageColor,
        }}
      >
        {remainder === 0 ? (
          <Trans>Fully allocated</Trans>
        ) : remainder > 0 ? (
          <Trans>
            <FinancialText>{format(remainder, 'financial')}</FinancialText> left
          </Trans>
        ) : (
          <Trans>
            Over by{' '}
            <FinancialText>{format(Math.abs(remainder), 'financial')}</FinancialText>
          </Trans>
        )}
      </Text>
    </View>
  );
}

function UsageSummaryCard({
  label,
  allocated,
  balance,
  remainder,
  note,
  onNotePress,
}: {
  label: string;
  allocated: number;
  balance: number;
  remainder: number;
  note?: React.ReactNode;
  onNotePress?: () => void;
}) {
  return (
    <Block
      style={{
        flex: '1 1 280px',
        minWidth: 240,
        padding: 14,
        backgroundColor: theme.tableBackground,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
      }}
    >
      <View style={{ gap: 10 }}>
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextSubdued,
          }}
        >
          {label}
        </Text>

        <CompactUsage
          allocated={allocated}
          balance={balance}
          remainder={remainder}
          textColor={theme.pageText}
          subduedColor={theme.pageTextSubdued}
          trackColor={theme.tableBorder}
        />

        {note ? (
          onNotePress ? (
            <Button
              variant="bare"
              onPress={onNotePress}
              style={{
                padding: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                color: theme.pageTextSubdued,
              }}
            >
              <Text
                style={{
                  ...styles.smallText,
                  color: theme.pageTextSubdued,
                }}
              >
                {note}
              </Text>
            </Button>
          ) : (
            <Text
              style={{
                ...styles.smallText,
                color: theme.pageTextSubdued,
              }}
            >
              {note}
            </Text>
          )
        ) : null}
      </View>
    </Block>
  );
}

function CompactCapacity({
  value,
  balance,
  maxValue,
  textColor,
  subduedColor,
  trackColor,
}: {
  value: number;
  balance: number;
  maxValue: number;
  textColor: string;
  subduedColor: string;
  trackColor: string;
}) {
  const format = useFormat();
  const usageColor =
    value === 0
      ? theme.reportsGray
      : value >= balance
        ? theme.reportsGreen
        : theme.reportsBlue;
  const allocationRatio = balance > 0 ? Math.max(0, Math.min(1, value / balance)) : 0;
  const availableRatio =
    balance > 0 ? Math.max(0, Math.min(1, maxValue / balance)) : 0;
  const moreAvailable = Math.max(0, maxValue - value);

  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          gap: 4,
          flexDirection: 'row',
          alignItems: 'baseline',
          color: textColor,
          ...styles.tnum,
        }}
      >
        <FinancialText style={{ color: textColor }}>
          {format(value, 'financial')}
        </FinancialText>
        <Text style={{ color: subduedColor }}>/</Text>
        <FinancialText style={{ color: subduedColor }}>
          {format(balance, 'financial')}
        </FinancialText>
      </View>

      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          height: 6,
          width: '100%',
          overflow: 'hidden',
          borderRadius: 999,
          backgroundColor: trackColor,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${availableRatio * 100}%`,
            borderRadius: 999,
            backgroundColor: usageColor,
            opacity: 0.2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${allocationRatio * 100}%`,
            borderRadius: 999,
            backgroundColor: usageColor,
          }}
        />
      </div>

      <Text
        style={{
          ...styles.smallText,
          color: moreAvailable > 0 ? theme.reportsBlue : usageColor,
        }}
      >
        {moreAvailable > 0 ? (
          <Trans>
            Up to <FinancialText>{format(maxValue, 'financial')}</FinancialText>
          </Trans>
        ) : (
          <Trans>At max available</Trans>
        )}
      </Text>
    </View>
  );
}

function getAllocationSummaryOpacity(index: number) {
  switch (index) {
    case 0:
      return 1;
    case 1:
      return 0.78;
    case 2:
      return 0.58;
    default:
      return 0.36;
  }
}

function CompactBreakdownSummary({
  items,
  emptyLabel,
  textColor,
  subduedColor,
  trackColor,
  separatorColor,
}: {
  items: Array<{
    id: string;
    label: React.ReactNode;
    amount: number;
  }>;
  emptyLabel: string;
  textColor: string;
  subduedColor: string;
  trackColor: string;
  separatorColor: string;
}) {
  const format = useFormat();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const totalAllocated = items.reduce((sum, item) => sum + item.amount, 0);
  const collapsedVisibleCount = 3;
  const hiddenItemCount = Math.max(0, items.length - collapsedVisibleCount);
  const visibleItems = isExpanded ? items : items.slice(0, collapsedVisibleCount);

  if (visibleItems.length === 0 || totalAllocated <= 0) {
    return (
      <Text
        style={{
          color: subduedColor,
        }}
      >
        {emptyLabel}
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          height: 8,
          width: '100%',
          overflow: 'hidden',
          borderRadius: 999,
          backgroundColor: trackColor,
        }}
      >
        {items.map((item, index) => (
          <div
            key={`${item.id}-segment`}
            style={{
              width: `${(item.amount / totalAllocated) * 100}%`,
              minWidth: 0,
              backgroundColor: theme.reportsBlue,
              opacity: getAllocationSummaryOpacity(index),
              borderRight:
                index < items.length - 1
                  ? `1px solid ${separatorColor}`
                  : undefined,
            }}
          />
        ))}
      </div>

      <View style={{ gap: 6 }}>
        {visibleItems.map((item, index) => (
          <View
            key={item.id}
            style={{
              gap: 4,
            }}
          >
            <View
              style={{
                gap: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <Text style={{ color: textColor }}>{item.label}</Text>
              <FinancialText style={{ ...styles.tnum, color: textColor }}>
                {format(item.amount, 'financial')}
              </FinancialText>
            </View>

            <div
              aria-hidden="true"
              style={{
                height: 4,
                width: '100%',
                overflow: 'hidden',
                borderRadius: 999,
                backgroundColor: trackColor,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(item.amount / totalAllocated) * 100}%`,
                  borderRadius: 999,
                  backgroundColor: theme.reportsBlue,
                  opacity: getAllocationSummaryOpacity(index),
                }}
              />
            </div>
          </View>
        ))}

        {hiddenItemCount > 0 ? (
          <Button
            variant="bare"
            onPress={() => setIsExpanded(current => !current)}
            style={{
              minWidth: 0,
              justifyContent: 'flex-start',
              padding: 0,
              color: subduedColor,
            }}
          >
            <Text
              style={{
                ...styles.smallText,
                color: subduedColor,
              }}
            >
              {isExpanded
                ? t('Show less')
                : t('+{{count}} more', {
                    count: hiddenItemCount,
                  })}
            </Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function AllocationSummary({
  allocations,
}: {
  allocations: Array<{
    accountId: string;
    accountName: string;
    amount: number;
  }>;
}) {
  return (
    <CompactBreakdownSummary
      items={allocations.map(allocation => ({
        id: allocation.accountId,
        label: allocation.accountName,
        amount: allocation.amount,
      }))}
      emptyLabel="Unassigned"
      textColor={theme.pageText}
      subduedColor={theme.pageTextSubdued}
      trackColor={theme.tableBorder}
      separatorColor={theme.tableBackground}
    />
  );
}

function AllocatedCategoriesSummary({
  allocations,
  textColor,
  subduedColor,
  trackColor,
  separatorColor,
}: {
  allocations: Array<{
    categoryId: string;
    categoryName: string;
    groupName: string;
    amount: number;
  }>;
  textColor: string;
  subduedColor: string;
  trackColor: string;
  separatorColor: string;
}) {
  return (
    <CompactBreakdownSummary
      items={allocations.map(allocation => ({
        id: allocation.categoryId,
        label: (
          <>
            {allocation.categoryName}{' '}
            <span style={{ color: subduedColor }}>{allocation.groupName}</span>
          </>
        ),
        amount: allocation.amount,
      }))}
      emptyLabel="Unassigned"
      textColor={textColor}
      subduedColor={subduedColor}
      trackColor={trackColor}
      separatorColor={separatorColor}
    />
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

function getAccountCategoryAllocations({
  accountId,
  categories,
  draftAllocations,
}: {
  accountId: string;
  categories: Array<{
    id: string;
    name: string;
    group_name: string;
  }>;
  draftAllocations: DraftAllocationMap;
}) {
  return categories
    .map(category => ({
      categoryId: category.id,
      categoryName: category.name,
      groupName: category.group_name,
      amount: getDraftAllocationAmount(
        draftAllocations,
        category.id,
        accountId,
      ),
    }))
    .filter(allocation => allocation.amount > 0)
    .sort((left, right) => {
      if (right.amount !== left.amount) {
        return right.amount - left.amount;
      }

      return left.categoryName.localeCompare(right.categoryName);
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

function getDialogMaxAvailableOrder({
  editableAccounts,
  categoryId,
  allocations,
  draftAllocations,
  categoryRemainder,
  sortDirection,
}: {
  editableAccounts: Array<{ id: string; name: string; balance: number; remainder: number }>;
  categoryId: string;
  allocations: Record<string, number>;
  draftAllocations: DraftAllocationMap;
  categoryRemainder: number;
  sortDirection: DialogSortDirection;
}) {
  const direction = sortDirection === 'asc' ? 1 : -1;

  return editableAccounts
    .map(account => {
      const value = allocations[account.id] ?? 0;
      const globalValue = getDraftAllocationAmount(
        draftAllocations,
        categoryId,
        account.id,
      );
      const accountRemainder = account.remainder + globalValue - value;

      return {
        accountId: account.id,
        accountName: account.name,
        maxValue: getAllocationSliderMax({
          currentValue: value,
          categoryRemainder,
          accountRemainder,
        }),
      };
    })
    .sort((left, right) => {
      const comparison = (left.maxValue - right.maxValue) * direction;

      return (
        comparison || left.accountName.localeCompare(right.accountName)
      );
    })
    .map(row => row.accountId);
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
    case 'accountName':
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
  const draftAllocationsRef = useRef<DraftAllocationMap>({});
  const [reportSort, setReportSort] = useState<ReportSortState>({
    column: 'default',
    direction: getDefaultReportSortDirection('default'),
  });
  const [reportView, setReportView] =
    useState<FundsLocationReportView>('category');
  const [groupFilter, setGroupFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [isClearSavedMonthConfirmationOpen, setIsClearSavedMonthConfirmationOpen] =
    useState(false);
  const [isClearDialogRowsConfirmationOpen, setIsClearDialogRowsConfirmationOpen] =
    useState(false);
  const [categoryDialogState, setCategoryDialogState] =
    useState<CategoryDialogState | null>(null);
  const categoryDialogStateRef = useRef<CategoryDialogState | null>(null);
  const [dialogSearch, setDialogSearch] = useState('');

  useEffect(() => {
    draftAllocationsRef.current = draftAllocations;
  }, [draftAllocations]);

  useEffect(() => {
    categoryDialogStateRef.current = categoryDialogState;
  }, [categoryDialogState]);
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

        if (
          !currentMonthData.hasSavedSnapshot &&
          Object.keys(nextDraftAllocations).length > 0
        ) {
          saveMutation.mutate({
            month,
            allocations: toDraftAllocationArray(nextDraftAllocations),
            silent: true,
          });
        }
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
    setIsClearSavedMonthConfirmationOpen(false);
    setIsClearDialogRowsConfirmationOpen(false);
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

  const accountRows = useMemo(() => {
    if (!displayData) {
      return [];
    }

    return displayData.editableAccounts.map((account, index) => {
      const categoryAllocations = getAccountCategoryAllocations({
        accountId: account.id,
        categories: displayData.categories,
        draftAllocations,
      });

      return {
        account,
        index,
        categoryAllocations,
        summarySortValue:
          categoryAllocations.length > 0
            ? categoryAllocations
              .map(
                allocation =>
                  `${allocation.categoryName}:${String(allocation.amount).padStart(12, '0')}`,
              )
              .join('|')
            : 'Unassigned',
      };
    });
  }, [displayData, draftAllocations]);

  const sortedAccountRows = useMemo(() => {
    return [...accountRows].sort((left, right) => {
      const compareByDefaultOrder = () => left.index - right.index;

      switch (reportSort.column) {
        case 'default':
          return compareByDefaultOrder();
        case 'accountName': {
          const comparison =
            left.account.name.localeCompare(right.account.name) *
            (reportSort.direction === 'asc' ? 1 : -1);

          return comparison || compareByDefaultOrder();
        }
        case 'balance':
        case 'allocated':
        case 'remainder': {
          const comparison =
            ((left.account[reportSort.column] as number) -
              (right.account[reportSort.column] as number)) *
            (reportSort.direction === 'asc' ? 1 : -1);

          return (
            comparison ||
            left.account.name.localeCompare(right.account.name) ||
            compareByDefaultOrder()
          );
        }
        case 'summary': {
          const comparison =
            left.summarySortValue.localeCompare(right.summarySortValue) *
            (reportSort.direction === 'asc' ? 1 : -1);

          return (
            comparison ||
            left.account.name.localeCompare(right.account.name) ||
            compareByDefaultOrder()
          );
        }
        default:
          return compareByDefaultOrder();
      }
    });
  }, [accountRows, reportSort]);

  const filteredSortedAccountRows = useMemo(() => {
    const normalizedAccountFilter = accountFilter.trim().toLocaleLowerCase();

    return sortedAccountRows.filter(
      row =>
        normalizedAccountFilter === '' ||
        row.account.name.toLocaleLowerCase().includes(normalizedAccountFilter),
    );
  }, [accountFilter, sortedAccountRows]);

  const saveMutation = useMutation<
    FundsLocationMonthEntity,
    Error,
    SaveMutationVariables
  >({
    mutationFn: async ({ month, allocations }: SaveMutationVariables) => {
      return await send('funds-location/save-month', {
        month,
        allocations,
      });
    },
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(
        fundsLocationQueries.month(data.month).queryKey,
        data,
      );
      await queryClient.invalidateQueries({
        queryKey: fundsLocationQueries.all(),
      });
      if (!variables.silent) {
        dispatch(
          addNotification({
            notification: {
              type: 'message',
              message: t('Funds location saved.'),
            },
          }),
        );
      }
    },
  });

  const pendingAutoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingAutoSave = () => {
    if (pendingAutoSaveRef.current) {
      clearTimeout(pendingAutoSaveRef.current);
      pendingAutoSaveRef.current = null;
    }
  };

  const persistAllocations = ({
    month,
    allocations,
    silent = false,
  }: SaveMutationVariables) => {
    cancelPendingAutoSave();
    saveMutation.mutate({
      month,
      allocations,
      silent,
    });
  };

  const scheduleAutoSave = ({
    month,
    nextDraftAllocations,
  }: {
    month: string;
    nextDraftAllocations: DraftAllocationMap;
  }) => {
    cancelPendingAutoSave();
    pendingAutoSaveRef.current = setTimeout(() => {
      saveMutation.mutate({
        month,
        allocations: toDraftAllocationArray(nextDraftAllocations),
        silent: true,
      });
      pendingAutoSaveRef.current = null;
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (pendingAutoSaveRef.current) {
        clearTimeout(pendingAutoSaveRef.current);
        pendingAutoSaveRef.current = null;
      }
    };
  }, []);

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
    const maxAvailableOrderIndex = new Map(
      (categoryDialogState.maxAvailableOrder ?? []).map((accountId, index) => [
        accountId,
        index,
      ]),
    );
    const compareByMaxAvailableOrder = (
      leftAccountId: string,
      rightAccountId: string,
    ) =>
      (maxAvailableOrderIndex.get(leftAccountId) ?? Number.MAX_SAFE_INTEGER) -
      (maxAvailableOrderIndex.get(rightAccountId) ?? Number.MAX_SAFE_INTEGER);

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
            if (
              categoryDialogState.sortColumn === 'maxAvailable' &&
              categoryDialogState.maxAvailableOrder
            ) {
              return (
                compareByMaxAvailableOrder(left.account.id, right.account.id) ||
                compareByDefaultOrder(left.account.id, right.account.id)
              );
            }

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
    if (!resolvedMonth) {
      return;
    }

    setDraftAllocations(current => {
      const key = getFundsLocationAllocationKey(categoryId, accountId);
      let nextDraftAllocations: DraftAllocationMap;

      if (amount === 0) {
        const { [key]: _removed, ...rest } = current;
        nextDraftAllocations = rest;
      } else {
        nextDraftAllocations = {
          ...current,
          [key]: {
            categoryId,
            accountId,
            amount,
          },
        };
      }

      scheduleAutoSave({
        month: resolvedMonth,
        nextDraftAllocations,
      });

      return nextDraftAllocations;
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
      maxAvailableOrder: undefined,
    });
    setDialogSearch('');
  };

  const closeCategoryDialog = () => {
    setCategoryDialogState(null);
    setDialogSearch('');
    setIsClearDialogRowsConfirmationOpen(false);
  };

  const syncCategoryDialogAllocations = (
    accountAllocations: Record<string, number>,
    options?: {
      immediate?: boolean;
    },
  ) => {
    const currentDialogState = categoryDialogStateRef.current;
    if (!currentDialogState || !displayData || !resolvedMonth) {
      return;
    }

    const selectedCategory = displayData.categories.find(
      category => category.id === currentDialogState.categoryId,
    );
    const nextDialogAllocatedTotal = Object.values(accountAllocations).reduce(
      (sum, value) => sum + value,
      0,
    );
    const nextDialogRemainder =
      selectedCategory?.balance != null
        ? selectedCategory.balance - nextDialogAllocatedTotal
        : 0;
    const nextDraftAllocations = replaceCategoryDraftAllocations({
      draftAllocations: draftAllocationsRef.current,
      categoryId: currentDialogState.categoryId,
      accountAllocations,
    });
    const nextMaxAvailableOrder =
      currentDialogState.sortColumn === 'maxAvailable'
        ? getDialogMaxAvailableOrder({
          editableAccounts: displayData.editableAccounts,
          categoryId: currentDialogState.categoryId,
          allocations: accountAllocations,
          draftAllocations: nextDraftAllocations,
          categoryRemainder: nextDialogRemainder,
          sortDirection: currentDialogState.sortDirection,
        })
        : currentDialogState.maxAvailableOrder;
    const nextDialogState = {
      ...currentDialogState,
      allocations: accountAllocations,
      maxAvailableOrder: nextMaxAvailableOrder,
    };

    categoryDialogStateRef.current = nextDialogState;
    draftAllocationsRef.current = nextDraftAllocations;
    setCategoryDialogState(nextDialogState);
    setDraftAllocations(nextDraftAllocations);

    if (options?.immediate) {
      persistAllocations({
        month: resolvedMonth,
        allocations: toDraftAllocationArray(nextDraftAllocations),
        silent: true,
      });
    } else {
      scheduleAutoSave({
        month: resolvedMonth,
        nextDraftAllocations,
      });
    }
  };

  const updateDialogAllocation = (accountId: string, amount: number) => {
    const currentDialogState = categoryDialogStateRef.current;
    if (!currentDialogState) {
      return;
    }

    syncCategoryDialogAllocations({
      ...currentDialogState.allocations,
      [accountId]: amount,
    });
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
          maxAvailableOrder: undefined,
        };
      }

      const nextDirection =
        current.sortColumn === column
          ? current.sortDirection === 'asc'
            ? 'desc'
            : 'asc'
          : getDefaultDialogSortDirection(column);

      const nextMaxAvailableOrder =
        column === 'maxAvailable' &&
          displayData &&
          selectedDialogCategory
          ? getDialogMaxAvailableOrder({
            editableAccounts: displayData.editableAccounts,
            categoryId: selectedDialogCategory.id,
            allocations: current.allocations,
            draftAllocations,
            categoryRemainder: dialogRemainder,
            sortDirection: nextDirection,
          })
          : undefined;

      return {
        ...current,
        sortColumn: column,
        sortDirection: nextDirection,
        maxAvailableOrder: nextMaxAvailableOrder,
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

  const showAccountsNeedingReview = () => {
    setReportView('account');
    setAccountFilter('');
    setReportSort({
      column: 'remainder',
      direction: 'desc',
    });
  };

  const clearDialogRow = () => {
    const currentDialogState = categoryDialogStateRef.current;
    if (!displayData || !currentDialogState) {
      return;
    }

    syncCategoryDialogAllocations(
      Object.fromEntries(
        displayData.editableAccounts.map(account => [account.id, 0]),
      ),
      {
        immediate: true,
      },
    );
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

  const renderDialogMetricSortButton = (
    label: string,
    column: Exclude<DialogSortColumn, 'default' | 'account' | 'allocation'>,
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
        style={{
          minWidth: 0,
          padding: 0,
          color: isActive ? theme.pageText : theme.pageTextSubdued,
        }}
      >
        <View
          style={{
            gap: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={styles.smallText}>{label}</Text>
          {isActive ? renderSortDirectionIcon(categoryDialogState.sortDirection) : null}
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

  const clearSavedMonthDisabled =
    saveMutation.isPending ||
    !currentMonthData.hasSavedSnapshot ||
    currentMonthData.allocations.length === 0;
  const openClearSavedMonthConfirmation = () => {
    if (clearSavedMonthDisabled) {
      return;
    }

    setIsClearSavedMonthConfirmationOpen(true);
  };
  const closeClearSavedMonthConfirmation = () => {
    setIsClearSavedMonthConfirmationOpen(false);
  };
  const confirmClearSavedMonth = () => {
    persistAllocations({
      month: currentMonthData.month,
      allocations: [],
    });
    closeClearSavedMonthConfirmation();
  };
  const openClearDialogRowsConfirmation = () => {
    if (!selectedDialogCategory || !categoryDialogState) {
      return;
    }

    setIsClearDialogRowsConfirmationOpen(true);
  };
  const closeClearDialogRowsConfirmation = () => {
    setIsClearDialogRowsConfirmationOpen(false);
  };
  const confirmClearDialogRows = () => {
    clearDialogRow();
    closeClearDialogRowsConfirmation();
  };
  const editableAccountRemainder = displayData.editableAccounts.reduce(
    (sum, account) => sum + account.remainder,
    0,
  );
  const hasActiveCategoryFilters =
    groupFilter !== '' || categoryFilter.trim() !== '';
  const hasActiveAccountFilter = accountFilter.trim() !== '';

  if (isNarrowWidth) {
    return (
      <Page header={header} padding={0}>
        <MobileFundsLocationPage
          reportView={reportView}
          selectedMonth={selectedMonth}
          monthBounds={monthBounds}
          clearDisabled={clearSavedMonthDisabled}
          supported={displayData.supported}
          totalCategoriesCount={displayData.categories.length}
          selectedCategory={
            selectedDialogCategory
              ? {
                id: selectedDialogCategory.id,
                name: selectedDialogCategory.name,
                balance: selectedDialogCategory.balance,
              }
              : null
          }
          categoryRows={filteredSortedCategoryRows}
          accountRows={sortedAccountRows}
          groupFilter={groupFilter}
          categoryFilter={categoryFilter}
          groupFilterOptions={groupFilterOptions}
          totals={{
            categoryBalance: displayData.totals.categoryBalance,
            categoryAllocated: displayData.totals.categoryAllocated,
            categoryRemainder: displayData.totals.categoryRemainder,
            accountBalance: displayData.totals.accountBalance,
            accountAllocated: displayData.totals.accountAllocated,
            editableAccountRemainder,
          }}
          accountWarningCount={accountWarningCount}
          dialogAllocatedTotal={dialogAllocatedTotal}
          dialogRemainder={dialogRemainder}
          dialogSearch={dialogSearch}
          showDialogSearch={
            displayData.editableAccounts.length > ACCOUNT_SEARCH_THRESHOLD
          }
          dialogAccountRows={dialogAccountRows}
          onSelectMonth={setSelectedMonth}
          onChangeReportView={setReportView}
          onClearSavedMonth={openClearSavedMonthConfirmation}
          onChangeGroupFilter={setGroupFilter}
          onChangeCategoryFilter={setCategoryFilter}
          onClearFilters={() => {
            setGroupFilter('');
            setCategoryFilter('');
          }}
          onOpenCategory={openCategoryDialog}
          onChangeDialogSearch={setDialogSearch}
          onUpdateDialogAllocation={updateDialogAllocation}
          onClearDialogRow={openClearDialogRowsConfirmation}
          onCloseCategoryDialog={closeCategoryDialog}
        />
        {isClearSavedMonthConfirmationOpen ? (
          <Modal
            name="funds-location-clear-saved-month-confirmation"
            onClose={closeClearSavedMonthConfirmation}
          >
            <ModalHeader
              title={t('Clear saved allocations?')}
              rightContent={
                <ModalCloseButton
                  onPress={closeClearSavedMonthConfirmation}
                />
              }
            />

            <View style={{ gap: 12, lineHeight: 1.5 }}>
              <Text>
                <Trans>
                  This will remove the saved allocations for{' '}
                  <strong>{currentMonthData.month}</strong>.
                </Trans>
              </Text>
              <Text style={{ color: theme.pageTextSubdued }}>
                <Trans>You can’t undo this action.</Trans>
              </Text>

              <ModalButtons>
                <View style={{ gap: 8, flexDirection: 'row' }}>
                  <Button onPress={closeClearSavedMonthConfirmation}>
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button
                    variant="primary"
                    isDisabled={saveMutation.isPending}
                    onPress={confirmClearSavedMonth}
                  >
                    <Trans>Clear saved allocations</Trans>
                  </Button>
                </View>
              </ModalButtons>
            </View>
          </Modal>
        ) : null}
      </Page>
    );
  }

  const reportTableMinWidth = getReportTableMinWidth({
    editableAccountCount: displayData.editableAccounts.length,
    isHighAccountCount,
  });
  const accountReportContent =
    displayData.categories.length === 0 ? (
      <Block
        style={{
          padding: 16,
          border: `1px solid ${theme.pillBorder}`,
        }}
      >
        <Trans>
          There are no positive category balances to allocate for this month.
        </Trans>
      </Block>
    ) : accountRows.length === 0 ? (
      <Block
        style={{
          padding: 16,
          border: `1px solid ${theme.pillBorder}`,
        }}
      >
        <Trans>There are no editable accounts to inspect for this month.</Trans>
      </Block>
    ) : filteredSortedAccountRows.length === 0 ? (
      <Block
        style={{
          padding: 16,
          border: `1px solid ${theme.pillBorder}`,
        }}
      >
        <Trans>No accounts match the current filter.</Trans>
      </Block>
    ) : (
      <View
        style={{
          minWidth: 0,
        }}
      >
        <div
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 360px)',
            border: `1px solid ${theme.pillBorder}`,
            backgroundColor: theme.tableBackground,
          }}
          data-testid="funds-location-account-table"
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
                  {renderReportSortHeader(t('Account'), 'accountName')}
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
                  {renderReportSortHeader(t('Balance'), 'balance', {
                    align: 'right',
                  })}
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
                  {renderReportSortHeader(t('Usage'), 'remainder')}
                </th>
                <th
                  style={{
                    minWidth: 320,
                    padding: 12,
                    textAlign: 'left',
                    borderBottom: `1px solid ${theme.tableBorder}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {renderReportSortHeader(
                    t('Allocated categories'),
                    'summary',
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedAccountRows.map(accountRow => {
                return (
                  <tr key={accountRow.account.id}>
                    <td
                      style={{
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      <Text style={{ fontWeight: 600 }}>
                        {accountRow.account.name}
                      </Text>
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
                        {format(accountRow.account.balance, 'financial')}
                      </FinancialText>
                    </td>
                    <td
                      style={{
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        verticalAlign: 'top',
                      }}
                    >
                      <CompactUsage
                        allocated={accountRow.account.allocated}
                        balance={accountRow.account.balance}
                        remainder={accountRow.account.remainder}
                        textColor={theme.pageText}
                        subduedColor={theme.pageTextSubdued}
                        trackColor={theme.tableBorder}
                      />
                    </td>
                    <td
                      style={{
                        minWidth: 320,
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        verticalAlign: 'top',
                      }}
                    >
                      <AllocatedCategoriesSummary
                        allocations={accountRow.categoryAllocations}
                        textColor={theme.pageText}
                        subduedColor={theme.pageTextSubdued}
                        trackColor={theme.tableBorder}
                        separatorColor={theme.tableBackground}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </View>
    );
  const categoryReportContent =
    displayData.categories.length === 0 ? (
      <Block
        style={{
          padding: 16,
          border: `1px solid ${theme.pillBorder}`,
        }}
      >
        <Trans>
          There are no positive category balances to allocate for this month.
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
      <View
        style={{
          gap: 16,
          flexDirection: 'row',
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: isNarrowWidth ? undefined : 'calc(100vh - 320px)',
            border: `1px solid ${theme.pillBorder}`,
            backgroundColor: theme.tableBackground,
          }}
          data-testid="funds-location-table"
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
                    minWidth: getStickyColumnMinWidth('group'),
                    padding: 12,
                    textAlign: 'left',
                    borderBottom: `1px solid ${theme.tableBorder}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {renderReportSortHeader(t('Group'), 'group')}
                </th>
                <th
                  style={{
                    minWidth: getStickyColumnMinWidth('category'),
                    padding: 12,
                    textAlign: 'left',
                    borderBottom: `1px solid ${theme.tableBorder}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {renderReportSortHeader(t('Category'), 'category')}
                </th>
                <th
                  style={{
                    minWidth: getStickyColumnMinWidth('balance'),
                    padding: 12,
                    textAlign: 'right',
                    borderBottom: `1px solid ${theme.tableBorder}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {renderReportSortHeader(t('Balance'), 'balance', {
                    align: 'right',
                  })}
                </th>
                <th
                  style={{
                    minWidth: getStickyColumnMinWidth('allocated'),
                    padding: 12,
                    textAlign: 'left',
                    borderBottom: `1px solid ${theme.tableBorder}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {renderReportSortHeader(t('Usage'), 'remainder')}
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
                      {renderReportSortHeader(t('Allocation summary'), 'summary')}
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
                const { category, summaryAllocations, accountAmounts } = row;

                return (
                  <tr key={category.id}>
                    <td
                      style={{
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      {category.group_name}
                    </td>
                    <td
                      style={{
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      {category.name}
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
                        {format(category.balance, 'financial')}
                      </FinancialText>
                    </td>
                    <td
                      style={{
                        padding: 12,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        verticalAlign: 'top',
                      }}
                    >
                      <CompactUsage
                        allocated={category.allocated}
                        balance={category.balance}
                        remainder={category.remainder}
                        textColor={theme.pageText}
                        subduedColor={theme.pageTextSubdued}
                        trackColor={theme.tableBorder}
                      />
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
                          <AllocationSummary allocations={summaryAllocations} />
                        </td>
                        <td
                          style={{
                            minWidth: 140,
                            padding: 12,
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            verticalAlign: 'top',
                          }}
                        >
                          <Button onPress={() => openCategoryDialog(category.id)}>
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
                              label={t('{{category}} allocation in {{account}}', {
                                category: category.name,
                                account: account.name,
                              })}
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
                    padding: 12,
                    borderTop: `1px solid ${theme.tableBorder}`,
                    fontWeight: 600,
                  }}
                >
                  <Trans>Account totals</Trans>
                </td>
                <td
                  style={{
                    padding: 12,
                    borderTop: `1px solid ${theme.tableBorder}`,
                  }}
                />
                <td
                  style={{
                    padding: 12,
                    textAlign: 'right',
                    borderTop: `1px solid ${theme.tableBorder}`,
                    ...styles.tnum,
                  }}
                >
                  <FinancialText>
                    {format(displayData.totals.accountBalance, 'financial')}
                  </FinancialText>
                </td>
                <td
                  style={{
                    padding: 12,
                    borderTop: `1px solid ${theme.tableBorder}`,
                    verticalAlign: 'top',
                  }}
                >
                  <CompactUsage
                    allocated={displayData.totals.accountAllocated}
                    balance={displayData.totals.accountBalance}
                    remainder={displayData.totals.accountRemainder}
                    textColor={theme.pageText}
                    subduedColor={theme.pageTextSubdued}
                    trackColor={theme.tableBorder}
                  />
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
                      <Trans>Use each row's editor to adjust accounts.</Trans>
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
                      <Block style={{ ...styles.tnum, marginBottom: 4 }}>
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
      </View>
    );

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
                isDisabled={clearSavedMonthDisabled}
                onPress={openClearSavedMonthConfirmation}
              >
                <Trans>Clear saved allocations</Trans>
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
                  position: 'relative',
                  zIndex: 4,
                }}
              >
                <View
                  style={{
                    gap: 12,
                    flexWrap: 'wrap',
                    flexDirection: 'row',
                  }}
                >
                  <UsageSummaryCard
                    label={t('Category usage')}
                    allocated={displayData.totals.categoryAllocated}
                    balance={displayData.totals.categoryBalance}
                    remainder={displayData.totals.categoryRemainder}
                    note={
                      displayData.totals.categoryRemainder < 0 ? (
                        <Trans>Categories are overallocated.</Trans>
                      ) : (
                        <Trans>Tracks budget category funding for the month.</Trans>
                      )
                    }
                  />
                  <UsageSummaryCard
                    label={t('Editable account usage')}
                    allocated={displayData.totals.accountAllocated}
                    balance={displayData.totals.accountBalance}
                    remainder={editableAccountRemainder}
                    onNotePress={
                      accountWarningCount > 0
                        ? showAccountsNeedingReview
                        : undefined
                    }
                    note={
                      accountWarningCount > 0 ? (
                        <Trans>
                          {{ count: accountWarningCount }} accounts need review
                        </Trans>
                      ) : (
                        <Trans>All editable accounts are aligned.</Trans>
                      )
                    }
                  />
                </View>
                {reportView === 'account' ? (
                  <View
                    style={{
                      gap: 12,
                      paddingTop: 10,
                    }}
                  >
                    <View
                      style={{
                        gap: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <View
                        style={{
                          gap: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: '0 0 auto',
                        }}
                      >
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.pageTextSubdued,
                          }}
                        >
                          <Trans>View</Trans>
                        </Text>
                        <View style={{ gap: 8, flexDirection: 'row' }}>
                          <Button
                            variant="menu"
                            onPress={() => setReportView('category')}
                          >
                            <Trans>By category</Trans>
                          </Button>
                          <Button
                            variant="menuSelected"
                            onPress={() => setReportView('account')}
                          >
                            <Trans>By account</Trans>
                          </Button>
                        </View>
                      </View>

                      <View
                        style={{
                          gap: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: 1,
                        }}
                      >
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.pageTextSubdued,
                            flex: '0 0 auto',
                          }}
                        >
                          <Trans>Filter by account</Trans>
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Search
                            value={accountFilter}
                            onChange={setAccountFilter}
                            placeholder={t('Filter accounts')}
                            width="100%"
                          />
                        </View>
                      </View>

                      {hasActiveAccountFilter ? (
                        <View
                          style={{
                            gap: 6,
                            flex: '0 0 auto',
                          }}
                        >
                          <Text
                            style={{
                              ...styles.smallText,
                              color: 'transparent',
                              userSelect: 'none',
                            }}
                          >
                            <Trans>Filter by account</Trans>
                          </Text>
                          <Button onPress={() => setAccountFilter('')}>
                            <Trans>Clear filters</Trans>
                          </Button>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {reportView === 'category' ? (
                  <View
                    style={{
                      gap: 12,
                      paddingTop: 10,
                    }}
                  >
                    <View
                      style={{
                        gap: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <View
                        style={{
                          gap: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: '0 0 auto',
                        }}
                      >
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.pageTextSubdued,
                          }}
                        >
                          <Trans>View</Trans>
                        </Text>
                        <View
                          style={{
                            gap: 8,
                            flexDirection: 'row',
                            alignItems: 'center',
                          }}
                        >
                          <Button
                            variant="menuSelected"
                            onPress={() => setReportView('category')}
                          >
                            <Trans>By category</Trans>
                          </Button>
                          <Button
                            variant="menu"
                            onPress={() => setReportView('account')}
                          >
                            <Trans>By account</Trans>
                          </Button>
                        </View>
                      </View>

                      <View
                        style={{
                          gap: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: 1,
                        }}
                      >
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.pageTextSubdued,
                            flex: '0 0 auto',
                          }}
                        >
                          <Trans>Filter by group</Trans>
                        </Text>
                        <View style={{ flex: 1 }}>
                          <select
                            aria-label={t('Filter by group')}
                            value={groupFilter}
                            onChange={event => setGroupFilter(event.target.value)}
                            style={{
                              width: '100%',
                              height: 27.5,
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
                        </View>
                      </View>

                      <View
                        style={{
                          gap: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: 1,
                        }}
                      >
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.pageTextSubdued,
                            flex: '0 0 auto',
                          }}
                        >
                          <Trans>Filter by category</Trans>
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Search
                            value={categoryFilter}
                            onChange={setCategoryFilter}
                            placeholder={t('Filter categories')}
                            width="100%"
                          />
                        </View>
                      </View>

                      {hasActiveCategoryFilters ? (
                        <View
                          style={{
                            gap: 6,
                            flex: '0 0 auto',
                          }}
                        >
                          <Text
                            style={{
                              ...styles.smallText,
                              color: 'transparent',
                              userSelect: 'none',
                            }}
                          >
                            <Trans>Filter by category</Trans>
                          </Text>
                          <Button
                            onPress={() => {
                              setGroupFilter('');
                              setCategoryFilter('');
                            }}
                          >
                            <Trans>Clear filters</Trans>
                          </Button>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>

              <View
                style={{
                  position: 'relative',
                  zIndex: 0,
                  isolation: 'isolate',
                }}
              >
                {reportView === 'category'
                  ? categoryReportContent
                  : accountReportContent}
              </View>
            </>
          )}
        </View>
      </View>

      {selectedDialogCategory && categoryDialogState ? (
        <Modal
          name="funds-location-category-allocation"
          onClose={closeCategoryDialog}
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
              <UsageSummaryCard
                label={t('Category usage')}
                allocated={dialogAllocatedTotal}
                balance={selectedDialogCategory.balance}
                remainder={dialogRemainder}
                note={
                  dialogRemainder < 0 ? (
                    <Trans>Reduce allocations before applying changes.</Trans>
                  ) : (
                    <Trans>Adjust how this category is spread across accounts.</Trans>
                  )
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
                        textAlign: 'left',
                        borderBottom: `1px solid ${theme.tableBorder}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        backgroundColor: theme.tableBackground,
                      }}
                    >
                      <View style={{ gap: 6, alignItems: 'flex-start' }}>
                        <Text
                          style={{
                            ...styles.smallText,
                            color: theme.tableHeaderText,
                          }}
                        >
                          <Trans>Capacity</Trans>
                        </Text>
                        <View
                          style={{
                            gap: 10,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                          }}
                        >
                          {renderDialogMetricSortButton(t('Balance'), 'balance')}
                          {renderDialogMetricSortButton(
                            t('Current allocation'),
                            'currentAllocation',
                          )}
                          {renderDialogMetricSortButton(
                            t('Max available'),
                            'maxAvailable',
                          )}
                        </View>
                      </View>
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
                            borderBottom: `1px solid ${theme.tableBorder}`,
                            minWidth: 220,
                            verticalAlign: 'top',
                          }}
                        >
                          <CompactCapacity
                            value={row.value}
                            balance={row.account.balance}
                            maxValue={row.maxValue}
                            textColor={theme.pageText}
                            subduedColor={theme.pageTextSubdued}
                            trackColor={theme.tableBorder}
                          />
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
                <Button onPress={openClearDialogRowsConfirmation}>
                  <Trans>Clear rows</Trans>
                </Button>
              }
            >
              <></>
            </ModalButtons>
          </View>
        </Modal>
      ) : null}
      {isClearSavedMonthConfirmationOpen ? (
        <Modal
          name="funds-location-clear-saved-month-confirmation"
          onClose={closeClearSavedMonthConfirmation}
        >
          <ModalHeader
            title={t('Clear saved allocations?')}
            rightContent={
              <ModalCloseButton onPress={closeClearSavedMonthConfirmation} />
            }
          />

          <View style={{ gap: 12, lineHeight: 1.5 }}>
            <Text>
              <Trans>
                This will remove the saved allocations for{' '}
                <strong>{currentMonthData.month}</strong>.
              </Trans>
            </Text>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>You can’t undo this action.</Trans>
            </Text>

            <ModalButtons>
              <View style={{ gap: 8, flexDirection: 'row' }}>
                <Button onPress={closeClearSavedMonthConfirmation}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="primary"
                  isDisabled={saveMutation.isPending}
                  onPress={confirmClearSavedMonth}
                >
                  <Trans>Clear saved allocations</Trans>
                </Button>
              </View>
            </ModalButtons>
          </View>
        </Modal>
      ) : null}
      {selectedDialogCategory && isClearDialogRowsConfirmationOpen ? (
        <Modal
          name="funds-location-clear-dialog-rows-confirmation"
          onClose={closeClearDialogRowsConfirmation}
        >
          <ModalHeader
            title={t('Clear rows?')}
            rightContent={
              <ModalCloseButton onPress={closeClearDialogRowsConfirmation} />
            }
          />

          <View style={{ gap: 12, lineHeight: 1.5 }}>
            <Text>
              <Trans>
                This will remove all account allocations for{' '}
                <strong>{selectedDialogCategory.name}</strong>.
              </Trans>
            </Text>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>You can’t undo this action.</Trans>
            </Text>

            <ModalButtons>
              <View style={{ gap: 8, flexDirection: 'row' }}>
                <Button onPress={closeClearDialogRowsConfirmation}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button variant="primary" onPress={confirmClearDialogRows}>
                  <Trans>Clear rows</Trans>
                </Button>
              </View>
            </ModalButtons>
          </View>
        </Modal>
      ) : null}
    </Page>
  );
}
