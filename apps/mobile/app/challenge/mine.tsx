import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchUserChallenges, type ProfileChallenge } from '@/api/challenges';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ChallengeType } from '@/types';

/**
 * "My challenges" - every challenge I'm in as CREATOR or TAKER, in one list.
 * Backed by GET /users/{id}/challenges (created OR accepted; each row carries
 * is_owner). Reached from the prominent CTA on the Challenges tab. Tap a row
 * to open its channel.
 */

const TYPE_ICONS: Record<ChallengeType, string> = {
  food: '🍜', place: '📍', culture: '🎭', help: '🤪',
};

type Filter = 'all' | 'created' | 'taken';

export default function MyChallengesScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account } = useApp();

  const [items,      setItems]      = useState<ProfileChallenge[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!account?.id) { setItems([]); setLoading(false); return; }
    try {
      setItems(await fetchUserChallenges(account.id));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account?.id]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const filtered = useMemo(() => {
    if (filter === 'created') return items.filter(c => c.is_owner);
    if (filter === 'taken')   return items.filter(c => !c.is_owner);
    return items;
  }, [items, filter]);

  if (!account?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title={t('myChallenges.title')} onBack={() => router.back()} t={t} />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🔒</Text>
          <Text style={styles.emptyTitle}>{t('myChallenges.guestGate.title')}</Text>
          <Text style={styles.emptyBody}>{t('myChallenges.guestGate.body')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title={t('myChallenges.title')} onBack={() => router.back()} t={t} />

      {/* Filter pills: All / Created / Taken */}
      <View style={styles.filterRow}>
        {(['all', 'created', 'taken'] as Filter[]).map(f => {
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.filterPill, active && styles.filterPillActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {t(`myChallenges.filter.${f}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🔥</Text>
          <Text style={styles.emptyTitle}>{t('myChallenges.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('myChallenges.empty.body')}</Text>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push('/challenge/create' as never)}
            activeOpacity={0.85}
          >
            <Text style={styles.createBtnText}>🔥 {t('myChallenges.create')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.75}
              onPress={() => router.push(`/challenge/${item.id}` as never)}
            >
              <Text style={styles.rowIcon}>{TYPE_ICONS[item.challenge_type] ?? '🔥'}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.rowTags}>
                  <View style={[styles.tag, item.is_owner ? styles.tagCreator : styles.tagTaker]}>
                    <Text style={[styles.tagText, item.is_owner ? styles.tagTextCreator : styles.tagTextTaker]}>
                      {item.is_owner ? `👑 ${t('host')}` : `⚡ ${t('taker')}`}
                    </Text>
                  </View>
                  {(item.mode ?? 'local') === 'international' && (
                    <View style={[styles.tag, styles.tagIntl]}><Text style={[styles.tagText, styles.tagTextIntl]}>🌐</Text></View>
                  )}
                  {item.status === 'validated' && (
                    <View style={[styles.tag, styles.tagDone]}><Text style={[styles.tagText, styles.tagTextDone]}>✓</Text></View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.muted2} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Header({ title, onBack, t }: { title: string; onBack: () => void; t: (k: string, opts?: { ns?: string }) => string }) {
  return (
    <View style={styles.nav}>
      <TouchableOpacity style={styles.backPill} onPress={onBack} activeOpacity={0.75}>
        <Ionicons name="chevron-back" size={18} color={Colors.text} />
        <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
      </TouchableOpacity>
      <View style={styles.navCenter}>
        <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ width: 70 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backPill: {
    flexDirection: 'row',
    alignItems:    'center',
    width:         70,
  },
  backPillText: { fontSize: FontSizes.sm, color: Colors.text, fontWeight: '600' },
  navCenter:    { flex: 1, alignItems: 'center' },
  navTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  filterRow: {
    flexDirection:     'row',
    gap:               8,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical:   7,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  filterPillActive: {
    backgroundColor: 'rgba(255,122,60,0.12)',
    borderColor:     'rgba(255,122,60,0.5)',
  },
  filterText:       { fontSize: 13, fontWeight: '700', color: Colors.muted },
  filterTextActive: { color: '#FF7A3C' },

  list: { paddingVertical: Spacing.xs },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
  },
  rowIcon:  { fontSize: 24, width: 30, textAlign: 'center' },
  rowBody:  { flex: 1, gap: 5 },
  rowTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  rowTags:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.full,
    borderWidth:       1,
  },
  tagText:        { fontSize: 11, fontWeight: '700' },
  tagCreator:     { backgroundColor: 'rgba(255,122,60,0.10)', borderColor: 'rgba(255,122,60,0.30)' },
  tagTextCreator: { color: '#FF7A3C' },
  tagTaker:       { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' },
  tagTextTaker:   { color: Colors.muted },
  tagIntl:        { backgroundColor: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.30)' },
  tagTextIntl:    { color: '#38bdf8' },
  tagDone:        { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.20)' },
  tagTextDone:    { color: '#4ade80' },

  sep: { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 30 + Spacing.md },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
  createBtn: {
    marginTop:         8,
    paddingHorizontal: 20,
    paddingVertical:   12,
    borderRadius:      Radius.full,
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.5)',
  },
  createBtnText: { fontSize: FontSizes.md, fontWeight: '800', color: '#FF7A3C' },
});
