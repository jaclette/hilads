# Design system (launch design pass, Phase 1)

The source of truth is `apps/mobile/src/constants.ts` (app) and the `:root` / `[data-theme]` blocks of `apps/web/src/index.css` (web). Same names, same values. Raw values are scaled once on narrow phones by `src/scaling.ts` (app) and the rem root (web). There is no `react-native-size-matters`.

## Spacing

The grid is `Space` and `--sp-*`: 4 · 8 · 12 · 16 · 24 · 32.

- **Gutter: 16 on every screen** (`Gutter`, `--gutter`). Nothing touches or crosses the screen edge except intentional full-bleed media.
- The older `Spacing` scale is snapped onto the grid: md 16 = the gutter, xs 4, sm 8, lg 24, xl 32, xxl 48.

## Type

Five roles (`Type.*`); spread one and override only the color.

| Role | Size / line | Weight | For |
|---|---|---|---|
| display | 28 / 34 | 800 | a tab's title, podium numbers |
| title | 20 / 25 | 800 | section and card titles |
| label | 17 / 22 | 800 | buttons, row and tile titles |
| body | 15 / 21 | 500 | running text |
| caption | 13 / 17 | 600 | meta, chips, counts |

- `FontSizes` points at the same five sizes.
- `tiny` (11) is for badges only. `hero` (40) is for celebration numbers only.
- Titles get `numberOfLines={2}` and a tail ellipsis, never a mid-word cut.

## Radius

| Token | Value | For |
|---|---|---|
| `control` | pill | chips, buttons, segments |
| `card` | 20 | cards |
| `hero` | 28 | the Today ticket, sheets |
| `inner` | 12 | media nested inside a card (card − 8) |

The older keys point at these: button→control, ticket/sheet→hero, sm/md→inner, lg→card.

## Elevation

`Elevation(colors, 'rest' | 'float')` / `--elev-rest`, `--elev-float`. There is one shadow color per theme (`colors.shadow`: warm ink in light, black in dark), with the softer opacity on dark grounds.
- **rest:** cards.
- **float:** bottom bars, floating buttons, sheets' peek.

## Color roles

| Role | Tokens |
|---|---|
| background / surface / surface-alt | `bg` / `bg2` / `bg3` |
| primary / on-primary | `primary` / `onPrimary` (the CTA is `cta` + `onCta`, tangerine and ink, in both themes) |
| text / text-muted | `text` / `muted` |
| border | `line` |
| success | `green` |
| selected / on-selected | `selected` / `onSelected` (peach) |

- **Selected / on-selected is THE selected state:** tab bar, segments, periods, filters. A theme filter wears its theme's own pair. Gold is for prizes only.
- **Theme pairs** (`THEME_COLORS` in `src/ui/joy.tsx`): solid `fill` + soft `tint(fill)`, text `textLight` / `textDark`. They're used the same way on chips, stamps, pins, podium accents, filters and avatar fallbacks.
- **Medals:** `medalGold #F7B733`, `medalSilver #A9C1E0`, `medalBronze #EE8F4F`, ink `onMedal` on top, the same in both themes.
- The Halloween palette (`src/features/event/seasonal.ts`) defines its own `selected` / `onSelected`.

## Icons

- Ionicons **outline** in all UI chrome: tabs, segments, chips, buttons, rows. The filled variant only for an "on" state.
- Sizes `IconSize`: sm 16 (chips, segments), md 20 (buttons, rows), lg 24 (tab bar).
- Emoji only inside sentences, where they carry the voice. Never as an icon (hearts, crown, pins, counts are icons).

## Components (`src/ui`)

| Component | Notes |
|---|---|
| `Button` | pill; primary (tangerine/ink), secondary, danger, link; md 48 / sm 44; loading, disabled |
| `Chip` | tint, filter (selected = peach, or the theme's pair), outline |
| `Segmented` | selected = peach |
| `Card` | rest elevation + hairline; ticket = hero radius; tint = flat |
| `Avatar` | photo, else ONE fallback: the initial in a theme color on its soft tint, stable per person; `AvatarSize` sm 24 / md 40 / lg 72 |
| `Badge` | the count pip: primary or soft |
| `ListRow`, `RowGroup` | rows in a card |
| `SectionTitle` | title + "See all" |
| `BottomBar` | the floating prompt: inside the gutter, CTA colors, float elevation |
| `Tappable` | the press feedback below |

## Motion

| Token | Value |
|---|---|
| `Motion.fast` | 150 ms |
| `Motion.base` | 250 ms |
| `Motion.spring` | damping 14, stiffness 220 |

- **Press:** `Tappable` scales to 0.97 on the UI thread (Reanimated) with a selection haptic. Every tappable card, tile, row and button uses it. With reduce motion: no scale, a slight dim.
- **Web:** `.tappable` (scale 0.97, plain with `prefers-reduced-motion`).
