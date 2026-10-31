import { thumbUrl } from '@/lib/imageThumb';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UserDTO, BadgeKey } from '@/types';
import { BADGE_META } from '@/types';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Chip, Sheet, SheetScrollView } from '@/ui';

// Bottom-sheet list of members/attendees (a plan's "going", a hangout's
// members). Tapping a registered member opens their profile; guests are inert.

type Props = {
  visible:      boolean;
  loading:      boolean;
  participants: UserDTO[];
  count:        number;
  noun:         string;   // "going" (events) | "in this hangout" (hangouts)
  /** Overrides the "{count} {noun}" title (a plural-aware string). */
  title?:       string;
  /** Shown when nobody is in the list. */
  emptyText?:   string;
  onClose:      () => void;
  onSelect:     (userId: string) => void;
};

export function MembersSheet({ visible, loading, participants, count, noun, title, emptyText, onClose, onSelect }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('close')} style={styles.sheet}>
      <Text style={styles.title} accessibilityRole="header">{title ?? `${count} ${noun}`}</Text>

      <SheetScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.muted} style={styles.loading} />
        ) : participants.length === 0 ? (
          <Text style={styles.empty}>{emptyText ?? t('membersEmpty')}</Text>
        ) : (
          participants.map(p => {
            const isRegistered = p.accountType === 'registered';
            const badgeKey: BadgeKey | undefined = p.badges?.[0];
            const badgeMeta = badgeKey ? BADGE_META[badgeKey] : null;
            const avatar = p.thumbAvatarUrl ?? p.avatarUrl ?? null;
            return (
              <TouchableOpacity
                key={p.id}
                style={styles.row}
                onPress={isRegistered ? () => onSelect(p.id) : undefined}
                activeOpacity={isRegistered ? 0.7 : 1}
                disabled={!isRegistered}
                accessibilityRole={isRegistered ? 'button' : undefined}
              >
                <Avatar uri={avatar ? thumbUrl(avatar) : null} name={p.displayName ?? '?'} size={40} fallback="color" />
                <View style={styles.rowInfo}>
                  <Text style={styles.name} numberOfLines={1}>{p.displayName}</Text>
                  {p.username ? <Text style={styles.handle} numberOfLines={1}>@{p.username}</Text> : null}
                </View>
                {badgeKey && badgeMeta && <Chip label={t(`badge.${badgeKey}`, { defaultValue: badgeMeta.label })} />}
              </TouchableOpacity>
            );
          })
        )}
      </SheetScrollView>
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:       { maxHeight: '72%' },
  title:       { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, paddingVertical: 4 },
  list:        { flexGrow: 0 },
  listContent: { paddingBottom: Spacing.sm },
  loading:     { marginVertical: Spacing.lg },
  empty:       { fontSize: FontSizes.sm, fontWeight: '500', color: c.muted, textAlign: 'center', marginVertical: Spacing.lg },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
  rowInfo:     { flex: 1 },
  name:        { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  handle:      { fontSize: FontSizes.sm, fontWeight: '500', color: c.muted },
});
