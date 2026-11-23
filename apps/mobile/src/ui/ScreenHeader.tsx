import type { ReactNode } from 'react';
import { Keyboard, Pressable, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Space, FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { IconButton } from './IconButton';
import { HeaderArt, type HeaderArtKind } from './HeaderArt';
import { goBack } from '@/lib/nav';
import { SeasonalHeaderDecor } from '@/features/event/SeasonalArt';

/**
 * Screen header. "back" (pushed screens): round back button and the title.
 * "tab" (a tab's own header): the large title, no back. `right` holds the
 * header's buttons. `compact` uses the smaller title (long names, a spot).
 * `subtitle` (a tab's, or under a back header's title): a one-line muted line under the title, two lines at
 * most on small screens (SPEC 9.1). `art` (tab only): the screen's line
 * drawing on the header's right, left of its buttons (decorative).
 */
export function ScreenHeader({ title, subtitle, art, variant = 'back', right, onBack, compact = false, testID }: {
  title: string;
  subtitle?: string;
  art?: HeaderArtKind;
  variant?: 'back' | 'tab';
  right?: ReactNode;
  onBack?: () => void;
  compact?: boolean;
  /** Marks the screen for the UI tests (.maestro). */
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  if (variant === 'tab') {
    return (
      <View style={styles.tab} testID={testID}>
        <View style={styles.tabText}>
          <Text style={styles.tabTitle} accessibilityRole="header">{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>}
        </View>
        {/* The drawing ends where the buttons start: never behind them. */}
        <View style={styles.artSlot} pointerEvents="none">{art && <HeaderArt kind={art} />}<SeasonalHeaderDecor /></View>
        {right}
      </View>
    );
  }
  return (
    // A tap on the header (outside the form) closes the keyboard (the keyboard rule).
    <Pressable style={styles.back} testID={testID} onPress={Keyboard.dismiss} accessible={false}>
      <IconButton icon="chevron-back" onPress={onBack ?? goBack} label={t('back')} testID="header-back" />
      {title && subtitle ? (
        // A live line under the title (the Hi chat: "12 here now · 348 members").
        <View style={styles.titleBox}>
          <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1} maxFontSizeMultiplier={1.5} accessibilityRole="header" testID="header-title">{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>{subtitle}</Text>
        </View>
      ) : title ? <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2} maxFontSizeMultiplier={1.5} accessibilityRole="header" testID="header-title">{title}</Text>
             : <Text style={styles.spacer} testID="header-title"> </Text>}
      {right}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  back:         { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Spacing.md, paddingVertical: Space.sm },
  titleBox:     { flex: 1 },
  title:        { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  titleCompact: { fontSize: FontSizes.md, fontWeight: '800' },
  spacer:       { flex: 1 },
  tab:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: Space.md, paddingBottom: Space.sm, overflow: 'hidden' },
  tabText:      { flexShrink: 1, gap: Space.xxs, zIndex: 1 },
  artSlot:      { alignSelf: 'stretch', flexGrow: 1, flexShrink: 0, minWidth: 0, marginVertical: -10 },
  tabTitle:     { fontSize: FontSizes.title, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  subtitle:     { fontSize: FontSizes.sm, lineHeight: 19, fontWeight: '500', color: c.muted },
});
