import { api } from './client';
import type { Conversation, DmMessage, Reaction } from '@/types';

export async function fetchConversations(): Promise<Conversation[]> {
  const data = await api.get<{ dms: Conversation[] }>('/conversations');
  return data.dms ?? [];
}

export async function findOrCreateDM(
  targetUserId: string,
): Promise<{ conversation: Conversation; otherUser: { id: string; display_name: string; profile_photo_url?: string } }> {
  return api.post('/conversations/direct', { targetUserId });
}

export async function fetchDmMessages(
  conversationId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: DmMessage[]; hasMore: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: DmMessage[]; hasMore?: boolean }>(
    `/conversations/${conversationId}/messages?${q}`,
  );
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
}

export async function sendDmMessage(
  conversationId: string,
  content: string,
  replyToMessageId?: string | null,
): Promise<DmMessage> {
  const body: Record<string, unknown> = { content };
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
  const data = await api.post<{ message: DmMessage }>(
    `/conversations/${conversationId}/messages`,
    body,
  );
  return data.message;
}

export async function sendDmImageMessage(
  conversationId: string,
  imageUrl: string,
): Promise<DmMessage> {
  const data = await api.post<{ message: DmMessage }>(
    `/conversations/${conversationId}/messages`,
    { type: 'image', imageUrl },
  );
  return data.message;
}

export async function markDmRead(conversationId: string): Promise<void> {
  await api.post(`/conversations/${conversationId}/mark-read`).catch(() => {});
}

export async function toggleDmReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<Reaction[]> {
  const data = await api.post<{ reactions: Reaction[] }>(
    `/conversations/${conversationId}/messages/${messageId}/reactions`,
    { emoji },
  );
  return data.reactions;
}
