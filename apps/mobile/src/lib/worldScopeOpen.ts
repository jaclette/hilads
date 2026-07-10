/**
 * One-shot signal: "open the chat tab in World scope next time it's focused".
 *
 * A World-channel mention push deep-links to the chat tab (/(tabs)/chat), but
 * that tab is a persistent, already-mounted route that defaults to city scope -
 * a plain navigation wouldn't switch it to World. The push handler sets this
 * flag; the chat tab consumes it on focus and calls switchScope('world') so the
 * user lands on the exact channel they were mentioned in.
 */

let pending = false;

export function requestWorldScopeOpen(): void {
  pending = true;
}

/** Returns true once (and clears) if a World-scope open was requested. */
export function consumeWorldScopeOpen(): boolean {
  const p = pending;
  pending = false;
  return p;
}
