import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import { fetchDailyProof, fetchPhotoMentionSuggestions } from '@/api/daily';
import type { MentionSuggestion } from '@/api/mentions';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { MentionSuggestions } from '@/features/chat/MentionSuggestions';
import { EmojiPanel } from '@/features/chat/EmojiPanel';
import { isBlocked } from '@/lib/blockFilter';
import { countryToFlag } from '@/lib/countryFlag';
import { thumbUrl } from '@/lib/imageThumb';
import { detectActiveMention } from '@/lib/mentions';
import { canAccessProfile } from '@/lib/profileAccess';
import { Avatar, Sheet } from '@/ui';
import { Confetti, ThemeChipJoy, themeColor } from '@/ui/joy';
import type { DailyProof, PhotoComment } from '@/types';
import {
  discardFailed, loadOlder, reportComment, removeComment, sendComment, toggleCommentLike, useCommentThread,
  type CommentItem,
} from './comments';
import { themeName } from './themes';

// The comments of a Daily photo (docs/photo-comments-audit.md): one sheet for
// every place a photo shows. Open it with openPhotoComments(); the topmost
// mounted PhotoCommentsHost shows it (screens shown as native modals and the
// photo viewer mount their own, so the sheet always lands above them).

export const COMMENT_MAX = 300;

export interface CommentsTarget {
  proofId:   string;
  thumbUrl?: string | null;
  author?:   { id: string; username: string | null; displayName: string | null; photoUrl: string | null } | null;
  city?:     { name: string; country?: string | null } | null;
  theme?:    string | null;
  isMine?:   boolean;
  /** Scroll to (and flash) this comment: a push or a bell row. */
  focusCommentId?: number | null;
}

/** A target from a full proof (viewers, story viewer, passport). */
export function commentsTargetOf(p: DailyProof, focusCommentId?: number | null): CommentsTarget {
  return {
    proofId: p.id, thumbUrl: p.thumbUrl ?? p.photoUrl, author: p.user,
    city: p.city ? { name: p.city.name, country: p.city.country } : null,
    theme: p.context?.theme?.key ?? null, isMine: p.isMine, focusCommentId,
  };
}

// ── Open / host stack ──────────────────────────────────────────────────────

let current: CommentsTarget | null = null;
const hosts: number[] = [];
let hostSeq = 0;
const openListeners = new Set<() => void>();
let openVersion = 0;
const notifyOpen = () => { openVersion++; openListeners.forEach(l => l()); };

export function openPhotoComments(target: CommentsTarget) {
  Haptics.selectionAsync().catch(() => {});
  current = target;
  notifyOpen();
}

export function closePhotoComments() {
  current = null;
  notifyOpen();
}

const subscribeOpen = (l: () => void) => { openListeners.add(l); return () => { openListeners.delete(l); }; };

/** True while a comments sheet is open (a story viewer pauses). */
export function useCommentsOpen(): boolean {
  useSyncExternalStore(subscribeOpen, () => openVersion);
  return current !== null;
}

/**
 * Mount once per layer that can open comments (root, native modal screens, the
 * photo viewer). `onLeave`: the layer closes itself before a profile opens.
 */
export function PhotoCommentsHost({ onLeave }: { onLeave?: () => void } = {}) {
  const id = useMemo(() => ++hostSeq, []);
  useEffect(() => {
    hosts.push(id);
    notifyOpen();
    return () => { hosts.splice(hosts.indexOf(id), 1); notifyOpen(); };
  }, [id]);
  useSyncExternalStore(subscribeOpen, () => openVersion);
  const mine = current !== null && hosts[hosts.length - 1] === id;
  return mine ? <PhotoCommentsSheet target={current!} onClose={closePhotoComments} onLeave={onLeave} /> : null;
}

// ── The sheet ──────────────────────────────────────────────────────────────

type Menu = { comment: CommentItem; reporting: boolean } | null;

