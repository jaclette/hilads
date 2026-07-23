import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { useApp } from '@/context/AppContext';
import { createTopic, updateTopic } from '@/api/topics';
import { ApiError } from '@/api/client';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

type TopicCategory = 'general' | 'tips' | 'food' | 'drinks' | 'help' | 'meetup';

const CATEGORIES: { value: TopicCategory; icon: string }[] = [
  { value: 'general', icon: '🗣️' },
  { value: 'tips',    icon: '💡' },
  { value: 'food',    icon: '🍴' },
  { value: 'drinks',  icon: '🍺' },
  { value: 'help',    icon: '🙋' },
  { value: 'meetup',  icon: '👋' },
];

export default function CreateTopicScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router   = useRouter();
  const { t } = useTranslation('hangout');
  const { city, identity, account } = useApp();
  // Edit mode when `editId` is passed (owner editing their hangout).
  const params  = useLocalSearchParams<{ editId?: string; title?: string; description?: string; category?: string }>();
  const editId  = typeof params.editId === 'string' ? params.editId : null;

  const [category,    setCategory]    = useState<TopicCategory>(
    (CATEGORIES.some(c => c.value === params.category) ? params.category : 'general') as TopicCategory);
  const [title,       setTitle]       = useState(typeof params.title === 'string' ? params.title : '');
  const [description, setDescription] = useState(typeof params.description === 'string' ? params.description : '');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  // Set when the server rejects a new hangout because the user already owns one.
  const [limitTopic,  setLimitTopic]  = useState<{ id: string; title: string } | null>(null);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !city || !identity) return;
    setSubmitting(true);
    setError(null);

    // Edit: PUT the existing hangout (no coords change), then go back.
    if (editId) {
      try {
        await updateTopic(editId, identity.guestId, title.trim(), description.trim() || null, category);
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errSave'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Launching a Hi now REQUIRES precise location - it tells people where to
    // meet you - so we request it here, at launch (not up-front). Block on denial
    // and explain; offer Settings when permission is permanently denied.
    const geo = await requestFeatureLocation('hi_now');
    if (!geo.ok) {
      if (geo.permanentlyDenied) {
        Alert.alert(t('geoRequiredTitle'), t('geoRequiredSettings'), [
          { text: t('cancel', { ns: 'common' }), style: 'cancel' },
          { text: t('openSettings', { ns: 'common' }), onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError(t('geoRequired'));
      }
      setSubmitting(false);
      return;
    }
    const coords = geo.coords!;
    try {
      await createTopic(city.channelId, identity.guestId, trimmedTitle, description.trim() || null, category, coords);
      router.back();
    } catch (err) {
      // One-hangout-per-user: surface the existing hangout instead of an error.
      if (err instanceof ApiError && err.status === 409 && err.body?.error === 'hangout_limit') {
        setLimitTopic({ id: err.body.existingTopicId, title: err.body.existingTitle ?? t('yourHangout') });
      } else {
        setError(err instanceof Error ? err.message : t('errStart'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Guest gate - hosting a hangout requires a registered account ─────────────
  if (!account) {
    router.replace('/auth-gate?reason=create_hangout');
    return null;
  }

  // ── One-hangout-per-user - you already have an active hangout. ───────────────
  if (limitTopic) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}><Text style={styles.headerTitle}>{t('limitHeader')}</Text></View>
        </View>
        <View style={styles.limitWrap}>
          <Text style={styles.limitEmoji}>🗣️</Text>
          <Text style={styles.limitTitle}>{t('limitTitle')}</Text>
          <Text style={styles.limitSub}>
            {t('limitSub', { title: limitTopic.title })}
          </Text>
          <TouchableOpacity style={styles.submitBtn} activeOpacity={0.85} onPress={() => router.replace(`/topic/${limitTopic.id}`)}>
            <Text style={styles.submitBtnText}>{t('limitGo')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{editId ? t('editTitle') : t('startTitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

        {/* Title */}
        <Text style={styles.sectionLabel}>{t('titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('titlePlaceholder')}
          placeholderTextColor={colors.muted2}
          maxLength={100}
          autoFocus
          returnKeyType="next"
        />

        {/* Expiry note */}
        {!editId ? <Text style={styles.expiryNote}>{t('expiry')}</Text> : null}

        {/* Geo explainer - why turning on location matters (fun + motivating). */}
        {!editId ? (
          <View style={styles.geoHint}>
            <Text style={styles.geoHintText}>
              {t('geoHint', { defaultValue: '📍 Turn on location to see who’s around right now — and let nearby people catch your Hi 👀🔥' })}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!title.trim() || submitting) && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={!title.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator color={colors.white} size="small" />
            : <Text style={styles.submitBtnText}>{editId ? t('saveChanges') : t('startCta')}</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  limitWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: 10 },
  limitEmoji: { fontSize: 44 },
  limitTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center' },
  limitSub:   { fontSize: FontSizes.md, color: c.muted, textAlign: 'center', lineHeight: 22, marginBottom: 8 },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: c.overlay,
    borderWidth:     1,
    borderColor:     c.overlayStrong,
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, letterSpacing: -0.3 },

  body:        { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },

  sectionLabel: {
    fontSize:     FontSizes.xs,
    fontWeight:   '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color:         c.muted,
    marginTop:     Spacing.md,
    marginBottom:  Spacing.xs,
  },
  optional: { fontWeight: '400', textTransform: 'none', letterSpacing: 0 },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Spacing.sm,
  },
  catChip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    backgroundColor: c.bg2,
  },
  catChipSelected: {
    borderColor:     '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.10)',
  },
  catIcon:  { fontSize: 20 },
  catLabel: { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  catLabelSelected: { color: '#60a5fa' },

  input: {
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 4,
    fontSize:        FontSizes.md,
    color:           c.text,
  },
  textArea: { minHeight: 90, paddingTop: Spacing.sm + 4 },

  expiryNote: {
    fontSize:  FontSizes.sm,
    color:     c.muted2,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  geoHint: {
    marginTop:         Spacing.lg,
    paddingVertical:   12,
    paddingHorizontal: 14,
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.35)',
    backgroundColor:   'rgba(255,122,60,0.08)',
  },
  geoHintText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      c.accent,
    textAlign:  'center',
    lineHeight: 19,
  },

  errorText: {
    fontSize:  FontSizes.sm,
    color:     c.red,
    textAlign: 'center',
  },

  submitBtn: {
    marginTop:       Spacing.md,
    backgroundColor: '#60a5fa',
    borderRadius:    Radius.full,
    paddingVertical: Spacing.md + 2,
    alignItems:      'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: {
    color:      c.white,
    fontWeight: '700',
    fontSize:   FontSizes.md,
  },
});
