import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authForgotPassword } from '@/api/auth';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {sent ? (
              <View style={styles.successBlock}>
                <Text style={styles.successIcon}>✉️</Text>
                <Text style={styles.successTitle}>{t('forgotPassword.sentTitle')}</Text>
                <Text style={styles.successBody}>{t('forgotPassword.sentBody')}</Text>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={() => router.back()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.submitText}>{t('forgotPassword.backToSignIn')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{t('forgotPassword.title')}</Text>
                <Text style={styles.subtitle}>{t('forgotPassword.subtitle')}</Text>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('forgotPassword.email')}</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('forgotPassword.emailPlaceholder')}
                    placeholderTextColor={colors.muted2}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    editable={!loading}
                    autoFocus
                    returnKeyType="send"
                    onSubmitEditing={handleSubmit}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, (loading || !email.trim()) && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  activeOpacity={0.85}
                  disabled={loading || !email.trim()}
                >
                  {loading
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.submitText}>{t('forgotPassword.submit')}</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  flex:      { flex: 1 },
  scroll:    { flexGrow: 1, paddingBottom: Spacing.xxl },

  header:   { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backBtn:  { padding: 4, alignSelf: 'flex-start' },
  backIcon: { fontSize: 22, color: c.text },

  body: {
    flex:              1,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.xl,
    gap:               Spacing.md,
  },
  title:    { fontSize: FontSizes.xxl, fontWeight: '700', color: c.text },
  subtitle: { fontSize: FontSizes.sm, color: c.muted, marginBottom: Spacing.sm },

  field:  { gap: 6 },
  label:  { fontSize: FontSizes.sm, color: c.muted, fontWeight: '500' },
  input: {
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    color:             c.text,
    fontSize:          FontSizes.md,
    height:            48,
  },

  submitBtn: {
    backgroundColor: c.accent,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: {
    color:              c.white,
    fontWeight:         '700',
    fontSize:           FontSizes.md,
    lineHeight:         FontSizes.md * 1.25,
    includeFontPadding: false,
  },

  successBlock: {
    alignItems:  'center',
    gap:         Spacing.md,
    paddingTop:  Spacing.xl,
  },
  successIcon:  { fontSize: 48, marginBottom: Spacing.sm },
  successTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: c.text },
  successBody: {
    fontSize:   FontSizes.sm,
    color:      c.muted,
    textAlign:  'center',
    lineHeight: FontSizes.sm * 1.6,
  },
});
