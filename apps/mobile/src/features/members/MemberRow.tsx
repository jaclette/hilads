import { memo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, Elevation, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Avatar, CityFlag, ModeLabel, Tappable } from '@/ui';
import type { Member, WaveSource } from '@/api/members';
import { WaveButton } from './WaveButton';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The one contextual line: up to two facts, the most telling first. New arrivals say so;
 * otherwise a streak of 2+ days; then duels with me, else "friend", else their photos.
 * World rows lead with the city. Never a last-seen time.
 */
export function memberLine(m: Member, t: TFn, world: boolean): string {
  const parts: string[] = [];
  if (world && m.city) parts.push(m.city.last ? t('line.lastIn', { city: m.city.name }) : m.city.name);
  else if (world && m.noCity) parts.push(t('line.noCity'));
  if (m.joinedDays !== null && m.joinedDays <= 7) {
    parts.push(m.joinedDays === 0 ? t('line.joinedToday') : m.joinedDays === 1 ? t('line.joinedYesterday') : t('line.joinedDays', { count: m.joinedDays }));
  } else if (m.streak >= 2) {
    parts.push(t('line.streak', { count: m.streak }));
  }
  if (m.duels > 0) parts.push(t('line.duels', { count: m.duels }));
  else if (m.friend) parts.push(t('line.friend'));
  else if (m.photos > 0 && parts.length < (world ? 3 : 2)) parts.push(t('line.photos', { count: m.photos }));
  return parts.join(' · ');
}

/**
 * A member in a list (shared: Members, and later plan attendees and like lists): avatar
 * with the online dot, @handle (World: the city's flag first), the Local / Traveler tag,
 * one contextual line, and the Wave button. Long press: report or block.
 */
export const MemberRow = memo(function MemberRow({ member, world = false, source = 'members', showWave = true, onPress, onLongPress }: {
  member: Member;
  world?: boolean;
  source?: WaveSource;
  showWave?: boolean;
  onPress: (m: Member) => void;
  onLongPress?: (m: Member) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('members');
  const tDaily = useTranslation('daily').t;
  const line = memberLine(member, t, world);
  const tag = member.mode === 'local' ? tDaily('local') : member.mode === 'traveler' ? tDaily('traveler') : null;
  const a11y = [member.displayName, member.here ? t('hereNow') : null, tag, line].filter(Boolean).join(', ');

  return (
    <Tappable style={styles.row} onPress={() => onPress(member)} onLongPress={onLongPress ? () => onLongPress(member) : undefined}
              accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={t('rowHint')} testID="member-row">
      <View>
        <Avatar uri={member.photo} name={member.displayName} size={44} />
        {member.here && <View style={styles.dot} />}
      </View>
      <View style={styles.body}>
        <View style={styles.nameLine}>
          {world && member.city?.country ? <CityFlag country={member.city.country} size={14} /> : null}
          <Text style={styles.name} numberOfLines={1}>{member.displayName}</Text>
          {member.isNew && <Text style={styles.newTag}>{t('newTag')}</Text>}
          {member.mode && tag && <ModeLabel small mode={member.mode} label={tag} />}
        </View>
        {!!line && <Text style={styles.line} numberOfLines={1}>{line}</Text>}
      </View>
      {showWave && member.canWave !== false && (
        <WaveButton user={member} initial={member.wave} source={source} testID="member-wave" />
      )}
    </Tappable>
  );
});

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 64, paddingVertical: Space.sm, paddingHorizontal: Space.md,
              borderRadius: Radius.card, backgroundColor: c.bg2, ...Elevation(c, 'rest') },
  dot:      { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: c.green, borderWidth: 2.5, borderColor: c.bg2 },
  body:     { flex: 1, minWidth: 0, gap: Space.xxs },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  name:     { ...Type.label, fontSize: 15, flexShrink: 1, color: c.text },
  line:     { ...Type.caption, color: c.muted },
  newTag:   { fontSize: 11, lineHeight: 16, fontWeight: '800', color: c.onGold, backgroundColor: c.gold, borderRadius: Radius.control,
              paddingHorizontal: Space.sm, overflow: 'hidden' },
});
