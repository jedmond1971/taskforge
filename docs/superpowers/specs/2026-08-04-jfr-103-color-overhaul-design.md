# JFR-103: UI Color Overhaul — Design

## Problem

`src/app/globals.css` currently uses the stock shadcn "neutral" theme: every color
token (`--background`, `--primary`, `--card`, etc.) is `oklch(x 0 0)` — zero
chroma, pure grayscale. The only exception is a stray `--sidebar-primary:
oklch(0.488 0.243 264.376)` (blue) in dark mode that doesn't relate to
anything else in the palette. Result: light mode reads as flat/white, dark
mode is generic gray-on-gray, and neither reflects the JedForge brand.

The JedForge logo (`public/logo-light.png` / `logo-dark.png`, already live in
the sidebar and dashboard shell) has a real identity: a vivid orange "F" and a
dark charcoal "J". The UI chrome around the logo doesn't match it.

## Goal

Redefine the theme tokens in `globals.css` so the app's color language matches
the brand mark, in both light and dark mode, without expanding into a
component-by-component redesign.

## Brand color source

Sampled directly from `public/logo-light.png` (clean, unantialiased regions):

| Name | sRGB | Approx. hex | OKLCH |
|---|---|---|---|
| Brand orange | `rgb(253, 100, 33)` | `#FD6421` | `oklch(0.69 0.20 40.5)` |
| Brand charcoal | `rgb(40, 43, 52)` | `#282B34` | `oklch(0.29 0.017 271)` |

**Accessibility constraint found during sampling:** the raw brand orange
against white text is only **2.99:1** contrast — fails WCAG AA (needs 4.5:1
for normal text). So the palette below splits orange into two roles:

- A **darker, button-safe orange** (`oklch(0.55 0.20 40.5)` in light mode,
  `oklch(0.72 0.19 40.5)` in dark mode with dark text) for anything that
  carries white/light text directly (primary buttons, ring).
- The **full-bright logo orange** (`oklch(0.69 0.20 40.5)`) for
  accents/badges/highlights, always paired with dark (charcoal) text, never
  white.

All pairings below were checked with a contrast-ratio script; all clear
4.5:1 (see table).

`--destructive` (`oklch(0.577 0.245 27.325)`, hue 27°) is kept unchanged and
deliberately stays hue-distinct from the brand orange (hue 40°) so error
states don't read as "brand-colored."

## Scope

**In scope:**
- The `@theme inline` token block and the `:root` / `.dark` variable
  definitions in `src/app/globals.css`.
- The `.rich-prose a` link color (light + dark) — currently a hardcoded blue
  (`oklch(0.55 0.2 264)` / `oklch(0.7 0.18 264)`) that would otherwise be the
  most visible leftover inconsistency (any issue description, comment, or doc
  page with a link).

**Out of scope (flag as follow-up JFR issue, not blocking this one):**
- Hardcoded Tailwind color classes elsewhere in components (e.g. one-off
  `bg-blue-500`-style classes for priority/status badges, kanban column
  headers, chart colors). These aren't touched by this token pass and may
  look inconsistent against the new brand tokens afterward.
- `.rich-prose` blockquote/code/`<hr>` hardcoded grays — left as-is.
- `--chart-1` through `--chart-5` — no chart-color request in scope.

## Token values

### Light mode

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.985 0.006 60)` | Warm off-white, not pure white |
| `--card` / `--popover` | `oklch(0.995 0.004 60)` | Barely-there warm tint above background |
| `--foreground` | `oklch(0.29 0.017 271)` | Brand charcoal instead of flat black |
| `--primary` | `oklch(0.55 0.20 40.5)` (~`#CA3200`) | Button-safe orange — 5.16:1 vs white text |
| `--primary-foreground` | `oklch(0.99 0 0)` | White |
| `--accent` | `oklch(0.69 0.20 40.5)` (~`#FC6421`) | Full-bright logo orange, paired with dark text only |
| `--accent-foreground` | `oklch(0.29 0.017 271)` | Charcoal — 4.70:1 on the bright accent |
| `--secondary` | `oklch(0.96 0.006 60)` | Warm neutral, mirrors `--muted` |
| `--secondary-foreground` | `oklch(0.29 0.017 271)` | Charcoal |
| `--muted` | `oklch(0.96 0.006 60)` | Warm neutral |
| `--muted-foreground` | `oklch(0.50 0.01 271)` | Muted charcoal, not muted gray |
| `--ring` | `oklch(0.55 0.20 40.5)` | Matches `--primary` |
| `--border` / `--input` | `oklch(0.90 0.01 60)` | Warm-tinted, slightly darker than background |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Unchanged |
| `--sidebar` | `oklch(0.29 0.017 271)` | Brand charcoal — sidebar is the visual anchor in light mode, echoing the two-tone logo (13.78:1 vs its foreground) |
| `--sidebar-foreground` | `oklch(0.99 0 0)` | Near-white |
| `--sidebar-primary` (active item) | `oklch(0.69 0.20 40.5)` | Brand orange |
| `--sidebar-primary-foreground` | `oklch(0.29 0.017 271)` | Charcoal |
| `--sidebar-accent` | `oklch(0.35 0.02 271)` | Slightly lighter charcoal, for hover states |
| `--sidebar-accent-foreground` | `oklch(0.99 0 0)` | Near-white |
| `--sidebar-border` | `oklch(1 0 0 / 10%)` | Translucent white, same pattern as current dark-mode borders |
| `--sidebar-ring` | `oklch(0.69 0.20 40.5)` | Brand orange |
| `.rich-prose a` | `oklch(0.55 0.20 40.5)` | Brand orange (was blue `oklch(0.55 0.2 264)`) |

