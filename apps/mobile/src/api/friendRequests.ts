import { api } from './client';
import type { FriendRequest } from '@/types';

/**
 * Friend-request API wrappers — one per endpoint. The server handles the
 * mutual-add short-circuit, so `sendFriendRequest` may return either a fresh
 * `request` (status: pending) OR `friend: true` (auto-accepted because the
 * other user had already sent us a pending request). Callers should branch on
 * `friend === true` to flip straight to "Friends" without going through
 * "Request sent".
 */

export interface SendFriendRequestResult {
  ok:       true;
  friend?:  boolean;
  request?: FriendRequest;
}

export async function sendFriendRequest(userId: string): Promise<SendFriendRequestResult> {
  return api.post<SendFriendRequestResult>(`/users/${userId}/friends`, {});
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  await api.post(`/friend-requests/${requestId}/accept`, {});
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await api.post(`/friend-requests/${requestId}/decline`, {});
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  await api.delete(`/friend-requests/${requestId}`);
}

export async function fetchIncomingFriendRequests(): Promise<FriendRequest[]> {
  const data = await api.get<{ requests: FriendRequest[] }>('/friend-requests/incoming');
  return data.requests ?? [];
}

export async function fetchOutgoingFriendRequests(): Promise<FriendRequest[]> {
  const data = await api.get<{ requests: FriendRequest[] }>('/friend-requests/outgoing');
  return data.requests ?? [];
}

export async function fetchIncomingFriendRequestCount(): Promise<number> {
  const data = await api.get<{ count: number }>('/friend-requests/incoming-count');
  return data.count ?? 0;
}
