import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';

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
      <Text style={styles.logo}>Hilads</Text>
      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>{t('connectionHint')}</Text>
          {onRetry && (
            <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
              <Text style={styles.retryText}>{t('retry')}</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <ActivityIndicator color={colors.accent} size="large" style={styles.spinner} />
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
    color:         c.accentText,   // bright #FF7A3C fails as text on cream → accentText
    letterSpacing: -1,
    marginBottom:  Spacing.xl,
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
  retryBtn: {
    marginTop:         Spacing.lg,
    backgroundColor:   c.accent,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm,
  },
  retryText: {
    color:      c.white,
    fontWeight: '700',
    fontSize:   FontSizes.sm,
  },
});
