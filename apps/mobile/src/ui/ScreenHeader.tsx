import type { ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { IconButton } from './IconButton';

/**
 * Screen header. "back" (pushed screens): round back button and the title.
 * "tab" (a tab's own header): the large title, no back. `right` holds the
 * header's buttons. `compact` uses the smaller title (long names, a spot).
 */
export function ScreenHeader({ title, variant = 'back', right, onBack, compact = false }: {
  title: string;
  variant?: 'back' | 'tab';
  right?: ReactNode;
  onBack?: () => void;
  compact?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('common');
  if (variant === 'tab') {
    return (
      <View style={styles.tab}>
        <Text style={styles.tabTitle} accessibilityRole="header">{title}</Text>
        {right}
      </View>
    );
  }
  return (
    <View style={styles.back}>
      <IconButton icon="chevron-back" onPress={onBack ?? (() => router.back())} label={t('back')} />
      <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1} accessibilityRole="header">{title}</Text>
      {right}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  back:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  title:        { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  titleCompact: { fontSize: FontSizes.md, fontWeight: '800' },
  tab:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: 10, paddingBottom: 6 },
  tabTitle:     { fontSize: 26, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
});
