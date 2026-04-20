/**
 * reactionEmitter — singleton pub/sub for reaction burst animations.
 *
 * Decouples the animation trigger from the message list state so that
 * animations can be fired without re-rendering the entire feed.
 *
 * Usage:
 *   // trigger (from reaction tap or WS event):
 *   reactionEmitter.emit(messageId, type)
 *
 *   // subscribe (inside each ChatMessage):
 *   const unsub = reactionEmitter.on(messageId, type => { ... })
 */

export type ReactionType = 'heart' | 'like' | 'laugh' | 'wow' | 'fire';

export const EMOJI_TO_TYPE: Record<string, ReactionType> = {
  '❤️': 'heart',
  '👍': 'like',
  '😂': 'laugh',
  '😮': 'wow',
  '🔥': 'fire',
};

type BurstHandler = (type: ReactionType) => void;

class ReactionEmitter {
  private listeners = new Map<string, Set<BurstHandler>>();

  on(messageId: string, handler: BurstHandler): () => void {
    if (!this.listeners.has(messageId)) {
      this.listeners.set(messageId, new Set());
    }
    this.listeners.get(messageId)!.add(handler);
    return () => {
      this.listeners.get(messageId)?.delete(handler);
      if (this.listeners.get(messageId)?.size === 0) {
        this.listeners.delete(messageId);
      }
    };
  }

  emit(messageId: string, type: ReactionType): void {
    this.listeners.get(messageId)?.forEach(h => h(type));
  }
}

export const reactionEmitter = new ReactionEmitter();
