import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, FlatList, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { createChallenge, updateChallenge, dismissPublicOptin } from '@/api/challenges';
import { fetchChannels } from '@/api/channels';
import { localizeCityName } from '@/i18n/cityName';
import type { ChallengeType, ChallengeAudience, City } from '@/types';
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

// Mode toggle — Local is the hero (in-person meetup in this city); International
// is the always-available alternative (cross-city, proof-based, no meetup).
type ChallengeMode = 'local' | 'international';
const MODES: ChallengeMode[] = ['local', 'international'];
const MODE_ICONS: Record<ChallengeMode, string> = { local: '🏙️', international: '🌐' };

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
    returnClause?: string;
    mode?: string;
    targetCityChannelId?: string;
    proofRequirements?: string;
  }>();
  const editId = typeof params.editId === 'string' ? params.editId : null;

  const initialType: ChallengeType = TYPES.some(tp => tp.value === params.type)
    ? (params.type as ChallengeType)
    : 'food';
  const initialAudience: ChallengeAudience = AUDIENCES.includes(params.audience as ChallengeAudience)
    ? (params.audience as ChallengeAudience)
    : 'locals';
  const initialMode: ChallengeMode = MODES.includes(params.mode as ChallengeMode)
    ? (params.mode as ChallengeMode)
    : 'local';

  const [mode,     setMode]     = useState<ChallengeMode>(initialMode);
  const [audience, setAudience] = useState<ChallengeAudience>(initialAudience);
  const [type,     setType]     = useState<ChallengeType>(initialType);
  const [title,    setTitle]    = useState(typeof params.title === 'string' ? params.title : '');
  // returnClause is pre-filled by the per-type template (see effect below)
  // unless the user (a) is editing and the server has a stored value, or
  // (b) has manually edited it. `returnClauseDirty` flips to true on the
  // first manual edit, after which type switches stop overwriting it.
  const [returnClause,      setReturnClause]      = useState<string>(typeof params.returnClause === 'string' ? params.returnClause : '');
  const returnClauseDirty                         = useRef<boolean>(typeof params.returnClause === 'string' && params.returnClause.length > 0);
  // International-only state. targetCity null = "anywhere".
  const [targetCity,        setTargetCity]        = useState<{ channelId: string; name: string; country: string } | null>(null);
  const [cityPickerOpen,    setCityPickerOpen]    = useState(false);
  const [proofRequirements, setProofRequirements] = useState<string>(typeof params.proofRequirements === 'string' ? params.proofRequirements : '');
  const [submitting, setSubmitting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Visibility — 'public' default; 'friends' opt-in. Private isn't settable
  // here (server enforces); the mutual privacy flow is the only path.
  type Visibility = 'public' | 'friends';
  const initialVisibility: Visibility =
    (typeof (params as { visibility?: string }).visibility === 'string'
      && ['public', 'friends'].includes((params as { visibility?: string }).visibility as string))
      ? ((params as { visibility: string }).visibility as Visibility)
      : 'public';
  const [visibility,        setVisibility]        = useState<Visibility>(initialVisibility);
  const [optinOpen,         setOptinOpen]         = useState(false);
  const [optinDismissing,   setOptinDismissing]   = useState(false);
  const pendingSubmitRef                          = useRef<null | (() => Promise<void>)>(null);
  const hasSeenPublicOptin                        = !!account?.has_seen_public_optin;

  // International is always public — keep state in sync so the payload
  // matches what the server will enforce.
  useEffect(() => {
    if (mode === 'international' && visibility !== 'public') setVisibility('public');
  }, [mode, visibility]);

  // Re-template the return clause whenever the type changes, UNLESS the user
  // has already edited it manually (we don't want to clobber a custom phrase).
  useEffect(() => {
    if (returnClauseDirty.current) return;
    const template = t(`returnClauseTemplates.${type}`);
    setReturnClause(template);
  }, [type, t]);

  async function performSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !city || !identity) return;
    setSubmitting(true);
    setError(null);

    const trimmedReturnClause      = mode === 'local'        ? (returnClause.trim()      || null) : null;
    const trimmedProofRequirements = mode === 'international' ? (proofRequirements.trim() || null) : null;
    const targetChannelIdForSubmit = mode === 'international' ? (targetCity?.channelId ?? null)   : null;
    // International is forced to 'public' server-side — match it here.
    const visibilityForSubmit: Visibility = mode === 'international' ? 'public' : visibility;

    // Edit path: PUT the existing challenge, then back.
    if (editId) {
      try {
        await updateChallenge(editId, identity.guestId, trimmedTitle, type, audience, trimmedReturnClause, {
          targetCityChannelId: targetChannelIdForSubmit,
          proofRequirements:   trimmedProofRequirements,
          visibility:          visibilityForSubmit,
        });
        router.back();
      } catch (err) {
        // Moderation surface — translate to the user-facing string so it
        // matches what the server is signalling.
        const e = err as { code?: string; message?: string };
        if (e?.code === 'moderation_blocked') setError(t('visibility.moderationBlocked'));
        else setError(e?.message || t('errSave'));
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
        trimmedReturnClause,
        {
          mode,
          targetCityChannelId: targetChannelIdForSubmit,
          proofRequirements:   trimmedProofRequirements,
          visibility:          visibilityForSubmit,
        },
      );
      // Land the creator on the freshly-created challenge so they can share
      // it + watch participants accept in real time. The ?postCreate=1 query
      // param triggers the "seed it" sheet on the detail screen so the
      // creator is nudged to invite specific city members or share externally.
      router.replace(`/challenge/${created.id}?postCreate=1` as never);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === 'moderation_blocked') setError(t('visibility.moderationBlocked'));
      else setError(e?.message || t('errStart'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!title.trim() || submitting) return;
    const wantsPublic = (mode === 'international') || visibility === 'public';
    if (!editId && wantsPublic && !hasSeenPublicOptin) {
      pendingSubmitRef.current = performSubmit;
      setOptinOpen(true);
      return;
    }
    await performSubmit();
  }

  async function handleOptinConfirm() {
    setOptinDismissing(true);
    try { await dismissPublicOptin(); } catch { /* best-effort */ }
    setOptinDismissing(false);
    setOptinOpen(false);
    const next = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    if (next) await next();
  }

  function handleOptinSwitchToFriends() {
    setVisibility('friends');
    setOptinOpen(false);
    pendingSubmitRef.current = null;
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

        {/* Mode toggle — Local (hero) vs International. Local default. Edit
            mode disables the toggle (mode is not editable; delete+recreate). */}
        <Text style={styles.sectionLabel}>{t('mode.label')}</Text>
        <View style={styles.audienceRow}>
          {MODES.map(m => {
            const selected = mode === m;
            const disabled = editId !== null;
            return (
              <TouchableOpacity
                key={m}
                style={[
                  styles.audienceBtn,
                  selected && styles.audienceBtnSelected,
                  disabled  && !selected && { opacity: 0.4 },
                ]}
                onPress={() => !disabled && setMode(m)}
                activeOpacity={disabled ? 1 : 0.7}
                disabled={disabled}
              >
                <Text style={styles.audienceEmoji}>{MODE_ICONS[m]}</Text>
                <Text style={[styles.audienceLabel, selected && styles.audienceLabelSelected]}>
                  {t(`mode.${m}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>
          {mode === 'local' ? t('mode.localHint') : t('mode.internationalHint')}
        </Text>

        {/* Audience toggle (Local only) — 2-pill row, full width, thumb-friendly */}
        {mode === 'local' && (
          <>
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
          </>
        )}

        {/* Target city (International only) — opens a full-screen picker.
            Null = "anywhere" (per spec decision: no fan-out, surfaces in
            origin city + a future Discover tab). */}
        {mode === 'international' && (
          <>
            <Text style={styles.sectionLabel}>{t('intl.targetCityLabel')}</Text>
            <TouchableOpacity
              style={styles.cityPickerBtn}
              activeOpacity={0.75}
              onPress={() => setCityPickerOpen(true)}
            >
              <Text style={styles.cityPickerText} numberOfLines={1}>
                {targetCity
                  ? `${targetCity.name} · ${targetCity.country}`
                  : t('intl.targetCityAnywhere')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <Text style={styles.sectionHint}>{t('intl.targetCityHint')}</Text>
          </>
        )}

        {/* Visibility — Public default; Friends opt-in. Locked to Public
            on International rows (server enforces; we keep state in sync). */}
        <Text style={styles.sectionLabel}>{t('visibility.label')}</Text>
        <View style={styles.audienceRow}>
          {(['public', 'friends'] as Visibility[]).map(v => {
            const selected = visibility === v;
            const lockedFriends = v === 'friends' && mode === 'international';
            return (
              <TouchableOpacity
                key={v}
                style={[
                  styles.audienceBtn,
                  selected && styles.audienceBtnSelected,
                  lockedFriends && { opacity: 0.4 },
                ]}
                onPress={() => !lockedFriends && setVisibility(v)}
                activeOpacity={lockedFriends ? 1 : 0.7}
                disabled={lockedFriends}
              >
                <Text style={[styles.audienceLabel, selected && styles.audienceLabelSelected]}>
                  {t(`visibility.${v}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>
          {mode === 'international'
            ? t('visibility.intlLocked')
            : t(visibility === 'public' ? 'visibility.publicHint' : 'visibility.friendsHint')}
        </Text>

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

        {/* Return clause (Local only) — the "...and come tell me about it
            in person" half. Pre-filled by per-type template; first manual
            edit pins the value. Forces every Local challenge to lead to a
            real meetup. */}
        {mode === 'local' && (
          <>
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
          </>
        )}

        {/* Proof requirements (International only) — creator-authored
            spec shown to the acceptor before they submit their proof.
            "Photo of the dish, daylight, with you in frame" etc. */}
        {mode === 'international' && (
          <>
            <Text style={styles.sectionLabel}>{t('intl.proofRequirementsLabel')}</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={proofRequirements}
              onChangeText={setProofRequirements}
              placeholder={t('intl.proofRequirementsPlaceholder')}
              placeholderTextColor={Colors.muted2}
              maxLength={300}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
            <Text style={styles.sectionHint}>{t('intl.proofRequirementsHint')}</Text>
          </>
        )}

        {/* Max-participants stepper removed (1:1 model). A challenge is now
            "available" until one taker is in progress, then frees back to
            "available" after the meet-up. No cap to set. */}

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

      {/* City picker — full-page modal. "Anywhere" option pinned at top so
          the creator can clear a previous selection in one tap. */}
      <TargetCityPickerSheet
        visible={cityPickerOpen}
        currentCityChannelId={city?.channelId ?? null}
        selected={targetCity}
        onClose={() => setCityPickerOpen(false)}
        onSelect={(c) => { setTargetCity(c); setCityPickerOpen(false); }}
      />

      {/* First-time public opt-in modal — shown once per user (server
          flips has_seen_public_optin on confirm). Switching to Friends
          from here is intentional and does NOT mark optin as seen. */}
      <PublicOptinModal
        visible={optinOpen}
        dismissing={optinDismissing}
        onConfirm={handleOptinConfirm}
        onSwitchToFriends={handleOptinSwitchToFriends}
        onClose={() => { setOptinOpen(false); pendingSubmitRef.current = null; }}
      />
    </SafeAreaView>
  );
}

function PublicOptinModal({
  visible, dismissing, onConfirm, onSwitchToFriends, onClose,
}: {
  visible:           boolean;
  dismissing:        boolean;
  onConfirm:         () => void;
  onSwitchToFriends: () => void;
  onClose:           () => void;
}) {
  const { t } = useTranslation('challenge');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.optinOverlay} onPress={onClose}>
        <Pressable style={styles.optinPanel} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.optinTitle}>{t('visibility.optin.title')}</Text>
          <Text style={styles.optinBody}>{t('visibility.optin.body')}</Text>
          <TouchableOpacity
            style={[styles.submitBtn, dismissing && styles.submitBtnDisabled]}
            disabled={dismissing}
            onPress={onConfirm}
            activeOpacity={0.85}
          >
            {dismissing
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.submitBtnText}>{t('visibility.optin.cta')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.optinGhostBtn}
            disabled={dismissing}
            onPress={onSwitchToFriends}
            activeOpacity={0.75}
          >
            <Text style={styles.optinGhostText}>{t('visibility.optin.switchToFriends')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Target city picker (International only) ──────────────────────────────────
// Bottom-sheet modal that lists every city in the system (deduped) with a
// "🌍 Anywhere" row pinned at the top so the creator can clear the choice
// in one tap. Reuses the existing /channels endpoint that powers the
// switch-city screen (already cached by the API layer).

type TargetCityChoice = { channelId: string; name: string; country: string };

function TargetCityPickerSheet({
  visible, currentCityChannelId, selected, onClose, onSelect,
}: {
  visible:              boolean;
  currentCityChannelId: string | null;
  selected:             TargetCityChoice | null;
  onClose:              () => void;
  onSelect:             (c: TargetCityChoice | null) => void;
}) {
  const { t } = useTranslation('challenge');
  const [cities,  setCities]  = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    fetchChannels()
      .then(list => { if (active) setCities(list); })
      .catch(() => { if (active) setCities([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const filtered = useMemo(() => {
    // Drop the creator's own city — challenges that target the same city
    // they're created from should just be Local, not International.
    const pool = cities.filter(c => c.channelId !== currentCityChannelId);
    const q = query.trim().toLowerCase();
    if (q === '') return pool;
    return pool.filter(c =>
      (c.name ?? '').toLowerCase().includes(q)
      || (c.country ?? '').toLowerCase().includes(q),
    );
  }, [cities, currentCityChannelId, query]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.cityModalBackdrop} onPress={onClose} />
      <View style={styles.cityModalSheet}>
        <View style={styles.cityModalHandle} />
        <View style={styles.cityModalHeader}>
          <Text style={styles.cityModalTitle}>{t('intl.cityPicker.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.cityModalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.cityModalSearch}
          value={query}
          onChangeText={setQuery}
          placeholder={t('intl.cityPicker.searchPlaceholder')}
          placeholderTextColor={Colors.muted2}
          autoCapitalize="none"
        />

        {loading ? (
          <ActivityIndicator color={Colors.muted} style={{ marginVertical: Spacing.lg }} />
        ) : (
          <FlatList
            data={[{ channelId: '__anywhere__', name: '', country: '' } as City, ...filtered]}
            keyExtractor={c => c.channelId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isAnywhere = item.channelId === '__anywhere__';
              const isSelected = isAnywhere
                ? selected === null
                : selected?.channelId === item.channelId;
              return (
                <TouchableOpacity
                  style={[styles.cityModalRow, isSelected && styles.cityModalRowSelected]}
                  onPress={() => {
                    if (isAnywhere) onSelect(null);
                    else onSelect({
                      channelId: item.channelId,
                      name:      localizeCityName(item.name) ?? item.name,
                      country:   item.country,
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cityModalRowText}>
                    {isAnywhere
                      ? `🌍  ${t('intl.cityPicker.anywhere')}`
                      : `${localizeCityName(item.name) ?? item.name} · ${item.country}`}
                  </Text>
                  {isSelected ? <Ionicons name="checkmark" size={18} color="#FF7A3C" /> : null}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Modal>
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
  inputMultiline: {
    minHeight:    80,
    textAlignVertical: 'top',
  },

  // ── International-mode UI bits ──────────────────────────────────────────
  sectionHint: {
    fontSize:  FontSizes.xs + 1,
    color:     Colors.muted2,
    marginTop: 2,
    lineHeight: 16,
  },
  cityPickerBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 4,
  },
  cityPickerText: { fontSize: FontSizes.md, color: Colors.text, flex: 1, marginRight: 8 },

  cityModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  cityModalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '85%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  cityModalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4,
  },
  cityModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  cityModalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  cityModalClose: { fontSize: 18, color: Colors.muted, fontWeight: '700' },
  cityModalSearch: {
    marginHorizontal:  Spacing.md,
    marginBottom:      Spacing.sm,
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    fontSize:          FontSizes.md,
    color:             Colors.text,
  },
  cityModalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  cityModalRowSelected: { backgroundColor: 'rgba(255,122,60,0.08)' },
  cityModalRowText: { fontSize: FontSizes.md, color: Colors.text, flex: 1, marginRight: 8 },

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

  // First-time public opt-in modal.
  optinOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent:  'center',
    paddingHorizontal: Spacing.lg,
  },
  optinPanel: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    padding:         Spacing.lg,
    gap:             Spacing.sm,
  },
  optinTitle: {
    fontSize:   FontSizes.lg,
    fontWeight: '800',
    color:      Colors.text,
  },
  optinBody: {
    fontSize:   FontSizes.sm,
    lineHeight: FontSizes.sm * 1.45,
    color:      Colors.muted,
  },
  optinGhostBtn: {
    marginTop:       Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    alignItems:      'center',
  },
  optinGhostText: {
    color:      Colors.muted2,
    fontWeight: '600',
    fontSize:   FontSizes.sm,
  },
});
