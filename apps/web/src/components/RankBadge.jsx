/**
 * Rank badge for the versus-card avatars. Web mirror of
 * apps/mobile/src/components/RankBadge.tsx.
 *
 * Two tiers:
 *   - rank 1..3 → podium medal (gold / silver / bronze gradient + soft
 *     top-left sheen + dark number for legibility on metal)
 *   - rank ≥ 4 (no cap) → neutral pill (dark disc + thin accent-orange
 *     border); only the digit changes between #4 and #347.
 *
 * Tilt -10° on both tiers so the badge reads as pinned to the avatar.
 * Null / non-positive rank → renders nothing so callers don't have
 * to branch on the no-badge path.
 *
 * Decorative — no tap target. The parent absolute-positions this on
 * top of the avatar; we just render the disc.
 */
export default function RankBadge({ rank, size = 24, ariaLabel }) {
  if (rank == null || rank < 1) return null
  const isPodium = rank <= 3
  // Shrink the digit so 1 / 2 / 3+ digit ranks all fit the same disc.
  const digits = String(rank).length
  const fontRatio =
    digits === 1 ? 0.50 :
    digits === 2 ? 0.42 :
    digits === 3 ? 0.34 :
                   0.28
  const fontSize = Math.round(size * fontRatio)

  const style = {
    width:        size,
    height:       size,
    borderRadius: size / 2,
    fontSize,
  }

  if (isPodium) {
    return (
      <span
        className={`rank-badge rank-badge--podium rank-badge--podium-${rank}`}
        style={style}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
      >
        {/* Inner highlight — small near-white slice at the top-left so
            the disc reads as polished metal rather than a flat fill.
            Pure decoration. */}
        <span
          className="rank-badge-sheen"
          style={{
            top:    size * 0.08,
            left:   size * 0.12,
            width:  size * 0.36,
            height: size * 0.18,
            borderRadius: size * 0.18,
          }}
          aria-hidden="true"
        />
        <span className="rank-badge-number">{rank}</span>
      </span>
    )
  }

  return (
    <span
      className="rank-badge rank-badge--neutral"
      style={style}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    >
      <span className="rank-badge-number">{rank}</span>
    </span>
  )
}
