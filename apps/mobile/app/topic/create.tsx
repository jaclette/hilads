import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { createTopic, updateTopic } from '@/api/topics';
import { ApiError } from '@/api/client';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

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

    // Hangout's location = creator's location at creation. Reuse the OS-cached
    // fix (no prompt, no watcher); missing/denied → no coords, no distance shown.
    let coords: { lat: number; lng: number } | null = null;
    try {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (granted) {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
        if (last) coords = { lat: last.coords.latitude, lng: last.coords.longitude };
      }
    } catch { /* no coords — non-fatal */ }
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

  // ── Guest gate — hosting a hangout requires a registered account ─────────────
  if (!account) {
    router.replace('/auth-gate?reason=create_hangout');
    return null;
  }

  // ── One-hangout-per-user — you already have an active hangout. ───────────────
  if (limitTopic) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}><Text style={styles.headerTitle}>{t('limitHeader')}</Text></View>
        </View>
        <View style={styles.limitWrap}>
          <Text style={styles.limitEmoji}>⚡</Text>
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
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{editId ? t('editTitle') : t('startTitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

        {/* Category chips */}
        <Text style={styles.sectionLabel}>{t('category')}</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map(cat => {
            const selected = category === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[styles.catChip, selected && styles.catChipSelected]}
                activeOpacity={0.7}
                onPress={() => setCategory(cat.value)}
              >
                <Text style={styles.catIcon}>{cat.icon}</Text>
                <Text style={[styles.catLabel, selected && styles.catLabelSelected]}>{t(`cat.${cat.value}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Title */}
        <Text style={styles.sectionLabel}>{t('titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('titlePlaceholder')}
          placeholderTextColor={Colors.muted2}
          maxLength={100}
          autoFocus
          returnKeyType="next"
        />

        {/* Description */}
        <Text style={styles.sectionLabel}>
          {t('detailsLabel')}{'  '}
          <Text style={styles.optional}>{t('optional')}</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder={t('detailsPlaceholder')}
          placeholderTextColor={Colors.muted2}
          maxLength={300}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* Expiry note */}
        {!editId ? <Text style={styles.expiryNote}>{t('expiry')}</Text> : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!title.trim() || submitting) && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={!title.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={styles.submitBtnText}>{editId ? t('saveChanges') : t('startCta')}</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  limitWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: 10 },
  limitEmoji: { fontSize: 44 },
  limitTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  limitSub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22, marginBottom: 8 },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  body:        { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },

  sectionLabel: {
    fontSize:     FontSizes.xs,
    fontWeight:   '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color:         Colors.muted,
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
    borderColor:     Colors.border,
    backgroundColor: Colors.bg2,
  },
  catChipSelected: {
    borderColor:     '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.10)',
  },
  catIcon:  { fontSize: 20 },
  catLabel: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted },
  catLabelSelected: { color: '#60a5fa' },

  input: {
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 4,
    fontSize:        FontSizes.md,
    color:           Colors.text,
  },
  textArea: { minHeight: 90, paddingTop: Spacing.sm + 4 },

  expiryNote: {
    fontSize:  FontSizes.sm,
    color:     Colors.muted2,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },

  errorText: {
    fontSize:  FontSizes.sm,
    color:     Colors.red,
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
    color:      Colors.white,
    fontWeight: '700',
    fontSize:   FontSizes.md,
  },
});