function PhotoCommentsSheet({ target: initial, onClose, onLeave }: { target: CommentsTarget; onClose: () => void; onLeave?: () => void }) {
  const { t } = useTranslation('daily');
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { account, identity, blockedSet } = useApp();
  const guestId = identity?.guestId ?? null;

  // A push or a bell row only knows the photo id: fill the header from the photo.
  const [target, setTarget] = useState<CommentsTarget>(initial);
  useEffect(() => {
    setTarget(initial);
    if (initial.author) return;
    let live = true;
    fetchDailyProof(initial.proofId)
      .then(p => { if (live) setTarget(commentsTargetOf(p, initial.focusCommentId)); })
      .catch(() => {});
    return () => { live = false; };
  }, [initial]);

  const thread = useCommentThread(target.proofId, guestId);
  const items = useMemo(
    () => thread.items.filter(c => !isBlocked(c.user.id, null, blockedSet)).map(c => (
      account && c.user.id === account.id ? { ...c, isMine: true, canDelete: true }
        : target.isMine ? { ...c, canDelete: true } : c
    )),
    [thread.items, blockedSet, account, target.isMine],
  );
  const count = items.filter(c => c.pending !== 'failed').length;

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<PhotoComment | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [keyboard, setKeyboard] = useState(0);   // its height while open
  const [mentionQuery, setMentionQuery] = useState<{ query: string; at: number } | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [confetti, setConfetti] = useState(false);
  const [flash, setFlash] = useState<number | null>(initial.focusCommentId ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<CommentItem>>(null);
  const cursor = useRef(0);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // A notice (error, report thanks) fades after a moment.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(id);
  }, [notice]);

  // Scroll to the comment a notification is about, once it is loaded.
  useEffect(() => {
    if (flash === null || !thread.loaded) return;
    const index = items.findIndex(c => c.id === flash);
    if (index >= 0) setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 250);
    const id = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, thread.loaded]);

  // @ autocomplete: the photo's author and thread first (server side).
  useEffect(() => {
    if (!mentionQuery || !account) { setSuggestions([]); return; }
    let live = true;
    const id = setTimeout(() => {
      fetchPhotoMentionSuggestions(target.proofId, mentionQuery.query).then(s => { if (live) setSuggestions(s); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [mentionQuery, target.proofId, account]);

  const needAccount = () => {
    if (account) return false;
    onClose();
    onLeave?.();
    setTimeout(() => router.push('/auth-gate?reason=daily_comment' as never), 250);
    return true;
  };

  const openProfile = (userId: string) => {
    onClose();
    onLeave?.();
    setTimeout(() => {
      if (!canAccessProfile(account)) router.push('/auth-gate?reason=view_profile' as never);
      else router.push({ pathname: '/user/[id]', params: { id: userId } });
    }, 250);
  };

  const onChangeText = (v: string) => {
    setText(v);
    setMentionQuery(detectActiveMention(v.slice(0, cursor.current || v.length)));
  };

  const onSelectMention = (s: MentionSuggestion) => {
    if (!mentionQuery) return;
    const end = mentionQuery.at + 1 + mentionQuery.query.length;
    const next = `${text.slice(0, mentionQuery.at)}@${s.username} ${text.slice(end)}`;
    setText(next.slice(0, COMMENT_MAX));
    setMentionQuery(null);
  };

  const send = async (body: string, retry?: CommentItem) => {
    const clean = body.trim();
    if (!clean || needAccount() || !account) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const firstEver = count === 0;
    const quoting = retry ? (retry.replyTo ? items.find(c => c.id === retry.replyTo!.id) ?? null : null) : replyTo;
    if (!retry) { setText(''); setReplyTo(null); setShowEmoji(false); }
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    const err = await sendComment(target.proofId, clean, account, quoting, !!target.isMine, retry?.tempId);
    if (err === null && firstEver && !reduced) {
      setConfetti(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTimeout(() => setConfetti(false), 1600);
    }
    if (err === 'moderation_blocked' || err === 'invalid_body' || err === 'rate_limited') {
      if (!retry) setText(clean);
      setNotice(t(`comments.errors.${err}`));
    } else if (err === 'signup_required') {
      needAccount();
    }
  };

  const onReply = (c: CommentItem) => {
    setMenu(null);
    if (needAccount()) return;
    setReplyTo(c);
    const handle = c.user.username ? `@${c.user.username} ` : '';
    if (handle && !text.startsWith(handle)) setText((handle + text).slice(0, COMMENT_MAX));
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const onReport = async (c: CommentItem, reason: 'inappropriate' | 'harassment' | 'spam' | 'other') => {
    setMenu(null);
    const res = await reportComment(c.id, reason, guestId);
    setNotice(res === 'already' ? t('comments.report.already') : res === 'ok' ? t('comments.report.thanks') : t('comments.errors.generic'));
  };

  const onDelete = async (c: CommentItem) => {
    setMenu(null);
    if (!(await removeComment(target.proofId, c.id))) setNotice(t('comments.errors.generic'));
  };

  const accent = themeColor(target.theme);
  const authorName = target.author?.username ? `@${target.author.username}` : target.author?.displayName ?? '';
  const flag = countryToFlag(target.city?.country);
  const firstId = !thread.hasMore ? items.find(c => !c.pending)?.id ?? null : null;
  // Full height above the keyboard while typing (the sheet rises with it), else 78% of the screen.
  const sheetStyle = { height: keyboard > 0 ? height - keyboard - insets.top - 8 : Math.round(height * 0.78) };

  return (
    <Sheet visible onClose={onClose} closeLabel={t('comments.close')} style={[styles.sheet, sheetStyle]}>
      {/* ── Header: the photo, its author and city, its theme, the count ── */}
      <View style={styles.header}>
        {!!target.thumbUrl && <Image source={{ uri: thumbUrl(target.thumbUrl) }} style={styles.thumb} contentFit="cover" />}
        <View style={styles.headerBody}>
          <Text style={styles.title} accessibilityRole="header">
            {t('comments.title')}{count > 0 ? ` · ${count}` : ''}
          </Text>
          <Text style={styles.byline} numberOfLines={1}>
            {[authorName, target.city?.name ? `${flag ? flag + ' ' : ''}${target.city.name}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {!!target.theme && <ThemeChipJoy theme={target.theme} label={themeName(target.theme)} />}
      </View>

      {/* ── The thread ── */}
      <View style={styles.listWrap}>
        {thread.loading && !thread.loaded ? (
          <ActivityIndicator style={styles.center} color={colors.muted} />
        ) : thread.error && !thread.loaded ? (
          <View style={styles.center}><Text style={styles.muted}>{t('loadFailed')}</Text></View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyBubble, { backgroundColor: accent.fill }]}>
              <Ionicons name="chatbubbles" size={30} color={accent.onFill} />
            </View>
            <Text style={styles.emptyTitle}>{t('comments.empty')}</Text>
            <Text style={styles.emptySub}>{t('comments.emptySub')}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={c => c.tempId ?? String(c.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            onScrollToIndexFailed={() => {}}
            ListHeaderComponent={thread.hasMore ? (
              <TouchableOpacity style={styles.older} onPress={() => loadOlder(target.proofId, guestId)} accessibilityRole="button">
                {thread.loading ? <ActivityIndicator size="small" color={colors.muted} /> : <Text style={styles.olderText}>{t('comments.older')}</Text>}
              </TouchableOpacity>
            ) : null}
            renderItem={({ item }) => (
              <CommentRow
                c={item}
                first={item.id === firstId}
                flash={item.id === flash}
                live={!reduced && !!item.liveAt}
                onProfile={openProfile}
                onLongPress={() => { Haptics.selectionAsync().catch(() => {}); setMenu({ comment: item, reporting: false }); }}
                onLike={() => { if (!needAccount()) toggleCommentLike(target.proofId, item.id); }}
                onRetry={() => send(item.body, item)}
                onDiscard={() => item.tempId && discardFailed(target.proofId, item.tempId)}
              />
            )}
          />
        )}
        <Confetti run={confetti} count={24} />
      </View>

      {!!notice && <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>}

      {/* ── Quick reactions while the composer is empty ── */}
      {text.length === 0 && !replyTo && keyboard === 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
                    contentContainerStyle={styles.chips} style={styles.chipsRow}>
          {quickKeys(target.theme).map(k => (
            <TouchableOpacity
              key={k}
              style={[styles.chip, { borderColor: accent.fill }]}
              onPress={() => send(t(`comments.quick.${k}`))}
              onLongPress={() => { if (needAccount()) return; setText(t(`comments.quick.${k}`)); inputRef.current?.focus(); }}
              accessibilityRole="button"
              accessibilityHint={t('comments.quickHint')}
            >
              <Text style={styles.chipText}>{t(`comments.quick.${k}`)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {mentionQuery !== null && <MentionSuggestions suggestions={suggestions} onSelect={onSelectMention} />}
      {showEmoji && <View style={styles.emoji}><EmojiPanel onSelect={e => setText(v => (v + e).slice(0, COMMENT_MAX))} /></View>}

      {replyTo && (
        <View style={styles.replyStrip}>
          <View style={styles.flex}>
            <Text style={styles.replyName}>{t('comments.replyingTo', { name: replyTo.user.username ?? replyTo.user.displayName ?? '' })}</Text>
            <Text style={styles.muted} numberOfLines={1}>{replyTo.body}</Text>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setReplyTo(null)} accessibilityRole="button" accessibilityLabel={t('comments.cancelReply')}>
            <Ionicons name="close" size={20} color={colors.muted} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Composer, like the chat's ── */}
      <View style={styles.composer}>
        <TouchableOpacity
          style={[styles.iconBtn, showEmoji && styles.iconBtnOn]}
          onPress={() => { if (needAccount()) return; Keyboard.dismiss(); setShowEmoji(v => !v); }}
          accessibilityRole="button"
          accessibilityLabel={t('composer.emoji', { ns: 'chat' })}
          accessibilityState={{ selected: showEmoji }}
        >
          <Ionicons name="happy-outline" size={24} color={showEmoji ? colors.primaryOnTint : colors.muted} />
        </TouchableOpacity>
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={onChangeText}
            onSelectionChange={({ nativeEvent: { selection } }) => { cursor.current = selection.end; }}
            onFocus={() => { setShowEmoji(false); needAccount(); }}
            placeholder={account ? t('comments.placeholder') : t('comments.placeholderGuest')}
            placeholderTextColor={colors.mutedDim}
            multiline
            maxLength={COMMENT_MAX}
            accessibilityLabel={t('comments.placeholder')}
          />
          {text.length > COMMENT_MAX - 50 && (
            <Text style={[styles.counter, text.length >= COMMENT_MAX && { color: colors.red }]}>{COMMENT_MAX - text.length}</Text>
          )}
        </View>
        <SendButton disabled={!text.trim()} onPress={() => send(text)} label={t('composer.send', { ns: 'chat' })} />
      </View>

      {/* ── Long press: reply, copy, report, delete ── */}
      {menu && (
        <Pressable style={styles.menuScrim} onPress={() => setMenu(null)} accessibilityRole="button" accessibilityLabel={t('comments.close')}>
          <Animated.View entering={reduced ? undefined : FadeInDown.duration(180)} style={[styles.menu, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.menuQuote} numberOfLines={2}>{menu.comment.body}</Text>
            {menu.reporting ? (
              (['inappropriate', 'harassment', 'spam', 'other'] as const).map(r => (
                <MenuRow key={r} icon="flag-outline" label={t(`comments.report.reasons.${r}`)} onPress={() => onReport(menu.comment, r)} />
              ))
            ) : (
              <>
                {!menu.comment.pending && <MenuRow icon="arrow-undo-outline" label={t('comments.reply')} onPress={() => onReply(menu.comment)} />}
                <MenuRow icon="copy-outline" label={t('comments.copy')} onPress={() => { Clipboard.setStringAsync(menu.comment.body); setMenu(null); }} />
                {!menu.comment.isMine && !menu.comment.pending && (
                  <MenuRow icon="flag-outline" label={t('comments.report.action')} onPress={() => setMenu({ ...menu, reporting: true })} />
                )}
                {menu.comment.canDelete && !menu.comment.pending && (
                  <MenuRow icon="trash-outline" label={t('comments.delete')} danger onPress={() => onDelete(menu.comment)} />
                )}
              </>
            )}
          </Animated.View>
        </Pressable>
      )}
    </Sheet>
  );
}

/** Quick reactions: the photo's theme picks which ones (all localized). */
export function quickKeys(theme: string | null | undefined): string[] {
  switch (theme) {
    case 'taste': case 'sip':           return ['wantThis', 'soLocal', 'whatsItCalled', 'whereIsIt'];
    case 'hidden_gem': case 'only_here': return ['soLocal', 'whereIsIt', 'neverSeen', 'wantThis'];
    default:                             return ['soLocal', 'neverSeen', 'whereIsIt', 'whatsItCalled'];
  }
}

// ── A comment, like a chat message ─────────────────────────────────────────

function CommentRow({ c, first, flash, live, onProfile, onLongPress, onLike, onRetry, onDiscard }: {
  c: CommentItem; first: boolean; flash: boolean; live: boolean;
  onProfile: (userId: string) => void; onLongPress: () => void; onLike: () => void;
  onRetry: () => void; onDiscard: () => void;
}) {
  const { t, i18n } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const name = c.user.username ? `@${c.user.username}` : c.user.displayName ?? '';
  const flag = countryToFlag(c.user.city?.country);
  const highlight = useSharedValue(flash || live ? 1 : 0);
  useEffect(() => {
    if (flash || live) highlight.value = withSequence(withTiming(1, { duration: 1 }), withTiming(0, { duration: 2200 }));
  }, [flash, live, highlight]);
  const bg = useAnimatedStyle(() => ({ opacity: highlight.value }));

  return (
    <Animated.View entering={live ? FadeInDown.duration(220) : undefined}>
      <Pressable onLongPress={onLongPress} delayLongPress={300} style={[styles.row, c.pending && styles.rowPending]}
                 accessibilityHint={t('comments.actionsHint')}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, bg]} />
        <Pressable onPress={() => onProfile(c.user.id)} accessibilityRole="button" accessibilityLabel={name} hitSlop={6}>
          <Avatar uri={c.user.photoUrl ? thumbUrl(c.user.photoUrl) : null} name={c.user.displayName || name} size={34} fallback="color" />
        </Pressable>
        <View style={styles.flex}>
          <View style={styles.meta}>
            <Text style={styles.handle} onPress={() => onProfile(c.user.id)} numberOfLines={1}>{name}</Text>
            {!!flag && <Text style={styles.flag} accessibilityLabel={c.user.city?.name ?? undefined}>{flag}</Text>}
            {c.isAuthor && <View style={styles.authorPill}><Text style={styles.authorText}>{t('comments.author')}</Text></View>}
            {first && <View style={styles.firstPill}><Text style={styles.firstText}>{t('comments.first')}</Text></View>}
            <Text style={styles.time}>{c.pending === 'sending' ? t('comments.sending') : ago(c.createdAt, i18n.language)}</Text>
          </View>
          {c.replyTo && (
            <View style={styles.quote}>
              <Text style={styles.quoteName}>@{c.replyTo.username}</Text>
              <Text style={styles.quoteBody} numberOfLines={1}>{c.replyTo.body}</Text>
            </View>
          )}
          <Text style={styles.body}>
            {segments(c).map((s, i) => (s.userId
              ? <Text key={i} style={styles.mention} onPress={() => onProfile(s.userId!)} accessibilityRole="link">{s.text}</Text>
              : <Text key={i}>{s.text}</Text>))}
          </Text>
          {c.pending === 'failed' && (
            <View style={styles.failedRow}>
              <Text style={styles.failed} onPress={onRetry} accessibilityRole="button">{t('comments.failed')}</Text>
              <Text style={styles.discard} onPress={onDiscard} accessibilityRole="button">{t('comments.discard')}</Text>
            </View>
          )}
        </View>
        {!c.pending && <HeartButton count={c.likeCount} on={c.myLike} onPress={onLike} color={colors.red} muted={colors.muted} />}
      </Pressable>
    </Animated.View>
  );
}

/** Body split around the comment's @mentions (only resolved handles become links). */
function segments(c: PhotoComment): { text: string; userId?: string }[] {
  if (!c.mentions.length) return [{ text: c.body }];
  const byName = new Map(c.mentions.map(m => [m.username.toLowerCase(), m.userId]));
  const out: { text: string; userId?: string }[] = [];
  let last = 0;
  for (const m of c.body.matchAll(/@([A-Za-z0-9_]{1,30})/g)) {
    const uid = byName.get(m[1].toLowerCase());
    if (!uid || m.index === undefined) continue;
    if (m.index > last) out.push({ text: c.body.slice(last, m.index) });
    out.push({ text: m[0], userId: uid });
    last = m.index + m[0].length;
  }
  if (last < c.body.length) out.push({ text: c.body.slice(last) });
  return out;
}

/** "5 min ago", "yesterday"… in the app's language. */
function ago(createdAt: number, lng: string): string {
  const s = Math.max(0, Date.now() / 1000 - createdAt);
  try {
    const f = new Intl.RelativeTimeFormat(lng, { numeric: 'auto', style: 'narrow' });
    if (s < 60) return f.format(0, 'second');
    if (s < 3600) return f.format(-Math.floor(s / 60), 'minute');
    if (s < 86400) return f.format(-Math.floor(s / 3600), 'hour');
    return f.format(-Math.floor(s / 86400), 'day');
  } catch {
    return '';
  }
}

function HeartButton({ count, on, onPress, color, muted }: { count: number; on: boolean; onPress: () => void; color: string; muted: string }) {
  const { t } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const press = () => {
    if (!on) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (!reduced) scale.value = withSequence(withTiming(1.35, { duration: 120 }), withTiming(1, { duration: 180, easing: Easing.out(Easing.back(2)) }));
    }
    onPress();
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={styles.heart} accessibilityRole="button"
               accessibilityLabel={t('comments.like')} accessibilityState={{ selected: on }}>
      <Animated.View style={st}><Ionicons name={on ? 'heart' : 'heart-outline'} size={18} color={on ? color : muted} /></Animated.View>
      {count > 0 && <Text style={styles.heartCount}>{count}</Text>}
    </Pressable>
  );
}

/** The chat's round send button, with a little whoosh when it fires. */
function SendButton({ disabled, onPress, label }: { disabled: boolean; onPress: () => void; label: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: 1 - Math.abs(x.value) / 30 }));
  const press = () => {
    if (!reduced) x.value = withSequence(withTiming(24, { duration: 140 }), withTiming(-24, { duration: 1 }), withTiming(0, { duration: 160 }));
    onPress();
  };
  return (
    <TouchableOpacity style={[styles.sendWrap, disabled && styles.dim]} onPress={press} disabled={disabled}
                      accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.send}><Animated.View style={st}><Ionicons name="send" size={19} color={colors.white} /></Animated.View></View>
    </TouchableOpacity>
  );
}

function MenuRow({ icon, label, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={danger ? colors.red : colors.text} />
      <Text style={[styles.menuText, danger && { color: colors.red }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:       { paddingHorizontal: 0, gap: 0 },
  flex:        { flex: 1, minWidth: 0 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted:       { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingBottom: 10,
                 borderBottomWidth: 1, borderBottomColor: c.line },
  thumb:       { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  headerBody:  { flex: 1, minWidth: 0 },
  title:       { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  byline:      { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, marginTop: 2 },
  listWrap:    { flex: 1 },
  listContent: { paddingVertical: 8 },
  older:       { alignItems: 'center', paddingVertical: 10 },
  olderText:   { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: Spacing.lg },
  emptyBubble: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
  emptySub:    { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, textAlign: 'center' },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  rowPending:  { opacity: 0.6 },
  flash:       { backgroundColor: c.highlightBg },
  meta:        { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  handle:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.text, flexShrink: 1 },
  flag:        { fontSize: FontSizes.xs },
  time:        { fontSize: FontSizes.tiny, fontWeight: '400', color: c.mutedDim },
  authorPill:  { backgroundColor: c.primaryTint, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 1 },
  authorText:  { fontSize: FontSizes.tiny, fontWeight: '700', color: c.primaryOnTint },
  firstPill:   { backgroundColor: c.goldTint, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 1 },
  firstText:   { fontSize: FontSizes.tiny, fontWeight: '800', color: c.onGold },
  quote:       { borderLeftWidth: 3, borderLeftColor: c.line, paddingLeft: 8, marginTop: 4 },
  quoteName:   { fontSize: FontSizes.tiny, fontWeight: '700', color: c.muted },
  quoteBody:   { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  body:        { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 20, marginTop: 2 },
  mention:     { fontWeight: '700', color: c.primaryText },
  failedRow:   { flexDirection: 'row', gap: 14, marginTop: 4 },
  failed:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.red },
  discard:     { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  heart:       { alignItems: 'center', minWidth: 28, paddingTop: 4 },
  heartCount:  { fontSize: FontSizes.tiny, fontWeight: '700', color: c.muted, marginTop: 1 },
  notice:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.text, textAlign: 'center', paddingVertical: 6,
                 backgroundColor: c.bg3, marginHorizontal: Spacing.md, borderRadius: Radius.md, overflow: 'hidden' },
  chipsRow:    { flexGrow: 0 },
  chips:       { gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  chip:        { borderWidth: 1.5, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.bg },
  chipText:    { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  emoji:       { maxHeight: 220 },
  replyStrip:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: Spacing.md, paddingRight: 6, paddingVertical: 4,
                 borderTopWidth: 1, borderTopColor: c.line, borderLeftWidth: 3, borderLeftColor: c.primary },
  replyName:   { fontSize: 12, fontWeight: '700', color: c.primaryText, marginBottom: 2 },
  composer:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: Spacing.md, paddingTop: 10,
                 borderTopWidth: 1, borderTopColor: c.line },
  iconBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
  iconBtnOn:   { backgroundColor: c.primaryTint },
  inputWrap:   { flex: 1, minWidth: 0 },
  input:       { minHeight: 44, maxHeight: 120, backgroundColor: c.bg, borderRadius: 22, borderWidth: 1, borderColor: c.line,
                 paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: c.text, fontSize: 15, fontWeight: '400', lineHeight: 20 },
  counter:     { position: 'absolute', right: 12, bottom: -14, fontSize: FontSizes.tiny, fontWeight: '700', color: c.muted },
  sendWrap:    { flexShrink: 0 },
  send:        { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dim:         { opacity: 0.35 },
  menuScrim:   { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim, justifyContent: 'flex-end', borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet },
  menu:        { backgroundColor: c.bg2, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingTop: 14, paddingHorizontal: Spacing.md },
  menuQuote:   { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, paddingBottom: 8 },
  menuRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  menuText:    { fontSize: FontSizes.md, fontWeight: '600', color: c.text },
});
