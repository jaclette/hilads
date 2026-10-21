import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authForgotPassword } from '@/api/auth';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, TextField } from '@/ui';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { goBack } from '@/lib/nav';

export default function ForgotPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('auth');

  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);

  async function handleSubmit() {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setLoading(true);
    try {
      await authForgotPassword(e);
    } catch {
      // Always show success - never reveal if email exists
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <AuthScreen>
        <View style={styles.success}>
          <View style={styles.successIcon}><Ionicons name="mail-outline" size={34} color={colors.primaryOnTint} /></View>
          <Text style={styles.successTitle} accessibilityRole="header">{t('forgotPassword.sentTitle')}</Text>
          <Text style={styles.successBody}>{t('forgotPassword.sentBody')}</Text>
          <Button label={t('forgotPassword.backToSignIn')} onPress={() => goBack()} style={styles.stretch} />
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')}>
      <TextField
        label={t('forgotPassword.email')}
        value={email}
        onChangeText={setEmail}
        placeholder={t('forgotPassword.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!loading}
        autoFocus
        returnKeyType="send"
        onSubmitEditing={handleSubmit}
      />
      <Button label={t('forgotPassword.submit')} onPress={handleSubmit} loading={loading} disabled={!email.trim()} style={styles.submit} />
    </AuthScreen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  submit:       { marginTop: Spacing.sm },
  success:      { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.xl },
  successIcon:  { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center' },
  successBody:  { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, textAlign: 'center', lineHeight: FontSizes.sm * 1.6 },
  stretch:      { alignSelf: 'stretch', marginTop: Spacing.sm },
});
