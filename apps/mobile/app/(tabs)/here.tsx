/**
 * Here screen — two sections:
 *   1. Here now    — people live in this city right now (from AppContext, realtime)
 *   2. City crew   — registered members whose home city is this city (paginated API)
 *
 * Filters: badge and/or vibe, combinable.
 * Pagination: city crew loads 10 at a time via "Load more".
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchCityMembers, fetchCityAmbassadors, type CityMember, type CityAmbassador } from '@/api/channels';
import type { OnlineUser } from '@/types';
import { canAccessProfile } from '@/lib/profileAccess';
import { BADGE_META } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const CONTEXT_BADGE_KEYS = new Set(['host']);

// ── Badge pill ────────────────────────────────────────────────────────────────
// Accepts a badge key string; derives label and colors from shared BADGE_META.

function BadgePill({ badgeKey }: { badgeKey: string }) {
  const meta = BADGE_META[badgeKey as keyof typeof BADGE_META] ?? BADGE_META.regular;
  return (
    <View style={[pillStyles.pill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
      <Text style={[pillStyles.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

// ── Vibe pill ─────────────────────────────────────────────────────────────────

const MODE_META: Record<string, { emoji: string; label: string }> = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
};

const VIBE_META: Record<string, { emoji: string; label: string; color: string; bg: string; border: string }> = {
  party:       { emoji: '🔥', label: 'Party',       color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.25)'  },
  board_games: { emoji: '🎲', label: 'Board Games', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.25)' },
  coffee:      { emoji: '☕', label: 'Coffee',      color: '#c4a882', bg: 'rgba(196,168,130,0.12)', border: 'rgba(196,168,130,0.25)' },
  music:       { emoji: '🎧', label: 'Music',       color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.25)'  },
  food:        { emoji: '🍜', label: 'Food',        color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.25)'  },
  chill:       { emoji: '🧘', label: 'Chill',       color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.25)'  },
};

function VibePill({ vibe }: { vibe?: string | null }) {
  if (!vibe) return null;
  const meta = VIBE_META[vibe];
  if (!meta) return null;
  return (
    <View style={[pillStyles.pill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
      <Text style={[pillStyles.text, { color: meta.color, opacity: 0.85 }]}>{meta.emoji} {meta.label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  text: { fontSize: 10, fontWeight: '700' },
});

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  '#C24A38', '#B87228', '#3ddc84', '#8B5CF6',
  '#0EA5E9', '#E879A0', '#F59E0B', '#14B8A6',
];
function avatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ── Filter config ─────────────────────────────────────────────────────────────

const MODE_FILTERS = Object.entries(MODE_META).map(([k, v]) => ({ key: k, label: `${v.emoji} ${v.label}` }));
const BADGE_FILTERS = [
  { key: 'fresh',   label: '✨ Fresh'  },
  { key: 'regular', label: '😎 Crew'   },
  { key: 'host',    label: '👑 Legend' },
];
const VIBE_FILTERS = Object.entries(VIBE_META).map(([k, v]) => ({ key: k, label: `${v.emoji} ${v.label}` }));

// ── Online user row ───────────────────────────────────────────────────────────

function OnlineUserRow({ user, isMe, onPress, onDm }: {
  user: OnlineUser; isMe: boolean; onPress?: () => void; onDm: () => void;
}) {
  const initials = (user.nickname ?? '?').slice(0, 2).toUpperCase();
  const color    = avatarColor(user.nickname ?? '');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={styles.avatarWrap}>
        {user.profilePhotoUrl ? (
          <Image source={{ uri: user.profilePhotoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
            <Text style={[styles.avatarText, { color }]}>{initials}</Text>
          </View>
        )}
        <View style={styles.liveDot} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.nickname}>
          {user.nickname}{isMe ? <Text style={styles.youLabel}> (you)</Text> : ''}
        </Text>
        <View style={styles.badgeRow}>
          {user.mode && MODE_META[user.mode] && (
            <Text style={[{ fontSize: 14 }, user.mode === 'local' ? styles.modeEmojiLocal : styles.modeEmojiExploring]}>
              {MODE_META[user.mode].emoji}
            </Text>
          )}
          {user.primaryBadge
            ? <BadgePill badgeKey={user.primaryBadge.key} />
            : <BadgePill badgeKey={user.isRegistered ? 'regular' : 'ghost'} />
          }
          {user.contextBadge && <BadgePill badgeKey={user.contextBadge.key} />}
          <VibePill vibe={user.vibe} />
        </View>
      </View>
      {!isMe && user.userId && (
        <TouchableOpacity style={styles.dmBtn} onPress={onDm} activeOpacity={0.7}>
          <Feather name="message-square" size={22} color={Colors.text} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── City crew row ─────────────────────────────────────────────────────────────

function CrewMemberRow({ member, onPress }: { member: CityMember; onPress: () => void }) {
  const initials = (member.displayName ?? '?').slice(0, 2).toUpperCase();
  const color    = avatarColor(member.displayName ?? '');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {member.avatarUrl ? (
        <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '50' }]}>
          <Text style={[styles.avatarText, { color }]}>{initials}</Text>
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.nickname}>{member.displayName}</Text>
        <View style={styles.badgeRow}>
          {member.mode && MODE_META[member.mode] && (
            <Text style={[{ fontSize: 14 }, member.mode === 'local' ? styles.modeEmojiLocal : styles.modeEmojiExploring]}>
              {MODE_META[member.mode].emoji}
            </Text>
          )}
          {member.badges.map(k => <BadgePill key={k} badgeKey={k} />)}
          <VibePill vibe={member.vibe} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HereScreen() {
  const router = useRouter();
  const { city, sessionId, account, onlineUsers } = useApp();

  const [filterBadge, setFilterBadge] = useState<string | null>(null);
  const [filterVibe,  setFilterVibe]  = useState<string | null>(null);
  const [filterMode,  setFilterMode]  = useState<string | null>(null);

  const [legends,      setLegends]      = useState<CityAmbassador[]>([]);

  const [crewMembers,  setCrewMembers]  = useState<CityMember[]>([]);
  const [crewPage,     setCrewPage]     = useState(1);
  const [crewHasMore,  setCrewHasMore]  = useState(false);
  const [crewLoading,  setCrewLoading]  = useState(false);

  const mySessionId = sessionId ?? '';

  // Build a userId → crew member lookup for badge enrichment
  const crewLookup = useMemo(() => {
    const map = new Map<string, CityMember>();
    crewMembers.forEach(m => map.set(m.id, m));
    return map;
  }, [crewMembers]);

  // Fetch city crew — reset and reload when filters or city changes
  const loadCrew = useCallback(async (page: number, reset: boolean) => {
    if (!city?.channelId) return;
    setCrewLoading(true);
    try {
      const data = await fetchCityMembers(city.channelId, {
        page,
        limit: 10,
        badge: filterBadge ?? undefined,
        vibe:  filterVibe  ?? undefined,
        mode:  filterMode  ?? undefined,
      });
      setCrewMembers(prev => reset ? data.members : [...prev, ...data.members]);
      setCrewHasMore(data.hasMore);
      setCrewPage(page);
    } catch { /* silent */ }
    finally  { setCrewLoading(false); }
  }, [city?.channelId, filterBadge, filterVibe, filterMode]);

  useEffect(() => {
    loadCrew(1, true);
  }, [loadCrew]);

  // Fetch local legends (ambassadors) when city changes
  useEffect(() => {
    if (!city?.channelId) return;
    fetchCityAmbassadors(city.channelId).then(setLegends).catch(() => {});
  }, [city?.channelId]);

  // Enrich HERE NOW users with badge/vibe/avatar from crew data (WS presence has no badges).
  // Self entry is enriched the same way; photo falls back to account data if not in crew list.
  const enrichedOnline = useMemo(() => onlineUsers.map(u => {
    if (!u.userId) return u; // guest: no enrichment possible
    const isSelf = u.sessionId === mySessionId;
    const crew   = crewLookup.get(u.userId);
    if (!crew && !isSelf) return u;
    const primaryKey = crew?.badges.find(k => !CONTEXT_BADGE_KEYS.has(k));
    const contextKey = crew?.badges.find(k => CONTEXT_BADGE_KEYS.has(k));
    return {
      ...u,
      primaryBadge:    primaryKey ? { key: primaryKey, label: BADGE_META[primaryKey as keyof typeof BADGE_META]?.label ?? primaryKey } : u.primaryBadge,
      contextBadge:    contextKey ? { key: contextKey, label: BADGE_META[contextKey as keyof typeof BADGE_META]?.label ?? contextKey } : u.contextBadge,
      vibe:            crew?.vibe ?? u.vibe,
      mode:            crew?.mode ?? u.mode,
      profilePhotoUrl: crew?.avatarUrl ?? (isSelf ? (account?.profile_photo_url ?? undefined) : undefined) ?? u.profilePhotoUrl,
    };
  }), [onlineUsers, crewLookup, mySessionId, account]);

  // Apply badge + vibe filters to live users (client-side — small list)
  const filteredOnline = enrichedOnline.filter(u => {
    if (filterBadge) {
      const isMe = u.sessionId === mySessionId;
      if (!isMe) {
        if (filterBadge === 'host') return u.contextBadge?.key === 'host';
        if (u.primaryBadge?.key !== filterBadge) return false;
      }
    }
    if (filterVibe && u.sessionId !== mySessionId && u.vibe !== filterVibe) return false;
    if (filterMode && u.sessionId !== mySessionId && u.mode !== filterMode) return false;
    return true;
  });

  const others = filteredOnline.filter(u => u.sessionId !== mySessionId);
  const me     = filteredOnline.find(u => u.sessionId === mySessionId);
  const liveList = me ? [...others, me] : others;

  if (!city) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>People here</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySub}>Pick a city to see who's around.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/switch-city' as never)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Browse cities</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>People here</Text>
          <Text style={styles.headerSub}>{city.name}</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <Text style={styles.filterGroupLabel}>Badge</Text>
          {BADGE_FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, filterBadge === f.key && styles.chipOn]}
              onPress={() => setFilterBadge(v => v === f.key ? null : f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, filterBadge === f.key && styles.chipTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.filterDivider} />
          <Text style={styles.filterGroupLabel}>Vibe</Text>
          {VIBE_FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, filterVibe === f.key && styles.chipOn]}
              onPress={() => setFilterVibe(v => v === f.key ? null : f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, filterVibe === f.key && styles.chipTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.filterDivider} />
          <Text style={styles.filterGroupLabel}>Mode</Text>
          {MODE_FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, filterMode === f.key && (f.key === 'local' ? styles.chipOnLocal : styles.chipOnExploring)]}
              onPress={() => setFilterMode(v => v === f.key ? null : f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, filterMode === f.key && (f.key === 'local' ? styles.chipTextOnLocal : styles.chipTextOnExploring)]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Section 1: Here now ── */}
        <View style={styles.sectionHeader}>
          <View style={styles.liveDotSection} />
          <Text style={styles.sectionTitle}>Here now · {liveList.length}</Text>
        </View>

        {liveList.length === 0 ? (
          <Text style={styles.sectionEmpty}>Nobody matches these filters right now.</Text>
        ) : liveList.map((item) => {
          const isMe = item.sessionId === mySessionId;
          return (
            <OnlineUserRow
              key={item.sessionId}
              user={item}
              isMe={isMe}
              onPress={!isMe && item.userId ? () => {
                if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                router.push({ pathname: '/user/[id]', params: { id: item.userId! } });
              } : undefined}
              onDm={() => {
                if (!canAccessProfile(account)) { router.push('/auth-gate?reason=send_dm'); return; }
                if (item.userId) router.push({ pathname: '/dm/[id]', params: { id: item.userId, name: item.nickname } });
              }}
            />
          );
        })}

        {/* ── Section 2: Local legends ── */}
        {legends.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: Spacing.xl, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }]}>
              <Text style={[styles.sectionTitle, { textTransform: 'none', letterSpacing: 0, fontSize: FontSizes.sm, color: Colors.text }]}>
                👑 Hilads Legends
              </Text>
              <Text style={{ fontSize: FontSizes.xs, color: Colors.muted }}>They make the city happen</Text>
            </View>
            {legends.map(m => {
              const initials = (m.displayName ?? '?').slice(0, 2).toUpperCase();
              const color    = avatarColor(m.displayName ?? '');
              const firstPick = m.ambassadorPicks?.tip ?? m.ambassadorPicks?.restaurant ?? m.ambassadorPicks?.spot ?? m.ambassadorPicks?.story;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.row, styles.legendRow]}
                  onPress={() => {
                    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                    router.push({ pathname: '/user/[id]', params: { id: m.id, name: m.displayName } });
                  }}
                  activeOpacity={0.7}
                >
                  {m.avatarUrl ? (
                    <Image source={{ uri: m.avatarUrl }} style={[styles.avatar, styles.legendAvatar]} />
                  ) : (
                    <View style={[styles.avatar, styles.legendAvatar, { backgroundColor: color + '28', borderColor: 'rgba(255,193,7,0.35)' }]}>
                      <Text style={[styles.avatarText, { color }]}>{initials}</Text>
                    </View>
                  )}
                  <View style={styles.rowInfo}>
                    <Text style={styles.nickname}>{m.displayName}</Text>
                    <View style={styles.badgeRow}>
                      {m.badges.map(k => <BadgePill key={k} badgeKey={k} />)}
                      <VibePill vibe={m.vibe} />
                    </View>
                    {firstPick ? (
                      <Text style={styles.legendPickPreview} numberOfLines={1}>💡 {firstPick}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── Section 3: City crew ── */}
        <View style={[styles.sectionHeader, { marginTop: Spacing.xl }]}>
          <Text style={styles.sectionTitle}>🏙️ City crew</Text>
        </View>

        {crewLoading && crewMembers.length === 0 ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} />
        ) : crewMembers.length === 0 ? (
          <Text style={styles.sectionEmpty}>No members match these filters.</Text>
        ) : crewMembers.map(m => (
          <CrewMemberRow
            key={m.id}
            member={m}
            onPress={() => {
              if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
              router.push({ pathname: '/user/[id]', params: { id: m.id, name: m.displayName } });
            }}
          />
        ))}

        {crewHasMore && (
          <TouchableOpacity
            style={styles.loadMoreBtn}
            onPress={() => loadCrew(crewPage + 1, false)}
            disabled={crewLoading}
            activeOpacity={0.7}
          >
            {crewLoading
              ? <ActivityIndicator color={Colors.muted} size="small" />
              : <Text style={styles.loadMoreText}>Load more</Text>
            }
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 56,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:    { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2, textAlign: 'center' },

  // ── Filters ───────────────────────────────────────────────────────────────
  filtersWrap: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.bg2,
  },
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 6,
  },
  filterGroupLabel: {
    fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, color: Colors.muted, marginRight: 2,
  },
  filterDivider: {
    width: 1, height: 16, backgroundColor: Colors.border, marginHorizontal: 4,
  },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  chipOn: {
    borderColor: Colors.accent,
    backgroundColor: 'rgba(194,74,56,0.12)',
  },
  chipOnLocal:     { borderColor: '#FF7A3C', backgroundColor: 'rgba(255,122,60,0.12)' },
  chipOnExploring: { borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)' },
  chipText:           { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted },
  chipTextOn:         { color: Colors.accent },
  chipTextOnLocal:     { color: '#FF7A3C' },
  chipTextOnExploring: { color: '#60a5fa' },

  // ── Scroll content ────────────────────────────────────────────────────────
  scrollContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 },

  // ── Section headers ───────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8,
  },
  liveDotSection: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: Colors.green,
    shadowColor: Colors.green, shadowOpacity: 0.8, shadowRadius: 4, elevation: 3,
  },
  sectionTitle: {
    fontSize: FontSizes.xs, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, color: Colors.muted,
  },
  sectionEmpty: {
    fontSize: FontSizes.sm, color: Colors.muted,
    paddingVertical: 8, paddingLeft: 2,
  },

  // ── User row ──────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bg2, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  avatarWrap: {
    width: 44, height: 44, position: 'relative',
  },
  avatar: {
    width: 44, height: 44, borderRadius: Radius.full,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', fontSize: FontSizes.sm },
  liveDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.green, borderWidth: 2, borderColor: Colors.bg2,
  },
  rowInfo: { flex: 1, gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  nickname:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  youLabel:  { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '400' },

  dmBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  // ── Legend row ────────────────────────────────────────────────────────────
  legendRow: {
    borderColor: 'rgba(255,193,7,0.18)',
    backgroundColor: 'rgba(255,193,7,0.04)',
  },
  legendAvatar: {
    borderColor: 'rgba(255,193,7,0.35)',
  },
  legendPickPreview: {
    fontSize: FontSizes.xs,
    color: Colors.muted,
    marginTop: 2,
  },

  // ── Load more ─────────────────────────────────────────────────────────────
  loadMoreBtn: {
    marginTop: 4, paddingVertical: 12,
    backgroundColor: Colors.bg2, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  loadMoreText: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '600' },

  // ── Empty (no city) ───────────────────────────────────────────────────────
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.accent, borderRadius: Radius.full,
  },
  emptyBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },

  // ── Mode emoji colors ─────────────────────────────────────────────────────
  modeEmojiLocal:     { color: '#FF7A3C', opacity: 0.85 },
  modeEmojiExploring: { color: '#60a5fa', opacity: 0.85 },
});
