/**
 * Public profile screen — /user/[id]
 *
 * Layout:
 *   1. Sticky identity header (always visible): avatar, name, badge, city,
 *      vibe card, mode card, from/age rows
 *   2. Tab bar: Events | Friends | Vibes | City Picks (legend only)
 *   3. Scrollable tab content
 *   4. Sticky action bar at bottom
 */

import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, TextInput, Alert, Modal, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, addFriend, removeFriend, fetchUserVibes, postVibe, type UserVibe } from '@/api/users';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { HiladsEvent, PublicProfile, UserDTO } from '@/types';
import { BADGE_META } from '@/types';
import { ReportModal } from '@/features/profile/ReportModal';

// ── Badge microcopy ────────────────────────────────────────────────────────────

const BADGE_MICROCOPY: Record<string, string> = {
  ghost:   'Just browsing 👀',
  fresh:   'Just landed 👶',
  regular: 'Shows up often',
  local:   'Knows the city',
  host:    'Makes it happen 🔥',
};

// ── City flag ─────────────────────────────────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const PROFILE_BADGE_BG: Record<string, object> = {
  ghost:   { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh:   { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local:   { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:    { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const PROFILE_BADGE_COLOR: Record<string, object> = {
  ghost:   { color: '#666' },
  fresh:   { color: '#4ade80' },
  regular: { color: '#60a5fa' },
  local:   { color: '#34d399' },
  host:    { color: '#fbbf24' },
};
function profileBadgeBg(key: string): object   { return PROFILE_BADGE_BG[key]    ?? PROFILE_BADGE_BG.regular;    }
function profileBadgeColor(key: string): object { return PROFILE_BADGE_COLOR[key] ?? PROFILE_BADGE_COLOR.regular; }

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Mode meta ─────────────────────────────────────────────────────────────────

const MODE_META: Record<string, { emoji: string; label: string }> = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
};

// ── Vibe meta ─────────────────────────────────────────────────────────────────

const VIBE_META: Record<string, { emoji: string; label: string; caption: string }> = {
  party:       { emoji: '🔥', label: 'Party',       caption: 'Always down to party 🎉'        },
  board_games: { emoji: '🎲', label: 'Board Games', caption: 'Game night, every night'        },
  coffee:      { emoji: '☕', label: 'Coffee',       caption: 'Best conversations over coffee' },
  music:       { emoji: '🎧', label: 'Music',        caption: 'Life is a playlist 🎶'          },
  food:        { emoji: '🍜', label: 'Food',         caption: 'Eats first, questions later'    },
  chill:       { emoji: '🧘', label: 'Chill',        caption: 'Easy vibes only 😌'             },
};

// ── Event helpers ─────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatEventTime(ts: number): string {
  const d        = new Date(ts * 1000);
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString())    return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

function EventPill({ event, onPress }: { event: HiladsEvent; onPress: () => void }) {
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  return (
    <TouchableOpacity style={styles.eventPill} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.eventMeta}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          )}
          <Text style={styles.eventTime}>{formatEventTime(event.starts_at)}</Text>
          {event.location ? (
            <Text style={styles.eventLocation} numberOfLines={1}>· {event.location}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type TabKey = 'events' | 'friends' | 'vibes' | 'picks';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const { account, identity, city } = useApp();

  const [user,         setUser]         = useState<PublicProfile | null>(null);
  const [events,       setEvents]       = useState<HiladsEvent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [isFriend,     setIsFriend]     = useState(false);
  const [friendBusy,   setFriendBusy]   = useState(false);
  const [friends,      setFriends]      = useState<UserDTO[]>([]);
  const [vibes,        setVibes]        = useState<UserVibe[]>([]);
  const [vibeScore,    setVibeScore]    = useState<number | null>(null);
  const [vibeCount,    setVibeCount]    = useState(0);
  const [myVibe,       setMyVibe]       = useState<{ rating: number; message?: string } | null>(null);
  const [vibeBusy,     setVibeBusy]     = useState(false);
  const [vibeRating,   setVibeRating]   = useState(0);
  const [vibeMessage,  setVibeMessage]  = useState('');
  const [showVibeForm,       setShowVibeForm]       = useState(false);
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);
  const [showReportModal,    setShowReportModal]    = useState(false);
  const [activeTab,    setActiveTab]    = useState<TabKey>('events');

  useEffect(() => {
    if (!canAccessProfile(account)) {
      router.replace('/auth-gate');
    }
  }, [account]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    Promise.all([fetchPublicProfile(id), fetchUserEvents(id)])
      .then(([u, evs]) => {
        setUser(u);
        setEvents(evs);
        setIsFriend(u.isFriend ?? false);
        if (u.vibeScore != null) setVibeScore(u.vibeScore);
        if (u.vibeCount != null) setVibeCount(u.vibeCount);
      })
      .catch(() => setError('Could not load profile.'))
      .finally(() => setLoading(false));

    fetchUserFriends(id).then(fr => setFriends(fr.friends)).catch(() => {});
    fetchUserVibes(id)
      .then(vib => {
        setVibes(vib.vibes);
        setVibeScore(vib.score);
        setVibeCount(vib.count);
        setMyVibe(vib.myVibe);
        if (vib.myVibe) { setVibeRating(vib.myVibe.rating); setVibeMessage(vib.myVibe.message ?? ''); }
      })
      .catch(() => {});
  }, [id]);

  function handleFriendToggle() {
    if (!user || friendBusy) return;
    if (isFriend) {
      Alert.alert(
        'Unfriend',
        `Remove ${user.displayName} from your friends?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unfriend', style: 'destructive',
            onPress: async () => {
              setFriendBusy(true);
              try { await removeFriend(user.id); setIsFriend(false); } catch { /* ignore */ }
              finally { setFriendBusy(false); }
            },
          },
        ],
      );
    } else {
      (async () => {
        setFriendBusy(true);
        try { await addFriend(user.id); setIsFriend(true); } catch { /* ignore */ }
        finally { setFriendBusy(false); }
      })();
    }
  }

  async function handleSubmitVibe() {
    if (!id || vibeBusy || vibeRating === 0) return;
    setVibeBusy(true);
    try {
      await postVibe(id, { rating: vibeRating, message: vibeMessage.trim() || undefined });
      const fresh = await fetchUserVibes(id);
      setVibes(fresh.vibes);
      setVibeScore(fresh.score);
      setVibeCount(fresh.count);
      setMyVibe(fresh.myVibe);
      setShowVibeForm(false);
    } catch { /* ignore */ }
    finally { setVibeBusy(false); }
  }

  function handleDm() {
    if (!user?.id) return;
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=send_dm'); return; }
    router.push({ pathname: '/dm/[id]', params: { id: user.id, name: user.displayName } });
  }

  function handleEventPress(eventId: string) {
    router.push({ pathname: '/event/[id]', params: { id: eventId } });
  }

  const name   = user?.displayName ?? '?';
  const initial = name[0].toUpperCase();
  const bg     = avatarBg(name);
  const isSelf = account?.id === id;

  // Legend = user has ambassador picks
  const hasPicks = !!(
    user?.ambassadorPicks &&
    Object.values(user.ambassadorPicks).some(v => v)
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'events',  label: events.length  > 0 ? `Events · ${events.length}`   : 'Events'  },
    { key: 'friends', label: friends.length > 0 ? `Friends · ${friends.length}` : 'Friends' },
    { key: 'vibes',   label: vibeCount      > 0 ? `Vibes · ${vibeCount}`        : 'Vibes'   },
    ...(hasPicks ? [{ key: 'picks' as TabKey, label: 'City Picks 👑' }] : []),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : user ? (
        <>
          {/* ── 1. Sticky identity section ── */}
          <View style={styles.identitySection}>

            {/* Hero: avatar + name + badges + city */}
            <View style={styles.hero}>
              {user.avatarUrl ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowAvatarLightbox(true)}>
                  <Image source={{ uri: user.thumbAvatarUrl ?? user.avatarUrl }} style={styles.avatar} resizeMode="cover" />
                </TouchableOpacity>
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bg }]}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
              <Text style={styles.displayName}>{name}</Text>
              {user.badges.map(badgeKey => {
                const meta = BADGE_META[badgeKey as keyof typeof BADGE_META];
                if (!meta) return null;
                return (
                  <View key={badgeKey} style={styles.badgeBlock}>
                    <View style={[styles.memberBadge, profileBadgeBg(badgeKey)]}>
                      <Text style={[styles.memberBadgeText, profileBadgeColor(badgeKey)]}>{meta.label}</Text>
                    </View>
                    {BADGE_MICROCOPY[badgeKey] ? (
                      <Text style={styles.badgeMicrocopy}>{BADGE_MICROCOPY[badgeKey]}</Text>
                    ) : null}
                  </View>
                );
              })}
              {city ? (
                <View style={styles.cityPill}>
                  <Text style={styles.cityPillText}>
                    {cityFlag(city.country)}{cityFlag(city.country) ? ' ' : ''}{city.name}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* About me */}
            {user.aboutMe ? (
              <Text style={styles.aboutMe}>{user.aboutMe}</Text>
            ) : null}

            {/* Identity cards: vibe + mode — side by side */}
            {(user.vibe && VIBE_META[user.vibe] || user.mode && MODE_META[user.mode]) ? (
              <View style={styles.identityCards}>
                {user.vibe && VIBE_META[user.vibe] ? (
                  <View style={styles.identityCard}>
                    <Text style={styles.identityCardEmoji}>{VIBE_META[user.vibe].emoji}</Text>
                    <Text style={styles.identityCardTitle}>{VIBE_META[user.vibe].label}</Text>
                    <Text style={styles.identityCardSub}>{VIBE_META[user.vibe].caption}</Text>
                  </View>
                ) : null}
                {user.mode && MODE_META[user.mode] ? (
                  <View style={styles.identityCard}>
                    <Text style={styles.identityCardEmoji}>{MODE_META[user.mode].emoji}</Text>
                    <Text style={styles.identityCardTitle}>{MODE_META[user.mode].label}</Text>
                    <Text style={styles.identityCardSub}>
                      {user.mode === 'local'
                        ? `Local in ${user.homeCity ?? city?.name ?? 'this city'}`
                        : `Exploring ${city?.name ?? 'this city'}`}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Info rows: From + Age */}
            {(user.homeCity || user.age != null) ? (
              <View style={styles.detailsCard}>
                {user.homeCity ? (
                  <View style={[styles.detailRow, styles.detailRowFirst]}>
                    <Text style={styles.detailLabel}>From</Text>
                    <Text style={styles.detailValue}>{user.homeCity}</Text>
                  </View>
                ) : null}
                {user.age != null ? (
                  <View style={[styles.detailRow, !user.homeCity && styles.detailRowFirst]}>
                    <Text style={styles.detailLabel}>Age</Text>
                    <Text style={styles.detailValue}>{user.age}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* ── 2. Tab bar ── */}
          <View style={styles.tabBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabBar}
            >
              {tabs.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabPill, activeTab === t.key && styles.tabPillActive]}
                  onPress={() => setActiveTab(t.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tabPillText, activeTab === t.key && styles.tabPillTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── 3. Tab content ── */}
          <ScrollView
            style={styles.tabContent}
            contentContainerStyle={[styles.tabContentBody, { paddingBottom: Math.max(100, insets.bottom + 80) }]}
            showsVerticalScrollIndicator={false}
          >

            {/* Events tab */}
            {activeTab === 'events' && (
              events.length === 0 ? (
                <Text style={styles.tabEmpty}>No events yet</Text>
              ) : (
                <View style={styles.eventList}>
                  {events.map(event => (
                    <EventPill
                      key={event.id}
                      event={event}
                      onPress={() => handleEventPress(event.id)}
                    />
                  ))}
                </View>
              )
            )}

            {/* Friends tab */}
            {activeTab === 'friends' && (
              friends.length === 0 ? (
                <Text style={styles.tabEmpty}>No friends yet</Text>
              ) : (
                <View style={styles.friendList}>
                  {friends.map(f => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.friendRow}
                      onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id } })}
                      activeOpacity={0.7}
                    >
                      {f.avatarUrl ? (
                        <Image source={{ uri: f.avatarUrl }} style={styles.friendAvatar} resizeMode="cover" />
                      ) : (
                        <View style={[styles.friendAvatar, styles.friendAvatarFallback, { backgroundColor: avatarBg(f.displayName) }]}>
                          <Text style={styles.friendAvatarInitial}>{f.displayName[0]?.toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName} numberOfLines={1}>{f.displayName}</Text>
                        {f.badges[0] && (
                          <Text style={styles.friendBadge}>{BADGE_META[f.badges[0] as keyof typeof BADGE_META]?.label ?? f.badges[0]}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}

            {/* Vibes tab */}
            {activeTab === 'vibes' && (
              <>
                {vibeCount > 0 && (
                  <View style={styles.vibeScoreCard}>
                    <View style={styles.vibeStarsRow}>
                      {[1,2,3,4,5].map(s => (
                        <Text key={s} style={[styles.vibeStarStatic, s <= Math.round(vibeScore ?? 0) && styles.vibeStarStaticOn]}>★</Text>
                      ))}
                    </View>
                    <Text style={styles.vibeScoreAvg}>{vibeScore?.toFixed(1)} vibe score</Text>
                    <Text style={styles.vibeScoreCount}>based on {vibeCount} vibe{vibeCount !== 1 ? 's' : ''}</Text>
                  </View>
                )}

                {!isSelf && account && (
                  !showVibeForm ? (
                    <TouchableOpacity style={styles.vibeCtaBtn} onPress={() => setShowVibeForm(true)} activeOpacity={0.8}>
                      <Text style={styles.vibeCtaBtnText}>
                        {myVibe ? `✏️ Update your note (${myVibe.rating}★)` : '⭐ Leave a note'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.vibeForm}>
                      <View style={styles.vibeFormStars}>
                        {[1,2,3,4,5].map(s => (
                          <TouchableOpacity key={s} onPress={() => setVibeRating(s)} activeOpacity={0.7}>
                            <Text style={[styles.vibeFormStar, vibeRating >= s && styles.vibeFormStarOn]}>★</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={styles.vibeInput}
                        placeholder="Say something nice… (optional)"
                        placeholderTextColor={Colors.muted2}
                        value={vibeMessage}
                        onChangeText={setVibeMessage}
                        maxLength={300}
                        multiline
                        numberOfLines={2}
                      />
                      <View style={styles.vibeFormActions}>
                        <TouchableOpacity
                          style={styles.vibeCancelBtn}
                          onPress={() => { setShowVibeForm(false); setVibeRating(myVibe?.rating ?? 0); setVibeMessage(myVibe?.message ?? ''); }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.vibeCancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.vibeSubmitBtn, (vibeBusy || vibeRating === 0) && styles.vibeSubmitBtnDisabled]}
                          onPress={handleSubmitVibe}
                          activeOpacity={0.8}
                          disabled={vibeBusy || vibeRating === 0}
                        >
                          <Text style={styles.vibeSubmitBtnText}>{vibeBusy ? 'Sending…' : 'Send note ✨'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                )}

                {vibes.length > 0 ? (
                  <View style={styles.vibeList}>
                    {vibes.map(v => (
                      <View key={v.id} style={styles.vibeRow}>
                        {v.authorPhoto ? (
                          <Image source={{ uri: v.authorPhoto }} style={styles.vibeAvatar} resizeMode="cover" />
                        ) : (
                          <View style={[styles.vibeAvatar, styles.vibeAvatarFallback, { backgroundColor: avatarBg(v.authorName) }]}>
                            <Text style={styles.vibeAvatarInitial}>{(v.authorName || '?')[0].toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={styles.vibeContent}>
                          <View style={styles.vibeHeader}>
                            <Text style={styles.vibeAuthor}>{v.authorName}</Text>
                            <Text style={styles.vibeRating}>{'★'.repeat(v.rating)}</Text>
                          </View>
                          {v.message ? <Text style={styles.vibeMsg}>{v.message}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.vibeEmpty}>
                    <Text style={styles.vibeEmptyTitle}>No notes yet</Text>
                    <Text style={styles.vibeEmptySubtitle}>Be the first to leave a note ✨</Text>
                  </View>
                )}
              </>
            )}

            {/* City Picks tab — legend only */}
            {activeTab === 'picks' && hasPicks && (
              <View style={styles.picksGrid}>
                {[
                  { key: 'restaurant', label: 'FAVORITE RESTAURANT', val: user.ambassadorPicks?.restaurant },
                  { key: 'spot',       label: 'HIDDEN GEM',          val: user.ambassadorPicks?.spot       },
                  { key: 'tip',        label: 'LOCAL TIP',            val: user.ambassadorPicks?.tip        },
                  { key: 'story',      label: 'STORY',                val: user.ambassadorPicks?.story      },
                ].filter(p => p.val).map(p => (
                  <View key={p.key} style={styles.pickCard}>
                    <Text style={styles.pickCardTitle}>{p.label}</Text>
                    <Text style={styles.pickCardContent}>{p.val}</Text>
                  </View>
                ))}
              </View>
            )}

          </ScrollView>
        </>
      ) : null}

      {/* ── 4. Sticky action bar ── */}
      {user && !isSelf && account && (
        <View style={[styles.stickyBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity style={styles.dmBtn} onPress={handleDm} activeOpacity={0.85}>
            <Feather name="message-square" size={18} color={Colors.white} />
            <Text style={styles.dmBtnText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.friendBtn, isFriend && styles.friendBtnActive]}
            onPress={handleFriendToggle}
            activeOpacity={0.85}
            disabled={friendBusy}
          >
            <Ionicons
              name={isFriend ? 'person-remove-outline' : 'person-add-outline'}
              size={18}
              color={isFriend ? Colors.accent : Colors.text}
            />
            <Text style={[styles.friendBtnText, isFriend && styles.friendBtnTextActive]}>
              {friendBusy ? '…' : isFriend ? 'Friend' : 'Add friend'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.reportBtn}
            onPress={() => setShowReportModal(true)}
            activeOpacity={0.75}
          >
            <Ionicons name="flag-outline" size={18} color="rgba(255,255,255,0.35)" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Report modal ── */}
      {user && !isSelf && (
        <ReportModal
          visible={showReportModal}
          reporterGuestId={account ? undefined : identity?.guestId}
          targetUserId={user.id}
          targetNickname={user.displayName}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {/* ── Avatar lightbox ── */}
      {user?.avatarUrl ? (
        <Modal
          visible={showAvatarLightbox}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setShowAvatarLightbox(false)}
        >
          <Pressable style={styles.lightboxOverlay} onPress={() => setShowAvatarLightbox(false)}>
            <Image source={{ uri: user.avatarUrl }} style={styles.lightboxImage} resizeMode="contain" />
            <Pressable style={styles.lightboxClose} onPress={() => setShowAvatarLightbox(false)}>
              <Text style={styles.lightboxCloseText}>✕</Text>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 80;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
    flexShrink:        0,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:   'absolute',
    left:       0,
    right:      0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
  },

  // ── States ────────────────────────────────────────────────────────────────
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: {
    color:     Colors.muted,
    fontSize:  FontSizes.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  retryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  retryBtnText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },

  // ── Identity section (sticky, always visible) ─────────────────────────────
  identitySection: {
    flexShrink:        0,
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.sm,
    gap:               Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor:   Colors.bg,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    gap:        8,
  },
  avatar: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize:   32,
    fontWeight: '800',
    color:      '#fff',
  },
  displayName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
  },
  badgeBlock: {
    alignItems: 'center',
    gap:        3,
  },
  memberBadge: {
    borderRadius:      Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderWidth:       1,
  },
  memberBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.6,
  },
  badgeMicrocopy: {
    fontSize:  FontSizes.xs,
    color:     Colors.muted,
    textAlign: 'center',
  },
  cityPill: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 12,
    paddingVertical:   4,
    borderRadius:      Radius.full,
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.09)',
  },
  cityPillText: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
  },
  aboutMe: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    textAlign:  'center',
    lineHeight: FontSizes.sm * 1.45,
    maxWidth:   260,
    alignSelf:  'center',
    marginTop:  8,
  },

  // ── Identity cards: vibe + mode — side by side ────────────────────────────
  identityCards: {
    flexDirection: 'row',
    gap:           Spacing.sm,
  },
  identityCard: {
    flex:             1,
    backgroundColor:  Colors.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      'rgba(251,146,60,0.18)',
    padding:          Spacing.sm + 2,
    gap:              3,
  },
  identityCardEmoji: {
    fontSize:     22,
    marginBottom: 2,
  },
  identityCardTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  identityCardSub: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    lineHeight: 16,
  },

  // ── Details card — From + Age ─────────────────────────────────────────────
  detailsCard: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    overflow:        'hidden',
  },
  detailRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
  },
  detailRowFirst: { borderTopWidth: 0 },
  detailLabel: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
  },
  detailValue: {
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    fontWeight: '600',
  },

  // ── Tab bar ───────────────────────────────────────────────────────────────
  tabBarWrap: {
    flexShrink:        0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabBar: {
    flexDirection:    'row',
    gap:              8,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical:   7,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   'rgba(255,255,255,0.04)',
  },
  tabPillActive: {
    borderColor:     Colors.accent,
    backgroundColor: 'rgba(255,107,0,0.10)',
  },
  tabPillText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.muted,
  },
  tabPillTextActive: {
    color: Colors.accent,
  },

  // ── Tab content ───────────────────────────────────────────────────────────
  tabContent: { flex: 1 },
  tabContentBody: {
    padding: Spacing.md,
    gap:     Spacing.md,
  },
  tabEmpty: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    textAlign:  'center',
    paddingVertical: Spacing.xl,
  },

  // ── Event list ────────────────────────────────────────────────────────────
  eventList: { gap: Spacing.xs },
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    gap:               Spacing.sm,
  },
  eventIcon:  { fontSize: 20 },
  eventInfo:  { flex: 1, gap: 2 },
  eventTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flexWrap:      'wrap',
  },
  eventTime:     { fontSize: FontSizes.xs, color: Colors.muted },
  eventLocation: { fontSize: FontSizes.xs, color: Colors.muted, flexShrink: 1 },
  liveBadge: {
    backgroundColor:   'rgba(61,220,132,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(61,220,132,0.25)',
  },
  liveBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.green,
    letterSpacing: 0.4,
  },

  // ── Friends list ──────────────────────────────────────────────────────────
  friendList: { gap: Spacing.xs },
  friendRow: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    gap:               Spacing.sm,
  },
  friendAvatar: {
    width:        40,
    height:       40,
    borderRadius: 20,
    flexShrink:   0,
  },
  friendAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  friendAvatarInitial:  { fontSize: 16, fontWeight: '700', color: '#fff' },
  friendInfo:  { flex: 1, gap: 2 },
  friendName: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  friendBadge: { fontSize: FontSizes.xs, color: Colors.muted },

  // ── Vibe score card ───────────────────────────────────────────────────────
  vibeScoreCard: {
    alignItems:      'center',
    gap:             6,
    padding:         Spacing.md,
    backgroundColor: 'rgba(251,191,36,0.04)',
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(251,191,36,0.12)',
  },
  vibeStarsRow:     { flexDirection: 'row', gap: 4 },
  vibeStarStatic:   { fontSize: 22, color: 'rgba(255,255,255,0.12)' },
  vibeStarStaticOn: { color: '#fbbf24' },
  vibeScoreAvg:     { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  vibeScoreCount:   { fontSize: FontSizes.xs, color: Colors.muted2 },
  vibeCtaBtn: {
    paddingVertical: 14,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(251,191,36,0.20)',
    alignItems:      'center',
  },
  vibeCtaBtnText: { fontSize: FontSizes.sm, fontWeight: '700', color: '#fbbf24' },
  vibeForm: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(251,191,36,0.18)',
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  vibeFormStars:  { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  vibeFormStar:   { fontSize: 30, color: 'rgba(255,255,255,0.15)' },
  vibeFormStarOn: { color: '#fbbf24' },
  vibeInput: {
    backgroundColor:   Colors.bg3,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical:   Spacing.sm,
    minHeight:         60,
    textAlignVertical: 'top',
  },
  vibeFormActions:       { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  vibeCancelBtn:         { paddingHorizontal: Spacing.md, paddingVertical: 9, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md },
  vibeCancelBtnText:     { fontSize: FontSizes.xs, color: Colors.muted, fontWeight: '600' },
  vibeSubmitBtn:         { paddingHorizontal: Spacing.md, paddingVertical: 9, backgroundColor: '#fbbf24', borderRadius: Radius.md },
  vibeSubmitBtnDisabled: { opacity: 0.45 },
  vibeSubmitBtnText:     { fontSize: FontSizes.xs, fontWeight: '700', color: '#000' },
  vibeList:  { gap: Spacing.sm },
  vibeRow:   { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  vibeAvatar: {
    width:        38,
    height:       38,
    borderRadius: 19,
    flexShrink:   0,
  },
  vibeAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  vibeAvatarInitial:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  vibeContent: { flex: 1, gap: 3 },
  vibeHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vibeAuthor:  { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  vibeRating:  { fontSize: FontSizes.xs, color: '#fbbf24', letterSpacing: 1 },
  vibeMsg:     { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  vibeEmpty:          { alignItems: 'center', paddingVertical: Spacing.lg, gap: 4 },
  vibeEmptyTitle:     { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  vibeEmptySubtitle:  { fontSize: FontSizes.xs, color: Colors.muted2 },

  // ── City Picks cards ──────────────────────────────────────────────────────
  picksGrid: { gap: Spacing.sm },
  pickCard: {
    gap:             6,
    padding:         Spacing.md,
    backgroundColor: 'rgba(255,193,7,0.05)',
    borderWidth:     1,
    borderColor:     'rgba(255,193,7,0.15)',
    borderRadius:    Radius.lg,
  },
  pickCardTitle: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color:         'rgba(255,193,7,0.70)',
  },
  pickCardContent: {
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    fontWeight: '500',
    lineHeight: 20,
  },

  // ── Sticky action bar ─────────────────────────────────────────────────────
  stickyBar: {
    flexDirection:     'row',
    gap:               10,
    paddingHorizontal: Spacing.md,
    paddingTop:        12,
    backgroundColor:   'rgba(14, 14, 16, 0.92)',
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    flexShrink:        0,
  },
  friendBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingVertical:   15,
    paddingHorizontal: Spacing.md,
    backgroundColor:   'transparent',
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  friendBtnActive:     { backgroundColor: 'rgba(255,122,60,0.10)', borderColor: Colors.accent },
  friendBtnText:       { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  friendBtnTextActive: { color: Colors.accent },

  dmBtn: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    paddingVertical: 15,
    backgroundColor: Colors.accent2,
    borderRadius:    Radius.lg,
    shadowColor:     Colors.accent2,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.30,
    shadowRadius:    8,
    elevation:       5,
  },
  dmBtnText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.white },

  reportBtn: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.08)',
  },

  // ── Avatar lightbox ───────────────────────────────────────────────────────
  lightboxOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent:  'center',
    alignItems:      'center',
  },
  lightboxImage: {
    width:       '92%',
    aspectRatio: 1,
    borderRadius: 12,
  },
  lightboxClose: {
    position:        'absolute',
    top:             52,
    right:           18,
    width:           38,
    height:          38,
    borderRadius:    19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  lightboxCloseText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
