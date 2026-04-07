import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { ReportCard } from '@desktop-client/components/reports/ReportCard';

export function FundsLocationLaunchCard() {
  const { t } = useTranslation();

  return (
    <ReportCard to="/reports/funds-location">
      <View
        style={{
          flex: 1,
          minHeight: 180,
          padding: 20,
          background: `linear-gradient(135deg, ${theme.tableBackground} 0%, ${theme.noticeBackgroundLight} 100%)`,
        }}
      >
        <Block style={{ ...styles.mediumText, marginBottom: 8 }}>
          <strong>{t('Funds Location')}</strong>
        </Block>
        <Block
          style={{
            ...styles.smallText,
            color: theme.pageTextSubdued,
            marginBottom: 20,
          }}
        >
          <Trans>Built-in report</Trans>
        </Block>
        <Block style={{ fontSize: 24, lineHeight: 1.25, marginBottom: 12 }}>
          <Trans>See which account holds the money for each category.</Trans>
        </Block>
        <Block style={{ color: theme.pageTextSubdued }}>
          <Trans>
            Save a month-specific allocation snapshot and track unassigned or
            over-allocated funds.
          </Trans>
        </Block>
      </View>
    </ReportCard>
  );
}
