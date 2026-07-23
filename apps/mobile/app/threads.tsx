import { thumbUrl } from '@/lib/imageThumb';
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { fetchMyAcceptances, fetchRatePrompts } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { RateSheet } from '@/components/RateSheet';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { ChallengeThreadSummary, ChallengeType, RatePrompt } from '@/types';

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤪',
};

/**
 * My challenge threads (PR2). Every relationship I'm in - as creator OR
 * acceptor - appears as a row. Sorted by last message activity. Tap a row
 * to open the 1:1 thread chat.
 *
 * Reached from /me (settings) → "My challenge threads", or via deep link
 * from a push notification (planned).
 */
export default function ThreadsListScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account } = useApp();

  const [threads, setThreads] = useState<ChallengeThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Rate-prompts banner - driven by GET /me/rate-prompts. Sorted oldest-first
  // by the server; the banner shows index 0 (the oldest unrated meet-up) and
  // an "+N more" pill when there are extras. RateSheet pops the active prompt
  // on submit and the next one auto-surfaces.
  const [ratePrompts, setRatePrompts] = useState<RatePrompt[]>([]);
  const [activePrompt, setActivePrompt] = useState<RatePrompt | null>(null);

  const load = useCallback(async () => {
    if (!account?.id) { setThreads([]); setRatePrompts([]); setLoading(false); return; }
    try {
      // Fetch in parallel - both are cheap bounded reads.
      const [data, prompts] = await Promise.all([
        fetchMyAcceptances(),
        fetchRatePrompts(),
      ]);
      setThreads(data);
      setRatePrompts(prompts);
    } catch {
      setThreads([]);
      setRatePrompts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account?.id]);

  useEffect(() => { load(); }, [load]);

  // Refresh whenever the screen regains focus (new accepts pushed via WS
  // will also trigger via the listener below, but focus catches the case
  // where the user backs out of a thread).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live updates: new acceptance accepted somewhere, or an existing one
  // cancelled. Cheap reload (bounded by /me/acceptances LIMIT 100).
  useEffect(() => {
    const off1 = socket.on('challenge_accepted',              () => load());
    const off2 = socket.on('challenge_acceptance_cancelled',  () => load());
    return () => { off1(); off2(); };
  }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // Optimistic: drop the just-rated prompt from local state. A background
  // refetch happens via useFocusEffect when the user dismisses anyway.
  const handleRatingSubmitted = useCallback((challengeId: string) => {
    setRatePrompts(prev => prev.filter(p => p.challenge_id !== challengeId));
  }, []);

  if (!account?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title={t('threads.title')} onBack={() => router.back()} t={t} />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🔒</Text>
          <Text style={styles.emptyTitle}>{t('threads.guestGate.title')}</Text>
          <Text style={styles.emptyBody}>{t('threads.guestGate.body')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const topPrompt = ratePrompts[0] ?? null;
  const extraPromptCount = Math.max(0, ratePrompts.length - 1);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title={t('threads.title')} onBack={() => router.back()} t={t} />

      {loading && threads.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : threads.length === 0 && !topPrompt ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🤝</Text>
          <Text style={styles.emptyTitle}>{t('threads.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('threads.empty.body')}</Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={topPrompt ? (
            <RatePromptBanner
              prompt={topPrompt}
              extraCount={extraPromptCount}
              onPress={() => setActivePrompt(topPrompt)}
              t={t}
            />
          ) : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => {
            const icon    = TYPE_ICONS[item.challenge_type] ?? '🔥';
            const cp      = item.counterparty;
            const preview = item.last_message_content
              ? item.last_message_content.length > 80 ? `${item.last_message_content.slice(0, 80)}…` : item.last_message_content
              : t('threads.noMessagesYet');
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.75}
                onPress={() => router.push(`/challenge/${item.challenge_id}` as never)}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor(cp.id) }]}>
                  {cp.thumbAvatarUrl ? (
                    <Image
                      source={{ uri: thumbUrl(cp.thumbAvatarUrl) }}
                      style={StyleSheet.absoluteFill}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <Text style={styles.avatarLetter}>{(cp.displayName?.[0] ?? '?').toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.i_am_creator && <Text style={styles.crown}>👑 </Text>}
                      {cp.displayName}
                    </Text>
                  </View>
                  <Text style={styles.challengeTitle} numberOfLines={1}>{icon} {item.challenge_title}</Text>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted2} />
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      <RateSheet
        prompt={activePrompt}
        visible={activePrompt !== null}
        onClose={() => setActivePrompt(null)}
        onSubmitted={handleRatingSubmitted}
      />
    </SafeAreaView>
  );
}

function RatePromptBanner({
  prompt, extraCount, onPress, t,
}: {
  prompt: RatePrompt;
  extraCount: number;
  onPress: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const styles = useThemedStyles(makeStyles);
  const cp = prompt.counterparty;
  const titleKey = prompt.other_rated
    ? 'ratePrompts.banner.titleUrgent'
    : 'ratePrompts.banner.title';
  return (
    <TouchableOpacity style={styles.banner} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.bannerAvatar, { backgroundColor: avatarColor(cp.id) }]}>
        {cp.thumbAvatarUrl ? (
          <Image
            source={{ uri: thumbUrl(cp.thumbAvatarUrl) }}
            style={StyleSheet.absoluteFill}
            cachePolicy="memory-disk"
            contentFit="cover"
            transition={120}
          />
        ) : (
          <Text style={styles.bannerAvatarLetter}>{(cp.displayName?.[0] ?? '?').toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.bannerBody}>
        <Text style={styles.bannerTitle} numberOfLines={1}>
          <Text style={styles.bannerStar}>⭐ </Text>
          {t(titleKey, { name: cp.displayName })}
        </Text>
        <Text style={styles.bannerSubtitle} numberOfLines={1}>{prompt.challenge_title}</Text>
      </View>
      {extraCount > 0 && (
        <View style={styles.bannerExtraPill}>
          <Text style={styles.bannerExtraPillText}>+{extraCount}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
    </TouchableOpacity>
  );
}

function Header({ title, onBack, t }: { title: string; onBack: () => void; t: (k: string, opts?: { ns?: string }) => string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.nav}>
      <TouchableOpacity style={styles.backPill} onPress={onBack} activeOpacity={0.75}>
        <Ionicons name="chevron-back" size={18} color={colors.text} />
        <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
      </TouchableOpacity>
      <View style={styles.navCenter}>
        <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ width: 70 }} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: c.overlay,
    borderWidth: 1, borderColor: c.overlayStrong,
  },
  backPillText: { color: c.text, fontSize: FontSizes.sm, fontWeight: '700' },
  navCenter:    { flex: 1, alignItems: 'center' },
  navTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, letterSpacing: -0.3 },

  list: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 18 },
  body:    { flex: 1, gap: 2, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  name:    { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  crown:   { color: '#FF7A3C', fontWeight: '800' },
  challengeTitle: { fontSize: FontSizes.sm, color: c.muted },
  preview: { fontSize: FontSizes.sm, color: c.muted2 },
  sep:     { height: 1, backgroundColor: c.border, marginLeft: Spacing.md + 48 + Spacing.md },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: c.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },

  // Rate-prompt banner (above the threads list)
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,122,60,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,60,0.35)',
  },
  bannerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  bannerAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 16 },
  bannerBody: { flex: 1, minWidth: 0 },
  bannerStar: { color: '#FFC93C' },
  bannerTitle: { fontSize: FontSizes.sm + 1, fontWeight: '800', color: c.text },
  bannerSubtitle: { fontSize: FontSizes.sm, color: c.muted, marginTop: 1 },
  bannerExtraPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: '#FF7A3C',
  },
  bannerExtraPillText: { color: c.white, fontSize: FontSizes.xs, fontWeight: '800' },
});
