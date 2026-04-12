import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { MonthPicker } from '@desktop-client/components/budget/MonthPicker';
import {
  Modal,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { Search } from '@desktop-client/components/common/Search';
import { FinancialText } from '@desktop-client/components/FinancialText';
import { useFormat } from '@desktop-client/hooks/useFormat';

import { AllocationSlider } from './FundsLocationAllocationSlider';

type MobileCategoryRow = {
  category: {
    id: string;
    name: string;
    group_name: string;
    balance: number;
    allocated: number;
    remainder: number;
  };
  summaryAllocations: Array<{
    accountId: string;
    accountName: string;
    amount: number;
  }>;
};

type MobileAccountRow = {
  account: {
    id: string;
    name: string;
    balance: number;
    allocated: number;
    remainder: number;
  };
  categoryAllocations: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
  }>;
};

type MobileDialogRow = {
  account: {
    id: string;
    name: string;
    balance: number;
  };
  value: number;
  maxValue: number;
};

type MobileSelectedCategory = {
  id: string;
  name: string;
  balance: number;
};

type MobileFundsLocationPageProps = {
  reportView: 'category' | 'account';
  selectedMonth: string;
  monthBounds: { start: string; end: string };
  clearDisabled: boolean;
  saveDisabled: boolean;
  supported: boolean;
  totalCategoriesCount: number;
  selectedCategory: MobileSelectedCategory | null;
  categoryRows: MobileCategoryRow[];
  accountRows: MobileAccountRow[];
  groupFilter: string;
  categoryFilter: string;
  groupFilterOptions: string[];
  totals: {
    categoryBalance: number;
    categoryAllocated: number;
    categoryRemainder: number;
    accountBalance: number;
    accountAllocated: number;
    editableAccountRemainder: number;
  };
  accountWarningCount: number;
  dialogAllocatedTotal: number;
  dialogRemainder: number;
  dialogSearch: string;
  showDialogSearch: boolean;
  dialogAccountRows: MobileDialogRow[];
  onSelectMonth: (month: string) => void;
  onChangeReportView: (view: 'category' | 'account') => void;
  onClearSavedMonth: () => void;
  onSave: () => void;
  onChangeGroupFilter: (value: string) => void;
  onChangeCategoryFilter: (value: string) => void;
  onClearFilters: () => void;
  onOpenCategory: (categoryId: string) => void;
  onChangeDialogSearch: (value: string) => void;
  onUpdateDialogAllocation: (accountId: string, amount: number) => void;
  onClearDialogRow: () => void;
  onCloseCategoryDialog: () => void;
  onApplyDialogAllocations: () => void;
};

