import { Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { AppHeader } from '@/features/shell/AppHeader';

/** MAP tab. The Mapbox map of spots arrives with V3-07; until then a placeholder. */
export default function MapScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}><AppHeader /></View>
      <View style={styles.center}>
        <Ionicons name="map-outline" size={44} color={colors.primaryText} />
        <Text style={styles.text}>{t('mapSoon')}</Text>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header:    { paddingHorizontal: Spacing.md },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: Spacing.lg },
  text:      { fontSize: FontSizes.md, color: c.muted, textAlign: 'center' },
});
