import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { BrandMark, Button } from '@/ui';

interface Props {
  error:    string | null;
  onRetry?: () => void;
}

export function BootScreen({ error, onRetry }: Props) {
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.container}>
      <BrandMark size="lg" />
      <Text style={styles.logo}>Hilads</Text>
      <Text style={styles.tagline}>{t('firstLaunch')}</Text>
      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>{t('connectionHint')}</Text>
          {onRetry && <Button label={t('retry')} onPress={onRetry} style={styles.retry} />}
        </>
      ) : (
        <ActivityIndicator color={colors.primary} size="large" style={styles.spinner} />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: c.bg,
    alignItems:      'center',
    justifyContent:  'center',
    padding:         Spacing.xl,
  },
  logo: {
    fontSize:      40,
    fontWeight:    '800',
    color:         c.primaryText,
    letterSpacing: -1,
    marginTop:     Spacing.md,
  },
  // SPEC 9.9: the line under the logo on launch.
  tagline: {
    fontSize:     FontSizes.md,
    fontWeight:   '600',
    color:        c.muted,
    textAlign:    'center',
    marginTop:    6,
    marginBottom: Spacing.xl,
  },
  spinner:   { marginTop: Spacing.md },
  errorText: {
    fontSize:  FontSizes.md,
    color:     c.red,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  errorHint: {
    fontSize:  FontSizes.sm,
    color:     c.muted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  retry: { marginTop: Spacing.lg, minWidth: 160 },
});
