import { View } from 'react-native';
import { Frame, Sticker } from './stickers';

/**
 * An event's share card frame (event mode, Halloween first): cobweb corners and
 * a few stickers around the photo, over the whole card. Pluggable in any card
 * layout: give it the card's size (pixels of the 1080-wide design, or points)
 * and draw it last. `EVENT_CARD` holds the card colors for the event.
 */

export const EVENT_CARD: Record<string, { ground: string; ground2: string; accent: string; emoji: string }> = {
  halloween: { ground: '#2A1650', ground2: '#4A1F5E', accent: '#FF8A1F', emoji: '🎃' },
};

export function EventFrame({ eventKey, width, height }: { eventKey: string; width: number; height: number }) {
  if (eventKey !== 'halloween') return null;
  const s = width * 0.2;
  const at = (left: number, top: number, rotate: number) => ({ position: 'absolute' as const, left, top, transform: [{ rotate: `${rotate}deg` }] });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <Frame id="web" width={width} height={height} />
      <View style={at(width * 0.70, height * 0.075, 14)}><Sticker id="pumpkin" size={s} /></View>
      <View style={at(width * 0.05, height * 0.43, -12)}><Sticker id="ghost" size={s * 0.9} /></View>
      <View style={at(width * 0.76, height * 0.40, 8)}><Sticker id="bat" size={s * 0.85} /></View>
    </View>
  );
}
