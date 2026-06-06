import { useState } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ScoringInfoModal } from '@/features/challenge/ScoringInfoModal';

/**
 * Round "i" button that opens the challenge scoring info modal. Owns its
 * own modal state so callers can drop it anywhere as <ScoringInfoButton />
 * without managing visibility upstream.
 *
 * Amber tint matches the leaderboard chip — visually links "info" with
 * "points / scoring" across the app.
 */
export function ScoringInfoButton({ size = 22 }: { size?: number }) {
  const { t } = useTranslation('challenge');
  const [open, setOpen] = useState(false);
  return (
    <>
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
});
