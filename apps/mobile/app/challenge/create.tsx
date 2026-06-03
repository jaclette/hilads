import { useEffect, useRef, useState } from 'react';
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
// Emoji per audience — 🏠 reads as "where they live" for locals,
// 🧳 as "they're passing through" for travelers.
const AUDIENCE_ICONS: Record<ChallengeAudience, string> = { locals: '🏠', explorers: '🧳' };

// Mirror backend ChallengeRepository::MAX_PARTICIPANTS_{MIN,MAX,DEFAULT}.
// Bumping these requires updating the PHP constants too.
const MAX_P_MIN     = 1;
const MAX_P_MAX     = 20;
const MAX_P_DEFAULT = 3;

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
    maxParticipants?: string;
    returnClause?: string;
  }>();
  const editId = typeof params.editId === 'string' ? params.editId : null;

  const initialType: ChallengeType = TYPES.some(tp => tp.value === params.type)
    ? (params.type as ChallengeType)
    : 'food';
  const initialAudience: ChallengeAudience = AUDIENCES.includes(params.audience as ChallengeAudience)
    ? (params.audience as ChallengeAudience)
    : 'locals';
  const initialMaxParticipants = (() => {
    const n = parseInt(params.maxParticipants ?? '', 10);
    return Number.isFinite(n) && n >= MAX_P_MIN && n <= MAX_P_MAX ? n : MAX_P_DEFAULT;
  })();

  const [audience, setAudience] = useState<ChallengeAudience>(initialAudience);
  const [type,     setType]     = useState<ChallengeType>(initialType);
  const [title,    setTitle]    = useState(typeof params.title === 'string' ? params.title : '');
  const [maxParticipants, setMaxParticipants] = useState<number>(initialMaxParticipants);
  // returnClause is pre-filled by the per-type template (see effect below)
  // unless the user (a) is editing and the server has a stored value, or
  // (b) has manually edited it. `returnClauseDirty` flips to true on the
  // first manual edit, after which type switches stop overwriting it.
  const [returnClause,      setReturnClause]      = useState<string>(typeof params.returnClause === 'string' ? params.returnClause : '');
  const returnClauseDirty                         = useRef<boolean>(typeof params.returnClause === 'string' && params.returnClause.length > 0);
  const [submitting, setSubmitting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Re-template the return clause whenever the type changes, UNLESS the user
  // has already edited it manually (we don't want to clobber a custom phrase).
  useEffect(() => {
    if (returnClauseDirty.current) return;
    const template = t(`returnClauseTemplates.${type}`);
    setReturnClause(template);
  }, [type, t]);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !city || !identity) return;
    setSubmitting(true);
    setError(null);

    const trimmedReturnClause = returnClause.trim() || null;

    // Edit path: PUT the existing challenge, then back.
    if (editId) {
      try {
        await updateChallenge(editId, identity.guestId, trimmedTitle, type, audience, maxParticipants, trimmedReturnClause);
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
        maxParticipants,
        trimmedReturnClause,
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

  // Guest gate — challenge creation requires a registered account (mirrors
  // event + hangout creation). Guests can still browse / accept / chat in
  // challenge channels; only authoring is locked.
  if (!account) {
    router.replace('/auth-gate?reason=create_challenge');
    return null;
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
                <Text style={styles.audienceEmoji}>{AUDIENCE_ICONS[a]}</Text>
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
          returnKeyType="next"
          blurOnSubmit={false}
        />

        {/* Return clause — the "...and come tell me about it in person" half.
            Pre-filled by per-type template (food/place/culture/help). Editable
            so the creator can sharpen it; first edit pins the value (type
            switches stop overwriting it). Forces every challenge to lead to
            a real meetup. */}
        <Text style={styles.sectionLabel}>{t('returnClauseLabel')}</Text>
        <TextInput
          style={styles.input}
          value={returnClause}
          onChangeText={(v) => { returnClauseDirty.current = true; setReturnClause(v); }}
          placeholder={t('returnClauseTemplates.food')}
          placeholderTextColor={Colors.muted2}
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        {/* Max participants stepper — how many travelers can take this on.
            Stepper instead of slider because the range is 1-20 and discrete
            single-tap +/- is faster on mobile than a slider drag. Centred
            number for tap-target balance. */}
        <Text style={styles.sectionLabel}>{t('maxParticipantsLabel')}</Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            style={[styles.stepperBtn, maxParticipants <= MAX_P_MIN && styles.stepperBtnDisabled]}
            activeOpacity={0.7}
            disabled={maxParticipants <= MAX_P_MIN}
            onPress={() => setMaxParticipants(Math.max(MAX_P_MIN, maxParticipants - 1))}
          >
            <Ionicons name="remove" size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.stepperValue}>{maxParticipants}</Text>
          <TouchableOpacity
            style={[styles.stepperBtn, maxParticipants >= MAX_P_MAX && styles.stepperBtnDisabled]}
            activeOpacity={0.7}
            disabled={maxParticipants >= MAX_P_MAX}
            onPress={() => setMaxParticipants(Math.min(MAX_P_MAX, maxParticipants + 1))}
          >
            <Ionicons name="add" size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

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

        {/* Examples — 3 starters that swap with the selected type. Tap
            fills the title input directly (real challenge text, not just
            inspiration). Sits below the CTA so it doesn't pull focus
            from the primary action. */}
        {(() => {
          const examples = t(`examples.${type}`, { returnObjects: true }) as unknown as string[];
          if (!Array.isArray(examples) || examples.length === 0) return null;
          return (
            <View style={styles.examplesBlock}>
              <Text style={styles.examplesLabel}>{t('examples.label')}</Text>
              <View style={styles.examplesGrid}>
                {examples.map((ex, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.exampleChip}
                    activeOpacity={0.75}
                    onPress={() => setTitle(ex)}
                  >
                    <Text style={styles.exampleChipText}>{ex}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })()}

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
    flexDirection:     'row',
    paddingVertical:   Spacing.md - 2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
  },
  audienceEmoji: { fontSize: 18, lineHeight: 20 },
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

  // Stepper row for max_participants — −/+ buttons flanking the centred number.
  stepperRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Spacing.md,
  },
  stepperBtn: {
    width:           44,
    height:          44,
    borderRadius:    Radius.full,
    borderWidth:     1,
    borderColor:     Colors.border,
    backgroundColor: Colors.bg2,
    alignItems:      'center',
    justifyContent:  'center',
  },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperValue: {
    fontSize:   FontSizes.xl,
    fontWeight: '800',
    color:      Colors.text,
    minWidth:   48,
    textAlign:  'center',
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

  // Examples — mirrors the web .cef-examples* block. Muted chips so they
  // sit underneath the orange CTA without competing for the eye.
  examplesBlock:  { marginTop: Spacing.lg, gap: Spacing.sm - 1 },
  examplesLabel:  {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  examplesGrid:   { gap: 6 },
  exampleChip:    {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    borderRadius:    10,
    paddingVertical:   10,
    paddingHorizontal: 14,
  },
  exampleChipText: { color: Colors.text, fontSize: FontSizes.xs + 1 },
});
