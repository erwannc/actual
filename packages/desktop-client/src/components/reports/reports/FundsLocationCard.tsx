import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { useQuery } from '@tanstack/react-query';

import * as monthUtils from 'loot-core/shared/months';
import type { FundsLocationWidget } from 'loot-core/types/models';

import { FinancialText } from '@desktop-client/components/FinancialText';
import { LoadingIndicator } from '@desktop-client/components/reports/LoadingIndicator';
import { ReportCard } from '@desktop-client/components/reports/ReportCard';
import { ReportCardName } from '@desktop-client/components/reports/ReportCardName';
import { useDashboardWidgetCopyMenu } from '@desktop-client/components/reports/useDashboardWidgetCopyMenu';
import { useFormat } from '@desktop-client/hooks/useFormat';
import { useLocale } from '@desktop-client/hooks/useLocale';
import { fundsLocationQueries } from '@desktop-client/reports';

type FundsLocationCardProps = {
  widgetId: string;
  isEditing?: boolean;
  meta?: FundsLocationWidget['meta'];
  onMetaChange: (newMeta: FundsLocationWidget['meta']) => void;
  onRemove: () => void;
  onCopy: (targetDashboardId: string) => void;
};

export function FundsLocationCard({
  widgetId: _widgetId,
  isEditing,
  meta = {},
  onMetaChange,
  onRemove,
  onCopy,
}: FundsLocationCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const [nameMenuOpen, setNameMenuOpen] = useState(false);

  const { menuItems: copyMenuItems, handleMenuSelect: handleCopyMenuSelect } =
    useDashboardWidgetCopyMenu(onCopy);

  const { data: allMonths, isPending: isMonthsPending } = useQuery(
    fundsLocationQueries.months(),
  );

  const resolvedMonth = useMemo(() => {
    if (!allMonths || allMonths.length === 0) {
      return monthUtils.currentMonth();
    }

    const currentMonth = monthUtils.currentMonth();
    return allMonths.includes(currentMonth)
      ? currentMonth
      : allMonths[allMonths.length - 1];
  }, [allMonths]);

  const { data, isPending: isMonthPending } = useQuery(
    fundsLocationQueries.month(resolvedMonth),
  );

  const allocatableTotal = Math.max(0, data?.totals.categoryBalance ?? 0);
  const allocatedTotal = Math.max(0, data?.totals.categoryAllocated ?? 0);
  const nonAllocatedTotal = Math.max(0, data?.totals.categoryRemainder ?? 0);
  const ratioDenominator = Math.max(
    allocatableTotal,
    allocatedTotal + nonAllocatedTotal,
    1,
  );
  const allocatedRatio = allocatedTotal / ratioDenominator;
  const nonAllocatedRatio = nonAllocatedTotal / ratioDenominator;
  const monthLabel = monthUtils.format(resolvedMonth, 'MMMM yyyy', locale);

  return (
    <ReportCard
      isEditing={isEditing}
      disableClick={nameMenuOpen}
      to="/reports/funds-location"
      menuItems={[
        {
          name: 'rename',
          text: t('Rename'),
        },
        {
          name: 'remove',
          text: t('Remove'),
        },
        ...copyMenuItems,
      ]}
      onMenuSelect={item => {
        if (handleCopyMenuSelect(item)) {
          return;
        }

        switch (item) {
          case 'rename':
            setNameMenuOpen(true);
            break;
          case 'remove':
            onRemove();
            break;
          default:
            throw new Error(`Unrecognized selection: ${item}`);
        }
      }}
    >
      <View style={{ flex: 1, padding: 20, gap: 16 }}>
        <View style={{ gap: 4 }}>
          <ReportCardName
            name={meta?.name || t('Funds Location')}
            isEditing={nameMenuOpen}
            onChange={newName => {
              onMetaChange({
                ...meta,
                name: newName,
              });
              setNameMenuOpen(false);
            }}
            onClose={() => setNameMenuOpen(false)}
          />
          <Text style={{ color: theme.pageTextSubdued }}>{monthLabel}</Text>
        </View>

        {isMonthsPending || isMonthPending || !data ? (
          <LoadingIndicator />
        ) : !data.supported ? (
          <Block
            style={{
              padding: 12,
              border: `1px solid ${theme.pillBorder}`,
              backgroundColor: theme.noticeBackgroundLight,
            }}
          >
            <Trans>
              Funds Location is only available for envelope budgets.
            </Trans>
          </Block>
        ) : (
          <View style={{ flex: 1, gap: 14 }}>
            <View
              style={{
                height: 18,
                borderRadius: 999,
                overflow: 'hidden',
                backgroundColor: theme.tableBorder,
                flexDirection: 'row',
              }}
            >
              <View
                style={{
                  width: `${allocatedRatio * 100}%`,
                  backgroundColor: theme.noticeBackground,
                }}
              />
              <View
                style={{
                  width: `${nonAllocatedRatio * 100}%`,
                  backgroundColor: theme.warningBackground,
                }}
              />
            </View>

            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <View>
                  <Text
                    style={{
                      ...styles.smallText,
                      color: theme.pageTextSubdued,
                    }}
                  >
                    <Trans>Allocated funds</Trans>
                  </Text>
                  <FinancialText
                    style={{ ...styles.mediumText, fontWeight: 600 }}
                  >
                    {format(allocatedTotal, 'financial')}
                  </FinancialText>
                </View>
                <Text style={{ color: theme.pageTextSubdued }}>
                  {Math.round(allocatedRatio * 100)}%
                </Text>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <View>
                  <Text
                    style={{
                      ...styles.smallText,
                      color: theme.pageTextSubdued,
                    }}
                  >
                    <Trans>Non-allocated funds</Trans>
                  </Text>
                  <FinancialText
                    style={{ ...styles.mediumText, fontWeight: 600 }}
                  >
                    {format(nonAllocatedTotal, 'financial')}
                  </FinancialText>
                </View>
                <Text style={{ color: theme.pageTextSubdued }}>
                  {Math.round(nonAllocatedRatio * 100)}%
                </Text>
              </View>
            </View>

            {data.totals.categoryRemainder < 0 ? (
              <Text style={{ ...styles.smallText, color: theme.errorText }}>
                <Trans>
                  This month is currently over-allocated in Funds Location.
                </Trans>
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </ReportCard>
  );
}
