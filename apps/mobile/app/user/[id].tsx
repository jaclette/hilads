/**
 * Public profile screen — /user/[id]
 *
 * Web parity: PublicProfileScreen.jsx
 * Shows: avatar, display name, member badge, home city, age, interests,
 *        events the user is going to, events the user created.
 * DM button at the bottom for registered non-self users.
 */

import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, addFriend, removeFriend, fetchUserVibes, postVibe, type UserVibe } from '@/api/users';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { HiladsEvent, PublicProfile, UserDTO } from '@/types';
import { BADGE_META } from '@/types';

// ── Badge microcopy — mirrors web PublicProfileScreen.jsx & me.tsx ────────────

const BADGE_MICROCOPY: Record<string, string> = {
  ghost:   'Just browsing 👀',
  fresh:   'Just landed 👶',
  regular: 'Shows up often',
  local:   'Knows the city',
  host:    'Makes it happen 🔥',
};

// ── City flag — mirrors me.tsx / chat.tsx ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const PROFILE_BADGE_BG: Record<string, object> = {
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh: { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local: { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:  { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const PROFILE_BADGE_COLOR: Record<string, object> = {
  ghost: { color: '#666' },
  fresh: { color: '#4ade80' },
  regular: { color: '#60a5fa' },
  local: { color: '#34d399' },
  host:  { color: '#fbbf24' },
};
function profileBadgeBg(key: string): object {
  return PROFILE_BADGE_BG[key] ?? PROFILE_BADGE_BG.regular;
}
function profileBadgeColor(key: string): object {
  return PROFILE_BADGE_COLOR[key] ?? PROFILE_BADGE_COLOR.regular;
}

// ── Avatar gradient palette — mirrors web PublicProfileScreen.jsx ─────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Vibe meta — mirrors web PublicProfileScreen.jsx ───────────────────────────

const VIBE_META: Record<string, { emoji: string; label: string; caption: string }> = {
  party:       { emoji: '🔥', label: 'Party',       caption: 'Always down to party 🎉'   },
  board_games: { emoji: '🎲', label: 'Board Games', caption: 'Game night, every night'   },
  coffee:      { emoji: '☕', label: 'Coffee',       caption: 'Best conversations over coffee' },
  music:       { emoji: '🎧', label: 'Music',        caption: 'Life is a playlist 🎶'     },
  food:        { emoji: '🍜', label: 'Food',         caption: 'Eats first, questions later' },
  chill:       { emoji: '🧘', label: 'Chill',        caption: 'Easy vibes only 😌'         },
};

// ── Event helpers — mirrors hot.tsx ───────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatEventTime(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (d.toDateString() === today.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

// ── Event pill — compact card for profile events list ─────────────────────────

function EventPill({
  event,
  onPress,
}: {
  event: HiladsEvent;
  onPress: () => void;
}) {
  const icon = EVENT_ICONS[event.event_type] ?? '📌';
  const now  = Date.now() / 1000;
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
          {event.location_hint ? (
            <Text style={styles.eventLocation} numberOfLines={1}>· {event.location_hint}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account, city } = useApp();

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
  const [showVibeForm, setShowVibeForm] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetchPublicProfile(id),
      fetchUserEvents(id),
      fetchUserFriends(id).catch(() => ({ friends: [], total: 0, hasMore: false })),
      fetchUserVibes(id).catch(() => ({ vibes: [], score: null, count: 0, myVibe: null })),
    ])
      .then(([u, evs, fr, vib]) => {
        setUser(u);
        setEvents(evs);
        setIsFriend(u.isFriend ?? false);
        setFriends(fr.friends);
        setVibes(vib.vibes);
        setVibeScore(vib.score);
        setVibeCount(vib.count);
        setMyVibe(vib.myVibe);
        if (vib.myVibe) { setVibeRating(vib.myVibe.rating); setVibeMessage(vib.myVibe.message ?? ''); }
      })
      .catch(() => setError('Could not load profile.'))
      .finally(() => setLoading(false));
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
            text: 'Unfriend',
            style: 'destructive',
            onPress: async () => {
              setFriendBusy(true);
              try {
                await removeFriend(user.id);
                setIsFriend(false);
              } catch { /* silently ignore */ }
              finally { setFriendBusy(false); }
            },
          },
        ],
      );
    } else {
      (async () => {
        setFriendBusy(true);
        try {
          await addFriend(user.id);
          setIsFriend(true);
        } catch { /* silently ignore */ }
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
    } catch { /* silently ignore */ }
    finally { setVibeBusy(false); }
  }

  const name    = user?.displayName ?? '?';
  const initial = name[0].toUpperCase();
  const bg      = avatarBg(name);
  const isSelf  = account?.id === id;

  // Split events: created by this user vs joined-but-not-created
  const createdEvents = events.filter(e => e.created_by === id);
  const goingEvents   = events.filter(e => e.created_by !== id);

  function handleDm() {
    if (!user?.id) return;
    router.push({
      pathname: '/dm/[id]',
      params: { id: user.id, name: user.displayName },
    });
  }

  function handleEventPress(eventId: string) {
    router.push({
      pathname: '/event/[id]',
      params: { id: eventId },
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
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
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero: avatar + name + identity badge + microcopy + city ── */}
          <View style={styles.hero}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
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

          {/* ── Vibe card ── */}
          {user.vibe && VIBE_META[user.vibe] ? (
            <View style={styles.vibeCard}>
              <Text style={styles.vibeEmoji}>{VIBE_META[user.vibe].emoji}</Text>
              <View style={styles.vibeText}>
                <Text style={styles.vibeLabel}>{VIBE_META[user.vibe].label}</Text>
                <Text style={styles.vibeCaption}>{VIBE_META[user.vibe].caption}</Text>
              </View>
            </View>
          ) : null}

          {/* ── Details: home city + age ── */}
          {(user.homeCity || user.age != null) && (
            <View style={styles.detailsCard}>
              {user.homeCity ? (
                <View style={styles.detailRow}>
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
          )}

          {/* ── Interests — read-only chips ── */}
          {(user.interests?.length ?? 0) > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Interests</Text>
              <View style={styles.interestsWrap}>
                {(user.interests ?? []).map(interest => (
                  <View key={interest} style={styles.chip}>
                    <Text style={styles.chipText}>{interest}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Events going to (joined but not created) ── */}
          {goingEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Going to</Text>
              <View style={styles.eventList}>
                {goingEvents.slice(0, 5).map(event => (
                  <EventPill
                    key={event.id}
                    event={event}
                    onPress={() => handleEventPress(event.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* ── Events created ── */}
          {createdEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Created</Text>
              <View style={styles.eventList}>
                {createdEvents.slice(0, 5).map(event => (
                  <EventPill
                    key={event.id}
                    event={event}
                    onPress={() => handleEventPress(event.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* ── Friends section ── */}
          {friends.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Friends · {friends.length}</Text>
              <View style={styles.friendList}>
                {friends.map(f => (
                  <TouchableOpacity
                    key={f.id}
                    style={styles.friendRow}
                    onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id } })}
                    activeOpacity={0.7}
                  >
                    {f.avatarUrl ? (
                      <Image source={{ uri: f.avatarUrl }} style={styles.friendAvatar} />
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
            </View>
          )}

          {/* ── Vibe score ── */}
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

          {/* ── Leave a vibe ── */}
          {!isSelf && account && (
            <View style={styles.section}>
              {!showVibeForm ? (
                <TouchableOpacity
                  style={styles.vibeCtaBtn}
                  onPress={() => setShowVibeForm(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.vibeCtaBtnText}>
                    {myVibe ? `✏️ Update your vibe (${myVibe.rating}★)` : '⭐ Leave a vibe'}
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
                      <Text style={styles.vibeSubmitBtnText}>{vibeBusy ? 'Sending…' : 'Send vibe ✨'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ── Vibes list ── */}
          {(vibeCount > 0 || true) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                {vibeCount > 0 ? `Vibes · ${vibeCount}` : 'Vibes'}
              </Text>
              {vibes.length > 0 ? (
                <View style={styles.vibeList}>
                  {vibes.map(v => (
                    <View key={v.id} style={styles.vibeRow}>
                      {v.authorPhoto ? (
                        <Image source={{ uri: v.authorPhoto }} style={styles.vibeAvatar} />
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
                  <Text style={styles.vibeEmptyTitle}>No vibes yet</Text>
                  <Text style={styles.vibeEmptySubtitle}>Be the first to leave a vibe ✨</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Action buttons — registered non-self viewers only ── */}
          {!isSelf && account && (
            <View style={styles.actionBtns}>
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
                  {isFriend ? 'Friend' : 'Add friend'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.dmBtn} onPress={handleDm} activeOpacity={0.85}>
                <Feather name="message-square" size={18} color={Colors.white} />
                <Text style={styles.dmBtnText}>Message</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 88;

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

  // ── Body ──────────────────────────────────────────────────────────────────
  body: {
    padding:       Spacing.md,
    gap:           Spacing.md,
    paddingBottom: Spacing.xxl,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:    'center',
    paddingTop:    Spacing.lg,
    paddingBottom: Spacing.md,
    gap:           10,
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
    fontSize:   36,
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
    gap:        4,
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
    paddingVertical:   5,
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

  // ── Vibe card ─────────────────────────────────────────────────────────────
  vibeCard: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               14,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       'rgba(251,146,60,0.18)',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
  },
  vibeEmoji: {
    fontSize: 28,
  },
  vibeText: {
    flex: 1,
    gap:  2,
  },
  vibeLabel: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  vibeCaption: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },

  // ── Details card ─────────────────────────────────────────────────────────
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
    paddingVertical:   14,
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

  // ── Sections (interests, events) ──────────────────────────────────────────
  section: { gap: Spacing.sm },
  sectionLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },

  // ── Interests ─────────────────────────────────────────────────────────────
  interestsWrap: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  chip: {
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.35)',
    paddingHorizontal: 14,
    paddingVertical:   7,
  },
  chipText: {
    fontSize:   FontSizes.sm,
    color:      Colors.violet,
    fontWeight: '600',
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
  eventTime: {
    fontSize: FontSizes.xs,
    color:    Colors.muted,
  },
  eventLocation: {
    fontSize:    FontSizes.xs,
    color:       Colors.muted,
    flexShrink:  1,
  },
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
  friendAvatarFallback: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  friendAvatarInitial: {
    fontSize:   16,
    fontWeight: '700',
    color:      '#fff',
  },
  friendInfo: { flex: 1, gap: 2 },
  friendName: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  friendBadge: {
    fontSize: FontSizes.xs,
    color:    Colors.muted,
  },

  // ── Action buttons row ────────────────────────────────────────────────────
  actionBtns: {
    flexDirection: 'row',
    gap:           Spacing.sm,
    marginTop:     Spacing.sm,
  },
  friendBtn: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingVertical:   15,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  friendBtnActive: {
    backgroundColor: 'rgba(255,122,60,0.10)',
    borderColor:     Colors.accent,
  },
  friendBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  friendBtnTextActive: {
    color: Colors.accent,
  },

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
  vibeScoreAvg: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  vibeScoreCount: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },
  // CTA
  vibeCtaBtn: {
    paddingVertical:   14,
    backgroundColor:   'rgba(251,191,36,0.08)',
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       'rgba(251,191,36,0.20)',
    alignItems:        'center',
  },
  vibeCtaBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      '#fbbf24',
  },
  // Form
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
  vibeFormActions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  vibeCancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   9,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
  },
  vibeCancelBtnText: { fontSize: FontSizes.xs, color: Colors.muted, fontWeight: '600' },
  vibeSubmitBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   9,
    backgroundColor:   '#fbbf24',
    borderRadius:      Radius.md,
  },
  vibeSubmitBtnDisabled: { opacity: 0.45 },
  vibeSubmitBtnText: { fontSize: FontSizes.xs, fontWeight: '700', color: '#000' },
  // List
  vibeList:  { gap: Spacing.sm },
  vibeRow: {
    flexDirection:     'row',
    gap:               Spacing.sm,
    alignItems:        'flex-start',
  },
  vibeAvatar: {
    width:        38,
    height:       38,
    borderRadius: 19,
    flexShrink:   0,
  },
  vibeAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  vibeAvatarInitial: { fontSize: 14, fontWeight: '700', color: '#fff' },
  vibeContent: { flex: 1, gap: 3 },
  vibeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vibeAuthor: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  vibeRating: { fontSize: FontSizes.xs, color: '#fbbf24', letterSpacing: 1 },
  vibeMsg: { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  vibeEmpty: { alignItems: 'center', paddingVertical: Spacing.lg, gap: 4 },
  vibeEmptyTitle: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  vibeEmptySubtitle: { fontSize: FontSizes.xs, color: Colors.muted2 },

  // ── DM button ─────────────────────────────────────────────────────────────
  dmBtn: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingVertical:   15,
    backgroundColor:   Colors.accent2,
    borderRadius:      Radius.lg,
    shadowColor:       Colors.accent2,
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.30,
    shadowRadius:      8,
    elevation:         5,
  },
  dmBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.white,
  },
});
