import type { ReactNode } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { BrandMark, Screen, ScreenHeader } from '@/ui';
import { KeyboardForm } from '@/ui/keyboard';

/** Sign in / sign up / forgot password: back button, the "Hi" mark, title, subtitle, an error box, then the form. */
export function AuthScreen({ title, subtitle, error, children }: { title?: string; subtitle?: string; error?: string | null; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="" />
      {/* The focused field and the button under it stay above the keyboard. */}
      <KeyboardForm contentContainerStyle={styles.body} bottomOffset={120}>
        {!!title && (
          <View style={styles.head}>
            <BrandMark size="lg" />
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        )}
        {!!error && (
          <View style={styles.error} accessibilityRole="alert">
            <Ionicons name="alert-circle-outline" size={18} color={colors.red} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {children}
      </KeyboardForm>
    </Screen>
  );
}

/** The show / hide password eye, for TextField's `right` slot. */
export function PasswordEye({ shown, onPress }: { shown: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <TouchableOpacity style={styles.eye} onPress={onPress} accessibilityRole="button"
                      accessibilityLabel={shown ? t('hidePassword', { defaultValue: 'Hide password' }) : t('showPassword', { defaultValue: 'Show password' })}>
      <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:      { flex: 1 },
  body:      { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl, gap: Spacing.md },
  head:      { gap: 8, marginBottom: 4 },
  title:     { fontSize: FontSizes.xxl, fontWeight: '800', color: c.text, letterSpacing: -0.5, marginTop: 6 },
  subtitle:  { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  error:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: Radius.button, borderWidth: 1.5, borderColor: c.red },
  errorText: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.red },
  eye:       { width: 44, height: 44, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
});
