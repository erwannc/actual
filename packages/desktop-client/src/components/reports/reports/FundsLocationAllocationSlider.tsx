import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '@desktop-client/components/FinancialText';
import { FinancialInput } from '@desktop-client/components/util/FinancialInput';
import { useFormat } from '@desktop-client/hooks/useFormat';

type AllocationSliderProps = {
  label: string;
  value: number;
  maxValue: number;
  onUpdate: (value: number) => void;
  showSummary?: boolean;
};

export function AllocationSlider({
  label,
  value,
  maxValue,
  onUpdate,
  showSummary = true,
}: AllocationSliderProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [isEditingValue, setIsEditingValue] = useState(false);

  function clampValue(nextValue: number) {
    return Math.min(Math.max(0, nextValue), maxValue);
  }

  function updateFromInput(nextValue: number) {
    onUpdate(clampValue(nextValue));
  }

  return (
    <View style={{ gap: 6 }}>
      <input
        aria-label={label}
        type="range"
        min={0}
        max={maxValue}
        step={1}
        value={value}
        onChange={event => updateFromInput(Number(event.target.value) || 0)}
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
        {isEditingValue ? (
          <FinancialInput
            aria-label={t('Edit {{label}} amount', { label })}
            autoFocus
            value={value}
            onUpdate={nextValue => {
              updateFromInput(nextValue);
              setIsEditingValue(false);
            }}
            onEnter={nextValue => {
              updateFromInput(nextValue);
              setIsEditingValue(false);
            }}
            onEscape={() => setIsEditingValue(false)}
            onBlur={() => setIsEditingValue(false)}
            style={{
              width: 110,
              textAlign: 'right',
            }}
          />
        ) : (
          <Button
            variant="bare"
            aria-label={t('Edit {{label}} amount', { label })}
            onPress={() => setIsEditingValue(true)}
            style={{
              padding: 0,
              minWidth: 0,
              color: theme.pageText,
            }}
          >
            <FinancialText style={styles.tnum}>
              {format(value, 'financial')}
            </FinancialText>
          </Button>
        )}
        {showSummary ? (
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            {t('Max: {{amount}}', {
              amount: format(maxValue, 'financial'),
            })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
