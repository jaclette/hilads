/**
 * One-shot signal: "the city feed should reload next time it's focused".
 *
 * useShareToCity posts a message into the city channel from another screen
 * (topic/event/challenge) and then navigates to the city tab. That tab is
 * already mounted, so it won't refetch on its own, and the WS echo may not
 * reach it (the socket was in the other room when the message was posted) -
 * so the freshly shared message wouldn't appear until a manual reload. We set
 * this flag on share and have the city tab consume it on focus.
 */

let pending = false;

export function requestCityFeedRefresh(): void {
  pending = true;
}

/** Returns true once (and clears) if a refresh was requested. */
export function consumeCityFeedRefresh(): boolean {
  const p = pending;
  pending = false;
  return p;
}
