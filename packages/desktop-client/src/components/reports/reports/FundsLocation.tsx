import React, { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
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

const COLUMN_WIDTHS = {
  group: 170,
  category: 220,
  balance: 130,
  allocated: 130,
  remainder: 130,
  account: 160,
};

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
}: {
  month: string;
  allMonths: string[];
  queryClient: ReturnType<typeof useQueryClient>;
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

    if (priorMonthData.allocations.length > 0) {
      return buildDraftAllocationMap(priorMonthData.allocations);
    }
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
  column: keyof typeof COLUMN_WIDTHS,
  left: number,
  extraStyle?: CSSProperties,
) {
  return {
    position: 'sticky',
    left,
    minWidth: COLUMN_WIDTHS[column],
    width: COLUMN_WIDTHS[column],
    backgroundColor: theme.tableBackground,
    zIndex: 2,
    ...extraStyle,
  } satisfies CSSProperties;
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
        flex: '1 1 180px',
        minWidth: 180,
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
}: {
  label: string;
  value: number;
  maxValue: number;
  onUpdate: (value: number) => void;
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
    </View>
  );
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

    let isCancelled = false;

    async function syncDraftAllocations() {
      const nextDraftAllocations =
        monthData.allocations.length > 0 || !allMonths
          ? buildDraftAllocationMap(monthData.allocations)
          : await findCarriedOverDraftAllocationMap({
              month: resolvedMonth,
              allMonths,
              queryClient,
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

  const saveMutation = useMutation({
    mutationFn: async (allocations: FundsLocationAllocationInput[]) => {
      return await send('funds-location/save-month', {
        month: resolvedMonth,
        allocations,
      });
    },
    onSuccess: async data => {
      queryClient.setQueryData(
        fundsLocationQueries.month(resolvedMonth).queryKey,
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

  const categoryWarningCount =
    displayData?.categories.filter(category => category.remainder !== 0)
      .length ?? 0;
  const accountWarningCount =
    displayData?.editableAccounts.filter(account => account.remainder !== 0)
      .length ?? 0;

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

  if (isMonthsPending || fundsLocationQuery.isPending || !displayData) {
    return <LoadingIndicator message={t('Loading funds location...')} />;
  }

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
    category: COLUMN_WIDTHS.group,
    balance: COLUMN_WIDTHS.group + COLUMN_WIDTHS.category,
    allocated:
      COLUMN_WIDTHS.group + COLUMN_WIDTHS.category + COLUMN_WIDTHS.balance,
    remainder:
      COLUMN_WIDTHS.group +
      COLUMN_WIDTHS.category +
      COLUMN_WIDTHS.balance +
      COLUMN_WIDTHS.allocated,
  };

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
                  saveMutation.isPending || monthData.allocations.length === 0
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
                <Block
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
                </Block>

                {displayData.readOnlyAccounts.length > 0 && (
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
                )}
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
                      width: 'max-content',
                      minWidth: '100%',
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
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
                          <Trans>Group</Trans>
                        </th>
                        <th
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
                          <Trans>Category</Trans>
                        </th>
                        <th
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
                          <Trans>Balance</Trans>
                        </th>
                        <th
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
                          <Trans>Allocated</Trans>
                        </th>
                        <th
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
                          <Trans>Remainder</Trans>
                        </th>
                        {displayData.editableAccounts.map(account => (
                          <th
                            key={account.id}
                            style={{
                              minWidth: COLUMN_WIDTHS.account,
                              width: COLUMN_WIDTHS.account,
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
                            <Block>{account.name}</Block>
                            <Text
                              style={{
                                ...styles.smallText,
                                color: theme.pageTextSubdued,
                              }}
                            >
                              {format(account.balance, 'financial')}
                            </Text>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.categories.map(category => (
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
                          {displayData.editableAccounts.map(account => {
                            const value =
                              draftAllocations[
                                getFundsLocationAllocationKey(
                                  category.id,
                                  account.id,
                                )
                              ]?.amount ?? 0;
                            const maxAllocation = getAllocationSliderMax({
                              currentValue: value,
                              categoryRemainder: category.remainder,
                              accountRemainder: account.remainder,
                            });

                            return (
                              <td
                                key={`${category.id}-${account.id}`}
                                style={{
                                  minWidth: COLUMN_WIDTHS.account,
                                  width: COLUMN_WIDTHS.account,
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
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td
                          colSpan={2}
                          style={{
                            ...getStickyCellStyle(
                              'group',
                              stickyOffsets.group,
                              { top: 'auto', zIndex: 3 },
                            ),
                            minWidth:
                              COLUMN_WIDTHS.group + COLUMN_WIDTHS.category,
                            width: COLUMN_WIDTHS.group + COLUMN_WIDTHS.category,
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
                        {displayData.editableAccounts.map(account => (
                          <td
                            key={account.id}
                            style={{
                              minWidth: COLUMN_WIDTHS.account,
                              width: COLUMN_WIDTHS.account,
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
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </View>
      </View>
    </Page>
  );
}
