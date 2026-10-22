import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import { Avatar, Sheet } from '@/ui';
import { fetchDailyVoters, type DailyVoter } from '@/api/daily';

/** Who voted for my photo: opened from the heart on my own photo. A row opens that person's profile. */
export function DailyVotersSheet({ proofId, onOpenUser, onClose }: {
  proofId: string | null; onOpenUser: (userId: string) => void; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const [voters, setVoters] = useState<DailyVoter[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!proofId) return;
    setVoters(null);
    setFailed(false);
    fetchDailyVoters(proofId).then(setVoters).catch(() => setFailed(true));
  }, [proofId]);

  return (
    <Sheet visible={!!proofId} onClose={onClose} closeLabel={t('back')} style={styles.sheet}>
      <Text style={styles.title}>{t('vote.votersTitle')}</Text>
      {failed ? <Text style={styles.empty}>{t('errors.generic')}</Text>
        : voters === null ? <ActivityIndicator color={colors.primary} style={styles.loading} />
        : voters.length === 0 ? <Text style={styles.empty}>{t('vote.votersEmpty')}</Text>
        : (
          <ScrollView style={styles.list} testID="voters-list">
            {voters.map(v => {
              const name = v.displayName || v.username;
              return (
                <TouchableOpacity key={v.id} style={styles.row} onPress={() => onOpenUser(v.id)} activeOpacity={0.7} testID="voter-row">
                  <Avatar uri={v.photoUrl} name={name} size={40} />
                  <View style={styles.text}>
                    <Text style={styles.name} numberOfLines={1}>{name}</Text>
                    {!!v.city && <Text style={styles.city} numberOfLines={1}>{shortCityName(v.city)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:   { maxHeight: '75%' },
  title:   { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  list:    { flexGrow: 0 },
  loading: { marginVertical: 24 },
  empty:   { fontSize: FontSizes.sm, color: c.muted, marginVertical: 12 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: c.line },
  text:    { flex: 1 },
  name:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  city:    { fontSize: FontSizes.xs, color: c.muted },
});