### Dark mode

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.20 0.012 271)` | Charcoal-tinted dark, not neutral black |
| `--card` / `--popover` | `oklch(0.25 0.014 271)` | Lifted above background, same warm-neutral hue family |
| `--foreground` | `oklch(0.97 0.006 60)` | Warm near-white |
| `--primary` | `oklch(0.72 0.19 40.5)` (~`#FF7239`) | Brighter than light-mode primary — needs more luminance to read as vivid on a dark background |
| `--primary-foreground` | `oklch(0.18 0.01 271)` | Dark charcoal text — 6.93:1 on the bright orange |
| `--accent` | `oklch(0.68 0.18 40.5)` | Slightly dimmer orange for badges/highlights |
| `--accent-foreground` | `oklch(0.18 0.01 271)` | Dark charcoal |
| `--secondary` | `oklch(0.28 0.014 271)` | Warm-neutral dark |
| `--secondary-foreground` | `oklch(0.97 0.006 60)` | Warm near-white |
| `--muted` | `oklch(0.28 0.014 271)` | Warm-neutral dark |
| `--muted-foreground` | `oklch(0.70 0.01 271)` | Muted warm gray |
| `--ring` | `oklch(0.72 0.19 40.5)` | Matches `--primary` |
| `--border` / `--input` | `oklch(1 0 0 / 12%)` | Unchanged pattern — already works |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Unchanged |
| `--sidebar` | `oklch(0.145 0.01 271)` | Darkest surface in the app — sidebar reads as the frame (18.09:1 vs its foreground) |
| `--sidebar-foreground` | `oklch(0.97 0.006 60)` | Warm near-white |
| `--sidebar-primary` (active item) | `oklch(0.72 0.19 40.5)` | Brand orange — **replaces the current stray unrelated blue** |
| `--sidebar-primary-foreground` | `oklch(0.18 0.01 271)` | Dark charcoal |
| `--sidebar-accent` | `oklch(0.22 0.014 271)` | Slightly lighter than sidebar bg, for hover states |
| `--sidebar-accent-foreground` | `oklch(0.97 0.006 60)` | Warm near-white |
| `--sidebar-border` | `oklch(1 0 0 / 10%)` | Unchanged pattern |
| `--sidebar-ring` | `oklch(0.72 0.19 40.5)` | Brand orange |
| `.rich-prose a` | `oklch(0.72 0.19 40.5)` | Brand orange (was blue `oklch(0.7 0.18 264)`) |

## Contrast verification

All text-bearing pairings above were checked against WCAG AA (4.5:1 normal
text / 3:1 large text or UI components) using a script converting OKLCH →
sRGB → relative luminance:

| Pairing | Contrast |
|---|---|
| Light `--primary` bg vs white text | 5.16:1 |
| Light `--accent` bg vs charcoal text | 4.70:1 |
| Light sidebar bg vs sidebar text | 13.78:1 |
| Dark `--primary` bg vs charcoal text | 6.93:1 |
| Dark sidebar bg vs sidebar text | 18.09:1 |

`--chart-*` tokens are unchanged (out of scope) and not re-verified.

## Implementation

Single-file change: `src/app/globals.css`, editing the `:root` and `.dark`
blocks under `@layer base`, plus the two `.rich-prose a` / `.dark .rich-prose
a` rules. No component files change — everything else already consumes these
CSS variables via Tailwind's `@theme inline` mapping.

## Testing / verification plan

1. Run the dev server, check both themes on: dashboard, kanban board, issue
   detail (including a comment/description with a link, to verify the
   rich-prose color), sidebar (collapsed and expanded).
2. Re-run the contrast-ratio check for any token value that gets tweaked
   during implementation (e.g. if a color needs adjusting after visual
   review) to confirm it still clears AA before finalizing.
3. Manual visual check that `--destructive` (delete buttons, error toasts)
   still reads clearly as "error," not "brand," next to the new orange.

## Out of scope / follow-up

File a JFR follow-up issue for a component-level color sweep (hardcoded
Tailwind color classes for priority/status badges, kanban columns, charts)
once this token pass is live and validated — not blocking this issue.
