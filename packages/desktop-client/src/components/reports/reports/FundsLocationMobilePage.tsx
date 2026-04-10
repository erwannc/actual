import React from 'react';
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
  selectedMonth: string;
  monthBounds: { start: string; end: string };
  clearDisabled: boolean;
  saveDisabled: boolean;
  supported: boolean;
  totalCategoriesCount: number;
  selectedCategory: MobileSelectedCategory | null;
  categoryRows: MobileCategoryRow[];
  groupFilter: string;
  categoryFilter: string;
  groupFilterOptions: string[];
  totals: {
    categoryBalance: number;
    categoryAllocated: number;
    categoryRemainder: number;
    editableAccountRemainder: number;
  };
  accountWarningCount: number;
  dialogAllocatedTotal: number;
  dialogRemainder: number;
  dialogSearch: string;
  showDialogSearch: boolean;
  dialogAccountRows: MobileDialogRow[];
  onSelectMonth: (month: string) => void;
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

function getToneColor(tone: 'default' | 'warning' | 'danger' = 'default') {
  if (tone === 'warning') {
    return theme.noticeText;
  }

  if (tone === 'danger') {
    return theme.errorText;
  }

  return theme.pageText;
}

function MobileSummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const format = useFormat();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <FinancialText style={{ ...styles.tnum, color: getToneColor(tone) }}>
        {format(value, 'financial')}
      </FinancialText>
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
  const { t } = useTranslation();
  const format = useFormat();
  const { category, summaryAllocations } = row;
  const summaryPreview = summaryAllocations.slice(0, 2);
  const hiddenCount = summaryAllocations.length - summaryPreview.length;

  return (
    <Block
      style={{
        padding: 14,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
      }}
    >
      <View style={{ gap: 10 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            {category.group_name}
          </Text>
          <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
            {category.name}
          </Text>
        </View>

        <View
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <Trans>Balance</Trans>
            </Text>
            <FinancialText style={styles.tnum}>
              {format(category.balance, 'financial')}
            </FinancialText>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <Trans>Allocated</Trans>
            </Text>
            <FinancialText style={styles.tnum}>
              {format(category.allocated, 'financial')}
            </FinancialText>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <Trans>Remainder</Trans>
            </Text>
            <FinancialText
              style={{
                ...styles.tnum,
                color:
                  category.remainder === 0
                    ? theme.pageText
                    : category.remainder > 0
                      ? theme.noticeText
                      : theme.errorText,
              }}
            >
              {format(category.remainder, 'financial')}
            </FinancialText>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <Trans>Funds location</Trans>
            </Text>
            <Text>
              {summaryPreview.length > 0
                ? summaryPreview
                    .map(
                      allocation =>
                        `${allocation.accountName} ${format(
                          allocation.amount,
                          'financial',
                        )}`,
                    )
                    .join(', ')
                : t('Unassigned')}
              {hiddenCount > 0 ? ` ${t('+{{count}} more', { count: hiddenCount })}` : ''}
            </Text>
          </View>
        </View>

        <Button onPress={() => onOpenCategory(category.id)}>
          <Trans>Edit accounts</Trans>
        </Button>
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
        padding: 14,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      <View style={{ gap: 10 }}>
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

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            <Trans>Max available</Trans>
          </Text>
          <FinancialText style={{ ...styles.smallText, ...styles.tnum }}>
            {format(row.maxValue, 'financial')}
          </FinancialText>
        </View>

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
  selectedMonth,
  monthBounds,
  clearDisabled,
  saveDisabled,
  supported,
  totalCategoriesCount,
  selectedCategory,
  categoryRows,
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
            padding: 14,
            backgroundColor: theme.tableBackground,
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
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
                padding: 14,
                backgroundColor: theme.tableBackground,
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
              }}
            >
              <View style={{ gap: 10 }}>
                <MobileSummaryMetric
                  label={t('Category balance total')}
                  value={totals.categoryBalance}
                />
                <MobileSummaryMetric
                  label={t('Allocated total')}
                  value={totals.categoryAllocated}
                />
                <MobileSummaryMetric
                  label={t('Category remainder')}
                  value={totals.categoryRemainder}
                  tone={
                    totals.categoryRemainder === 0
                      ? 'default'
                      : totals.categoryRemainder > 0
                        ? 'warning'
                        : 'danger'
                  }
                />
                <MobileSummaryMetric
                  label={t('Editable account remainder')}
                  value={totals.editableAccountRemainder}
                  tone={accountWarningCount === 0 ? 'default' : 'warning'}
                />
              </View>
            </Block>

            <Block
              style={{
                padding: 14,
                backgroundColor: theme.tableBackground,
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
              }}
            >
              <View style={{ gap: 10 }}>
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
            </Block>

            {totalCategoriesCount === 0 ? (
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
            ) : (
              <View style={{ gap: 12 }}>
                {categoryRows.map(row => (
                  <MobileCategoryCard
                    key={row.category.id}
                    row={row}
                    onOpenCategory={onOpenCategory}
                  />
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
            <Block
              style={{
                padding: 14,
                backgroundColor: theme.tableBackground,
                border: `1px solid ${theme.tableBorder}`,
              }}
            >
              <View style={{ gap: 10 }}>
                <MobileSummaryMetric
                  label={t('Category balance')}
                  value={selectedCategory.balance}
                />
                <MobileSummaryMetric
                  label={t('Currently allocated')}
                  value={dialogAllocatedTotal}
                />
                <MobileSummaryMetric
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
            </Block>

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
