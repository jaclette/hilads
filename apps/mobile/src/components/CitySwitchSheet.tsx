import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localizeCityName } from '@/i18n/cityName';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, CityFlag, Sheet } from '@/ui';
import type { CityProposal } from '@/hooks/useGpsCityCorrection';

// GPS found the user in another city than the one their account keeps
// (confirmed by GPS or chosen): "You're in Potsdam. Switch from Berlin?"
// (V5-01). Switch moves them; Stay keeps it, not asked again this session.
export function CitySwitchSheet({ proposal, onSwitch, onStay }: {
  proposal: CityProposal | null; onSwitch: () => void; onStay: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  const to   = proposal ? localizeCityName(proposal.to.name) : '';
  const from = proposal ? localizeCityName(proposal.from.name) : '';

  return (
    <Sheet visible={!!proposal} onClose={onStay} closeLabel={t('close')} style={styles.sheet}>
      <View style={styles.titleLine}>
        <CityFlag country={proposal?.to.country} />
        <Text style={styles.title} numberOfLines={2}>{t('citySwitch.title', { city: to })}</Text>
      </View>
      <Text style={styles.body}>{t('citySwitch.body', { from, city: to })}</Text>
      <Button label={t('citySwitch.switch', { city: to })} onPress={onSwitch} />
      <Button variant="secondary" label={t('citySwitch.stay', { from })} onPress={onStay} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:     { gap: 12 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:     { flexShrink: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  body:      { fontSize: FontSizes.sm, color: c.muted, marginBottom: 4 },
});
