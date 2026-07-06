import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// One-shot confirmation shown when the first-launch IP lookup auto-placed the
// user in a city (useAppBoot → setJustPlacedCity). Dismissible; auto-hides after
// a few seconds. Not shown for returning users or manual picks.
const AUTO_DISMISS_MS = 6000;

export function PlacedCityBanner() {
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
      <View style={styles.banner}>
        <Ionicons name="location" size={16} color={Colors.accent} />
        <Text style={styles.text} numberOfLines={2}>
          {t('placedBanner', { city: justPlacedCity.name })}
        </Text>
        <Pressable
          onPress={() => setJustPlacedCity(null)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('close')}
        >
          <Ionicons name="close" size={18} color={Colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    alignItems: 'center',
    zIndex: 50,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 520,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bg2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSizes.sm,
    lineHeight: FontSizes.sm * 1.35,
  },
});
