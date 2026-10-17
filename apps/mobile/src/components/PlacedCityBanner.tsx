import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { Spacing } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Banner } from '@/ui';

// One-shot confirmation shown when the first-launch IP lookup auto-placed the
// user in a city (useAppBoot → setJustPlacedCity). Dismissible; auto-hides after
// a few seconds. Not shown for returning users or manual picks.
const AUTO_DISMISS_MS = 6000;

export function PlacedCityBanner() {
  const styles = useThemedStyles(makeStyles);

  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const { justPlacedCity, setJustPlacedCity } = useApp();

  useEffect(() => {
    if (!justPlacedCity) return;
    const id = setTimeout(() => setJustPlacedCity(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [justPlacedCity, setJustPlacedCity]);

  if (!justPlacedCity) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
      <Banner icon="location-outline" text={t('placedBanner', { city: justPlacedCity.name })}
              onClose={() => setJustPlacedCity(null)} closeLabel={t('close')} style={styles.banner} />
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap:   { position: 'absolute', left: Spacing.md, right: Spacing.md, alignItems: 'center', zIndex: 50 },
  banner: { alignSelf: 'stretch', maxWidth: 520 },
});
