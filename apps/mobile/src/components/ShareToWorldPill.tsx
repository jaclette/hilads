/**
 * ShareToWorldPill - one-tap secondary button (globe) that posts an
 * INTERNATIONAL challenge's deeplink into the global World channel (see
 * useShareToWorld). Sibling of ShareToCityPill; shown only for international
 * challenges so their owner can spread them worldwide, not just in their own
 * city.
 */

import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useShareToWorld } from '@/lib/useShareToWorld';
import { Button } from '@/ui';

interface Props {
  url: string;
  /** Entity title, posted after the label above the link for context. */
  title?: string;
  /** Type prefix incl. emoji, e.g. "🌍 International Challenge 🇻🇳 → 🇧🇷". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function ShareToWorldPill({ url, title, label, style }: Props) {
  const { t } = useTranslation('common');
  const { canShare, sharing, shareToWorld } = useShareToWorld();
  if (!canShare) return null;

  const btnLabel = t('shareToWorld', { defaultValue: 'Share on World' });
  const head = [label?.trim(), title?.trim()].filter(Boolean).join(': ');
  const message = head ? `${head}\n${url}` : url;
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="globe-outline"
      label={btnLabel}
      onPress={() => shareToWorld(message)}
      loading={sharing}
      style={style}
    />
  );
}
