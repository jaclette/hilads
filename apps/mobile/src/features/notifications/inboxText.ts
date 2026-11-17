import { shortCityName } from '@/i18n/cityName';
import type { InboxItem } from '@/api/notifications';
import { calendarDaysAgo, parseTime } from './NotifRow';
import { COMMENT_TYPES, commentLine } from './commentLine';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** A row's sentence, split so the names render bold: [{text, bold}], and an optional quote (a comment). */
export type RowText = { parts: { text: string; bold: boolean }[]; quote: string | null };

const MARK = '\u0001';

/** "Lan", "Lan and Minh", "Lan and 3 others". */
export function namesOf(item: InboxItem, t: TFn): string {
  const a = item.actors;
  if (!a.length) return '';
  if (item.count <= 1 || a.length === 1 && item.count <= 1) return a[0].name;
  if (item.count === 2 && a[1]) return t('inbox.names.two', { a: a[0].name, b: a[1].name });
  return t('inbox.names.many', { a: a[0].name, count: item.count - 1 });
}

/** The key of the sentence for a type, or null (the server's title and body are shown as they are). */
function keyOf(item: InboxItem): string | null {
  switch (item.type) {
    case 'daily_vote':              return 'like';
    case 'mention':
    case 'city_here':               return 'mention';
    case 'friend_request_received': return 'friendRequest';
    case 'friend_request_accepted':
    case 'friend_added':            return 'friendAccepted';
    case 'profile_view':            return 'profileView';
    case 'vibe_received':           return 'vibe';
    case 'event_join':              return item.data.eventTitle ? 'planJoin' : null;
    case 'join_request':            return item.data.topicTitle ? 'joinRequest' : null;
    case 'join_request_accepted':   return item.data.topicTitle ? 'joinAccepted' : null;
    case 'city_join':               return item.count > 1 ? 'landedMany' : 'landed';
    case 'world_arrival':           return 'landed';
    default:                        return null;
  }
}

/**
 * The sentence of an inbox item, from its type, actors and data, in the UI
 * language ("**Lan** and 3 others liked your photo"); game rows lead with
 * their emoji. Unknown types keep the server's title (bold) and body.
 */
export function rowText(item: InboxItem, t: TFn): RowText {
  const d = item.data ?? {};
  const city = shortCityName(d.cityName ?? '');
  const plain = (text: string): RowText => ({ parts: [{ text, bold: false }], quote: null });

  if (item.type === 'daily_result') return { parts: [{ text: t('inbox.row.result'), bold: true }], quote: item.body };
  if (item.type === 'daily_local_pass') return plain(t('inbox.row.localPass', { city }));
  if (item.type === 'daily_rank') {
    return plain(d.scope === 'world' ? t('inbox.row.rankUpWorld', { rank: d.rank }) : t('inbox.row.rankUp', { rank: d.rank, where: city }));
  }

  // Comments on Daily photos: the same line as the Today card and the push (commentLine), the actor's name in bold.
  if (COMMENT_TYPES.includes(item.type)) {
    const parts: RowText['parts'] = [];
    commentLine(item, t, MARK).split(MARK).forEach((chunk, i) => {
      if (i > 0) parts.push({ text: item.actors[0]?.name ?? d.actorName ?? '', bold: true });
      if (chunk) parts.push({ text: chunk, bold: false });
    });
    return { parts, quote: item.body };
  }

  const key = keyOf(item);
  const names = namesOf(item, t);
  if (key === null || (!names && key !== 'joinAccepted' && key !== 'landedMany')) {
    return { parts: [{ text: item.title, bold: true }], quote: item.body };
  }
  const sentence = t(`inbox.row.${key}`, {
    names: MARK, count: item.count, city,
    plan: d.eventTitle ?? d.topicTitle ?? '',
  });
  const parts: RowText['parts'] = [];
  sentence.split(MARK).forEach((chunk, i) => {
    if (i > 0) parts.push({ text: names, bold: true });
    if (chunk) parts.push({ text: chunk, bold: false });
  });
  const quoted = key === 'mention' ? item.body : null;
  return { parts, quote: quoted };
}

/** Which section of the list an item falls in: unseen first, then by day. */
export type SectionKey = 'new' | 'today' | 'yesterday' | 'week' | 'earlier';
export function sectionOf(item: InboxItem, now = new Date()): SectionKey {
  if (!item.seen && !item.read) return 'new';
  // By calendar day in the phone's time zone, the same count as the row's "1d" (relativeTime).
  const ms = parseTime(item.created_at);
  if (isNaN(ms)) return 'earlier';
  const diff = calendarDaysAgo(ms, now);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? 'week' : 'earlier';
}
