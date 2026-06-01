import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { createChallenge, updateChallenge } from '@/api/challenges';
import type { ChallengeType, ChallengeAudience } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const TYPES: { value: ChallengeType; icon: string }[] = [
  { value: 'food',    icon: '🍜' },
  { value: 'place',   icon: '📍' },
  { value: 'culture', icon: '🎭' },
  { value: 'help',    icon: '🤝' },
];

const AUDIENCES: ChallengeAudience[] = ['locals', 'explorers'];

export default function CreateChallengeScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { city, identity, account } = useApp();

  // Edit mode when `editId` is passed (owner editing their own challenge).
  const params = useLocalSearchParams<{
    editId?: string;
    title?: string;
    type?: string;
    audience?: string;
  }>();
  const editId = typeof params.editId === 'string' ? params.editId : null;

  const initialType: ChallengeType = TYPES.some(tp => tp.value === params.type)
    ? (params.type as ChallengeType)
    : 'food';
  const initialAudience: ChallengeAudience = AUDIENCES.includes(params.audience as ChallengeAudience)
    ? (params.audience as ChallengeAudience)
    : 'locals';

  const [audience, setAudience] = useState<ChallengeAudience>(initialAudience);
  const [type,     setType]     = useState<ChallengeType>(initialType);
  const [title,    setTitle]    = useState(typeof params.title === 'string' ? params.title : '');
  const [submitting, setSubmitting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !city || !identity) return;
    setSubmitting(true);
    setError(null);

    // Edit path: PUT the existing challenge, then back.
    if (editId) {
      try {
        await updateChallenge(editId, identity.guestId, trimmedTitle, type, audience);
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errSave'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Create path. Challenges allow guests (mirrors events) — nickname comes
    // from the account if present, else from the guest identity. Server falls
    // back gracefully when nickname is null.
    const nickname = account?.display_name ?? identity.nickname ?? null;
    try {
      const created = await createChallenge(
        city.channelId,
        identity.guestId,
        nickname,
        trimmedTitle,
        type,
        audience,
      );
      // Land the creator on the freshly-created challenge so they can share
      // it + watch participants accept in real time.
      router.replace(`/challenge/${created.id}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errStart'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{editId ? t('editTitle') : t('createTitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

        {/* Audience toggle — 2-pill row, full width, thumb-friendly */}
        <Text style={styles.sectionLabel}>{t('audience')}</Text>
        <View style={styles.audienceRow}>
          {AUDIENCES.map(a => {
            const selected = audience === a;
            return (
              <TouchableOpacity
                key={a}
                style={[styles.audienceBtn, selected && styles.audienceBtnSelected]}
                onPress={() => setAudience(a)}
                activeOpacity={0.7}
              >
                <Text style={[styles.audienceLabel, selected && styles.audienceLabelSelected]}>
                  {t(`aud.${a}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Type — 4 emoji squares (food / place / culture / help) */}
        <Text style={styles.sectionLabel}>{t('type')}</Text>
        <View style={styles.typeGrid}>
          {TYPES.map(tp => {
            const selected = type === tp.value;
            return (
              <TouchableOpacity
                key={tp.value}
                style={[styles.typeBtn, selected && styles.typeBtnSelected]}
                onPress={() => setType(tp.value)}
                activeOpacity={0.7}
              >
                <Text style={styles.typeEmoji}>{tp.icon}</Text>
                <Text style={[styles.typeLabel, selected && styles.typeLabelSelected]}>
                  {t(`tp.${tp.value}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Title — short, single field, primary input */}
        <Text style={styles.sectionLabel}>{t('titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('titlePlaceholder')}
          placeholderTextColor={Colors.muted2}
          maxLength={100}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Submit — full-width, orange brand, thumb-friendly */}
        <TouchableOpacity
          style={[styles.submitBtn, (!title.trim() || submitting) && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={!title.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={styles.submitBtnText}>{editId ? t('saveChanges') : t('createCta')}</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

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
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color:         Colors.muted,
    marginTop:     Spacing.md,
    marginBottom:  Spacing.xs,
  },

  // Audience toggle — 2 equal pills filling the row.
  audienceRow: {
    flexDirection: 'row',
    gap:           Spacing.sm,
  },
  audienceBtn: {
    flex:              1,
    paddingVertical:   Spacing.md - 2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
    alignItems:        'center',
  },
  audienceBtnSelected: {
    borderColor:     '#FF7A3C',
    backgroundColor: 'rgba(255,122,60,0.10)',
  },
  audienceLabel: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.muted,
  },
  audienceLabelSelected: { color: '#FF7A3C' },

  // Type grid — 4 squares in a 2×2 or single row depending on width. Stays
  // visually balanced via flex-basis ~22% each (lets 4 fit one row on phones).
  typeGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Spacing.sm,
  },
  typeBtn: {
    flexBasis:         '22%',
    flexGrow:          1,
    aspectRatio:       1,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
    alignItems:        'center',
    justifyContent:    'center',
    gap:               4,
  },
  typeBtnSelected: {
    borderColor:     '#FF7A3C',
    backgroundColor: 'rgba(255,122,60,0.10)',
  },
  typeEmoji: { fontSize: 28 },
  typeLabel: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted },
  typeLabelSelected: { color: '#FF7A3C' },

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

  errorText: {
    fontSize:  FontSizes.sm,
    color:     Colors.red,
    textAlign: 'center',
  },

  submitBtn: {
    marginTop:       Spacing.md,
    backgroundColor: '#FF7A3C',
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