function getBreakdownOpacity(index: number) {
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

function getUsageColor({
  allocated,
  remainder,
  textColor,
}: {
  allocated: number;
  remainder: number;
  textColor: string;
}) {
  if (remainder < 0) {
    return theme.reportsRed;
  }

  if (allocated === 0) {
    return theme.reportsGray;
  }

  if (remainder === 0) {
    return theme.reportsGreen;
  }

  return theme.reportsBlue;
}

function MobileUsageSummary({
  allocated,
  balance,
  remainder,
  showLabel = true,
  trackColor = theme.tableBorder,
  subduedColor = theme.pageTextSubdued,
  textColor = theme.pageText,
}: {
  allocated: number;
  balance: number;
  remainder: number;
  showLabel?: boolean;
  trackColor?: string;
  subduedColor?: string;
  textColor?: string;
}) {
  const format = useFormat();
  const usageColor = getUsageColor({ allocated, remainder, textColor });
  const usageRatio =
    balance > 0 ? Math.max(0, Math.min(1, allocated / balance)) : 0;

  return (
    <View style={{ gap: 8 }}>
      {showLabel ? (
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>Usage</Trans>
        </Text>
      ) : null}

      <View
        style={{
          gap: 4,
          flexDirection: 'row',
          alignItems: 'baseline',
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
          height: 8,
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
            Over by <FinancialText>{format(Math.abs(remainder), 'financial')}</FinancialText>
          </Trans>
        )}
      </Text>
    </View>
  );
}

function MobileUsageSection({
  label,
  allocated,
  balance,
  remainder,
  note,
}: {
  label: string;
  allocated: number;
  balance: number;
  remainder: number;
  note?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8, minWidth: 0 }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>

      <MobileUsageSummary
        allocated={allocated}
        balance={balance}
        remainder={remainder}
        showLabel={false}
      />

      {note ? (
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextSubdued,
            overflowWrap: 'anywhere',
          }}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function MobileSummaryBlock({
  summary,
}: {
  summary: {
    label: string;
    allocated: number;
    balance: number;
    remainder: number;
    note?: React.ReactNode;
  };
}) {
  return (
    <Block
      style={{
        boxSizing: 'border-box',
        minWidth: 0,
        padding: 12,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      <View style={{ minWidth: 0 }}>
        <MobileUsageSection
          label={summary.label}
          allocated={summary.allocated}
          balance={summary.balance}
          remainder={summary.remainder}
          note={summary.note}
        />
      </View>
    </Block>
  );
}

function MobileBreakdownSummary({
  label,
  items,
  emptyLabel,
  textColor = theme.pageText,
  subduedColor = theme.pageTextSubdued,
  trackColor = theme.tableBorder,
  separatorColor = theme.tableBackground,
}: {
  label: string;
  items: Array<{
    id: string;
    label: string;
    amount: number;
  }>;
  emptyLabel: string;
  textColor?: string;
  subduedColor?: string;
  trackColor?: string;
  separatorColor?: string;
}) {
  const format = useFormat();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const collapsedVisibleCount = 2;
  const visibleItems = isExpanded ? items : items.slice(0, collapsedVisibleCount);
  const hiddenCount = Math.max(0, items.length - collapsedVisibleCount);

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ ...styles.smallText, color: subduedColor }}>{label}</Text>

      {items.length === 0 || total <= 0 ? (
        <Text style={{ color: subduedColor }}>{emptyLabel}</Text>
      ) : (
        <>
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
                  width: `${(item.amount / total) * 100}%`,
                  minWidth: 0,
                  backgroundColor: theme.reportsBlue,
                  opacity: getBreakdownOpacity(index),
                  borderRight:
                    index < items.length - 1
                      ? `1px solid ${separatorColor}`
                      : undefined,
                }}
              />
            ))}
          </div>

          <View style={{ gap: 5 }}>
            {visibleItems.map((item, index) => (
              <View key={item.id} style={{ gap: 3 }}>
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
                      width: `${(item.amount / total) * 100}%`,
                      borderRadius: 999,
                      backgroundColor: theme.reportsBlue,
                      opacity: getBreakdownOpacity(index),
                    }}
                  />
                </div>
              </View>
            ))}

            {hiddenCount > 0 ? (
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
                <Text style={{ ...styles.smallText, color: subduedColor }}>
                  {isExpanded
                    ? t('Show less')
                    : t('+{{count}} more', { count: hiddenCount })}
                </Text>
              </Button>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function MobileCapacitySummary({
  value,
  balance,
  maxValue,
}: {
  value: number;
  balance: number;
  maxValue: number;
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
    <View style={{ gap: 8 }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        <Trans>Capacity</Trans>
      </Text>

      <View
        style={{
          gap: 4,
          flexDirection: 'row',
          alignItems: 'baseline',
          ...styles.tnum,
        }}
      >
        <FinancialText>{format(value, 'financial')}</FinancialText>
        <Text style={{ color: theme.pageTextSubdued }}>/</Text>
        <FinancialText style={{ color: theme.pageTextSubdued }}>
          {format(balance, 'financial')}
        </FinancialText>
      </View>

      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          height: 8,
          width: '100%',
          overflow: 'hidden',
          borderRadius: 999,
          backgroundColor: theme.tableBorder,
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

function MobileCategoryCard({
  row,
  onOpenCategory,
}: {
  row: MobileCategoryRow;
  onOpenCategory: (categoryId: string) => void;
}) {
  const format = useFormat();
  const { t } = useTranslation();
  const { category, summaryAllocations } = row;

  return (
    <Block
      style={{
        padding: 12,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      <View style={{ gap: 8 }}>
        <View
          style={{
            gap: 10,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              {category.group_name}
            </Text>
            <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
              {category.name}
            </Text>
          </View>

          <FinancialText style={styles.tnum}>
            {format(category.balance, 'financial')}
          </FinancialText>
        </View>

        <MobileUsageSummary
          allocated={category.allocated}
          balance={category.balance}
          remainder={category.remainder}
          showLabel={false}
        />

        <MobileBreakdownSummary
          label={t('Funds location')}
          items={summaryAllocations.map(allocation => ({
            id: allocation.accountId,
            label: allocation.accountName,
            amount: allocation.amount,
          }))}
          emptyLabel={t('Unassigned')}
        />

        <Button onPress={() => onOpenCategory(category.id)}>
          <Trans>Edit accounts</Trans>
        </Button>
      </View>
    </Block>
  );
}

function MobileAccountCard({
  row,
}: {
  row: MobileAccountRow;
}) {
  const format = useFormat();
  const { t } = useTranslation();

  return (
    <Block
      style={{
        padding: 12,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      <View style={{ gap: 8 }}>
        <View
          style={{
            gap: 10,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
            {row.account.name}
          </Text>
          <FinancialText style={styles.tnum}>
            {format(row.account.balance, 'financial')}
          </FinancialText>
        </View>

        <MobileUsageSummary
          allocated={row.account.allocated}
          balance={row.account.balance}
          remainder={row.account.remainder}
          showLabel={false}
        />

        <MobileBreakdownSummary
          label={t('Allocated categories')}
          items={row.categoryAllocations.map(allocation => ({
            id: allocation.categoryId,
            label: allocation.categoryName,
            amount: allocation.amount,
          }))}
          emptyLabel={t('Unassigned')}
        />
      </View>
    </Block>
  );
}

function MobileEditorAccountCard({
  categoryName,
  row,
  onUpdate,
}: {
  categoryName: string;
  row: MobileDialogRow;
  onUpdate: (accountId: string, amount: number) => void;
}) {
  const format = useFormat();
  const { t } = useTranslation();

  return (
    <Block
      style={{
        padding: 12,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      <View style={{ gap: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'baseline',
          }}
        >
          <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
            {row.account.name}
          </Text>
          <FinancialText style={{ ...styles.tnum, color: theme.pageTextSubdued }}>
            {format(row.account.balance, 'financial')}
          </FinancialText>
        </View>

        <MobileCapacitySummary
          value={row.value}
          balance={row.account.balance}
          maxValue={row.maxValue}
        />

        <AllocationSlider
          label={t('{{category}} allocation in {{account}}', {
            category: categoryName,
            account: row.account.name,
          })}
          value={row.value}
          maxValue={row.maxValue}
          onUpdate={nextValue => onUpdate(row.account.id, nextValue)}
        />
      </View>
    </Block>
  );
}

export function MobileFundsLocationPage({
  reportView,
  selectedMonth,
  monthBounds,
  clearDisabled,
  saveDisabled,
  supported,
  totalCategoriesCount,
  selectedCategory,
  categoryRows,
  accountRows,
  groupFilter,
  categoryFilter,
  groupFilterOptions,
  totals,
  accountWarningCount,
  dialogAllocatedTotal,
  dialogRemainder,
  dialogSearch,
  showDialogSearch,
  dialogAccountRows,
  onSelectMonth,
  onChangeReportView,
  onClearSavedMonth,
  onSave,
  onChangeGroupFilter,
  onChangeCategoryFilter,
  onClearFilters,
  onOpenCategory,
  onChangeDialogSearch,
  onUpdateDialogAllocation,
  onClearDialogRow,
  onCloseCategoryDialog,
  onApplyDialogAllocations,
}: MobileFundsLocationPageProps) {
  const { t } = useTranslation();
  const hasActiveFilters = groupFilter !== '' || categoryFilter.trim() !== '';

  return (
    <>
      <View style={{ gap: 16, padding: 12, paddingBottom: 24 }}>
        <Block
          style={{
            padding: 12,
            border: `1px solid ${theme.tableBorder}`,
            backgroundColor: theme.tableBackground,
          }}
        >
          <View style={{ gap: 12 }}>
            <View style={{ gap: 10 }}>
              <Text
                style={{
                  ...styles.smallText,
                  color: theme.pageTextSubdued,
                  display: 'block',
                }}
              >
                <Trans>Selected month</Trans>
              </Text>

              <View style={{ paddingTop: 18 }}>
                <MonthPicker
                  startMonth={selectedMonth}
                  numDisplayed={1}
                  monthBounds={monthBounds}
                  style={{ paddingTop: 0 }}
                  onSelect={month => onSelectMonth(month)}
                />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Button isDisabled={clearDisabled} onPress={onClearSavedMonth}>
                <Trans>Clear saved month</Trans>
              </Button>

              {supported ? (
                <Button
                  variant="primary"
                  isDisabled={saveDisabled}
                  onPress={onSave}
                >
                  <Trans>Save allocations</Trans>
                </Button>
              ) : null}
            </View>
          </View>
        </Block>

        {!supported ? (
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
            <Block
              style={{
                padding: 12,
                border: `1px solid ${theme.tableBorder}`,
                backgroundColor: theme.tableBackground,
              }}
            >
              <View style={{ gap: 12 }}>
                <View style={{ gap: 8 }}>
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
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 8,
                      width: '100%',
                    }}
                  >
                    <Button
                      variant={
                        reportView === 'category' ? 'menuSelected' : 'menu'
                      }
                      onPress={() => onChangeReportView('category')}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        minHeight: 36,
                      }}
                    >
                      <Trans>By category</Trans>
                    </Button>
                    <Button
                      variant={
                        reportView === 'account' ? 'menuSelected' : 'menu'
                      }
                      onPress={() => onChangeReportView('account')}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        minHeight: 36,
                      }}
                    >
                      <Trans>By account</Trans>
                    </Button>
                  </View>
                </View>

                {reportView === 'category' ? (
                  <>
                    <div
                      aria-hidden="true"
                      style={{
                        height: 1,
                        width: '100%',
                        backgroundColor: theme.tableBorder,
                      }}
                    />

                    <View style={{ gap: 8 }}>
                    <label
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
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
                        onChange={event => onChangeGroupFilter(event.target.value)}
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

                    <View style={{ gap: 4 }}>
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
                        onChange={onChangeCategoryFilter}
                        placeholder={t('Filter categories')}
                        width="100%"
                      />
                    </View>

                    {hasActiveFilters ? (
                      <Button onPress={onClearFilters}>
                        <Trans>Clear filters</Trans>
                      </Button>
                    ) : null}
                    </View>
                  </>
                ) : null}
              </View>
            </Block>

            <MobileSummaryBlock
              summary={
                reportView === 'account'
                  ? {
                      label: t('Editable account usage'),
                      allocated: totals.accountAllocated,
                      balance: totals.accountBalance,
                      remainder: totals.editableAccountRemainder,
                      note:
                        accountWarningCount > 0 ? (
                          <Trans>
                            {{ count: accountWarningCount }} accounts need review
                          </Trans>
                        ) : (
                          <Trans>All editable accounts are aligned.</Trans>
                        ),
                    }
                  : {
                      label: t('Category usage'),
                      allocated: totals.categoryAllocated,
                      balance: totals.categoryBalance,
                      remainder: totals.categoryRemainder,
                      note:
                        totals.categoryRemainder < 0 ? (
                          <Trans>Categories are overallocated.</Trans>
                        ) : (
                          <Trans>Tracks budget category funding for the month.</Trans>
                        ),
                    }
              }
            />

            {reportView === 'category' && totalCategoriesCount === 0 ? (
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
            ) : categoryRows.length === 0 ? (
              <Block
                style={{
                  padding: 16,
                  border: `1px solid ${theme.pillBorder}`,
                }}
              >
                <Trans>No categories match the current filters.</Trans>
              </Block>
            ) : reportView === 'category' ? (
              <View style={{ gap: 12 }}>
                {categoryRows.map(row => (
                  <MobileCategoryCard
                    key={row.category.id}
                    row={row}
                    onOpenCategory={onOpenCategory}
                  />
                ))}
              </View>
            ) : accountRows.length === 0 ? (
              <Block
                style={{
                  padding: 16,
                  border: `1px solid ${theme.pillBorder}`,
                }}
              >
                <Trans>There are no editable accounts to inspect for this month.</Trans>
              </Block>
            ) : (
              <View style={{ gap: 12 }}>
                {accountRows.map(row => (
                  <MobileAccountCard key={row.account.id} row={row} />
                ))}
              </View>
            )}
          </>
        )}
      </View>

      {selectedCategory ? (
        <Modal
          name="funds-location-category-allocation"
          onClose={onCloseCategoryDialog}
          containerProps={{
            style: {
              minWidth: '100vw',
              maxWidth: '100vw',
              maxHeight: '100vh',
              height: '100vh',
              borderRadius: 0,
              padding: 0,
            },
          }}
        >
          <ModalHeader
            title={selectedCategory.name}
            rightContent={<ModalCloseButton onPress={onCloseCategoryDialog} />}
          />

          <View style={{ gap: 16, padding: 16 }}>
            <MobileSummaryBlock
              summary={{
                label: t('Category usage'),
                allocated: dialogAllocatedTotal,
                balance: selectedCategory.balance,
                remainder: dialogRemainder,
                note:
                  dialogRemainder < 0 ? (
                    <Trans>Reduce allocations before applying changes.</Trans>
                  ) : (
                    <Trans>Adjust how this category is spread across accounts.</Trans>
                  ),
              }}
            />

            <Block
              style={{
                padding: 14,
                backgroundColor: theme.tableBackground,
                border: `1px solid ${theme.tableBorder}`,
              }}
            >
              <View style={{ gap: 10 }}>
                <View style={{ gap: 8, flexDirection: 'row' }}>
                  <Button
                    onPress={onClearDialogRow}
                    style={{
                      flex: 1.2,
                      minHeight: 36,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      <Trans>Clear row</Trans>
                    </Text>
                  </Button>
                  <Button
                    onPress={onCloseCategoryDialog}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      <Trans>Cancel</Trans>
                    </Text>
                  </Button>
                  <Button
                    variant="primary"
                    onPress={onApplyDialogAllocations}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      <Trans>Apply</Trans>
                    </Text>
                  </Button>
                </View>

                {showDialogSearch ? (
                  <View style={{ width: '100%', gap: 6 }}>
                    <Text
                      style={{
                        ...styles.smallText,
                        color: theme.pageTextSubdued,
                      }}
                    >
                      <Trans>Search accounts</Trans>
                    </Text>
                    <Search
                      value={dialogSearch}
                      onChange={onChangeDialogSearch}
                      placeholder={t('Search accounts')}
                      isInModal
                      width="100%"
                      height={40}
                    />
                  </View>
                ) : null}
              </View>
            </Block>

            {dialogAccountRows.length === 0 ? (
              <Block
                style={{
                  padding: 16,
                  border: `1px solid ${theme.tableBorder}`,
                  backgroundColor: theme.tableBackground,
                  color: theme.pageTextSubdued,
                }}
              >
                <Trans>No accounts match this search.</Trans>
              </Block>
            ) : (
              <View style={{ gap: 12 }}>
                {dialogAccountRows.map(row => (
                  <MobileEditorAccountCard
                    key={row.account.id}
                    categoryName={selectedCategory.name}
                    row={row}
                    onUpdate={onUpdateDialogAllocation}
                  />
                ))}
              </View>
            )}

          </View>
        </Modal>
      ) : null}
    </>
  );
}
