import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

/**
 * Info-only sheet explaining the challenge scoring schedule. No CTAs —
 * tap the backdrop or pull down to dismiss.
 *
 * Numbers come from score_rules in migrate.php (5 / 30 / 40). If those
 * change, update the i18n labels OR plumb the values from a /scoring
 * endpoint; for now they're constant so hard-coded is fine.
 *
 * Mounted by ScoringInfoButton (NOW + challenge detail share the same
 * surface). All 4 pipeline steps are rendered so the user can map the
 * info row 1:1 against the pipeline they see on the channel screen —
 * the two middle steps just show "—" instead of points.
 */
export function ScoringInfoModal({
  visible, onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('challenge');

  // Step rows in pipeline order. Numbers mirror score_rules in migrate.php
  // (PR12). null = no scoring at that step. The "Meet up" pipeline step is
  // omitted from this table because it never awards points — keep the
  // pipeline visual but skip the noise here.
  const steps: Array<{
    icon:        string;
    labelKey:    string;
    challenger:  number | null;
    taker:       number | null;
  }> = [
    { icon: '🤝', labelKey: 'scoringInfo.steps.accepted', challenger: 5,  taker: null },
    { icon: '📅', labelKey: 'scoringInfo.steps.date',     challenger: 5,  taker: 5    },
    { icon: '⭐', labelKey: 'scoringInfo.steps.rate',     challenger: 30, taker: 40   },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>{t('scoringInfo.title')}</Text>
          <Text style={styles.intro}>{t('scoringInfo.intro')}</Text>

          <View style={styles.headerRow}>
            <Text style={styles.headerStep}>{t('scoringInfo.colStep')}</Text>
            <Text style={styles.headerCol}>{t('badge.challenger')}</Text>
            <Text style={styles.headerCol}>{t('badge.taker')}</Text>
          </View>

          {steps.map((s) => (
            <View key={s.labelKey} style={styles.row}>
              <Text style={styles.rowIcon}>{s.icon}</Text>
              <Text style={styles.rowLabel} numberOfLines={1}>{t(s.labelKey)}</Text>
              <Text style={[styles.rowPoints, s.challenger === null && styles.rowPointsMuted]}>
                {s.challenger === null ? t('scoringInfo.noPoints') : `+${s.challenger}`}
              </Text>
              <Text style={[styles.rowPoints, s.taker === null && styles.rowPointsMuted]}>
                {s.taker === null ? t('scoringInfo.noPoints') : `+${s.taker}`}
              </Text>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('scoringInfo.totalLabel')}</Text>
            <Text style={styles.totalValue}>40</Text>
            <Text style={styles.totalValue}>45</Text>
          </View>

          <Text style={styles.footnote}>{t('scoringInfo.footnote')}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '85%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4,
  },
  scrollContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },

  title:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  intro:  { fontSize: FontSizes.sm, color: Colors.muted, marginBottom: Spacing.sm },

  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    marginTop: 4,
  },
  headerStep: { flex: 1, fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted2, letterSpacing: 0.4, textTransform: 'uppercase' },
  headerCol:  { width: 64, fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted2, letterSpacing: 0.4, textTransform: 'uppercase', textAlign: 'right' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
  },
  rowIcon:   { width: 26, fontSize: 16 },
  rowLabel:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text },
  rowPoints: { width: 64, fontSize: FontSizes.sm, fontWeight: '800', color: '#FF7A3C', textAlign: 'right' },
  rowPointsMuted: { color: Colors.muted2, fontWeight: '600' },

  totalRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  totalLabel: { flex: 1, fontSize: FontSizes.sm, fontWeight: '800', color: Colors.text },
  totalValue: { width: 64, fontSize: FontSizes.md, fontWeight: '800', color: '#FFC93C', textAlign: 'right' },

  footnote: { marginTop: Spacing.sm, fontSize: FontSizes.xs, color: Colors.muted2, fontStyle: 'italic' },
});
