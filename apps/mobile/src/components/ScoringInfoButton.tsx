import { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ScoringInfoModal } from '@/features/challenge/ScoringInfoModal';

/**
 * Opens the challenge scoring info modal. Owns its own modal state so callers
 * can drop it anywhere without managing visibility upstream.
 *
 *   <ScoringInfoButton />          → bare round "i" (channel header, NOW)
 *   <ScoringInfoButton labeled />  → "🏆 How to earn points" pill, for
 *                                    surfaces where the bare (i) is too easy
 *                                    to miss (the challenges browser).
 *
 * Amber tint matches the leaderboard chip - visually links "info" with
 * "points / scoring" across the app.
 */
export function ScoringInfoButton({ size = 22, labeled = false }: { size?: number; labeled?: boolean }) {
  const { t } = useTranslation('challenge');
  const [open, setOpen] = useState(false);
  return (
    <>
      {labeled ? (
        <TouchableOpacity
          style={styles.pill}
          onPress={() => setOpen(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('scoringInfo.aria')}
        >
          <Text style={styles.pillText}>{t('scoringInfo.helpLabel')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }]}
          onPress={() => setOpen(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={t('scoringInfo.aria')}
        >
          <Ionicons
            name="information-circle-outline"
            size={size - 2}
            color="#FFC93C"
          />
        </TouchableOpacity>
      )}
      <ScoringInfoModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(255,201,60,0.10)',
    borderWidth:     1,
    borderColor:     'rgba(255,201,60,0.30)',
  },
  pill: {
    alignSelf:         'flex-start',
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      999,
    backgroundColor:   'rgba(255,201,60,0.10)',
    borderWidth:       1,
    borderColor:       'rgba(255,201,60,0.30)',
  },
  pillText: { fontSize: 12, fontWeight: '800', color: '#FFC93C', letterSpacing: 0.2 },
});
