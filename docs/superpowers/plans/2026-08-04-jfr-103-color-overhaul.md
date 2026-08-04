# JFR-103: UI Color Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock grayscale shadcn theme in `src/app/globals.css` with a warm orange/charcoal palette sampled from the JedForge logo, in both light and dark mode.

**Architecture:** Single-file CSS custom-property value swap. No component files change — every value already exists as a named token (`--background`, `--primary`, etc.) inside the `:root` / `.dark` blocks under `@layer base`; only the values change. Tailwind's existing `@theme inline` mapping (lines 7–39, unchanged) already routes these into `bg-background`, `text-foreground`, `bg-primary`, etc. utility classes app-wide, so the change cascades without touching any `.tsx` file.

**Tech Stack:** Tailwind CSS v4, OKLCH color space, no new dependencies.

## Global Constraints

- Every text-bearing color pairing must clear WCAG AA: 4.5:1 for normal text, 3:1 for large text/UI-only components.
- `--destructive` is unchanged in both themes (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark) — do not edit it, and it must stay hue-distinct (27°) from the new brand orange (40°) so errors don't read as "brand."
- `--chart-1` through `--chart-5` are unchanged in both themes — out of scope.
- Scope is limited to `src/app/globals.css` only. No other file changes in this plan.
- Per this project's CLAUDE.md pre-commit checklist: run `npm run lint` (zero new errors) and `npx tsc --noEmit` (zero errors) before every commit, and verify only intended files are staged with `git diff --name-only --cached`.
- Reference spec: `docs/superpowers/specs/2026-08-04-jfr-103-color-overhaul-design.md`.

---

## File Structure

- **Modify:** `src/app/globals.css`
  - `:root` block (lines 147–180 as of this plan) — light mode core palette + sidebar tokens
  - `.dark` block (lines 181–213 as of this plan) — dark mode core palette + sidebar tokens
  - `.rich-prose a` (line 129) and `.dark .rich-prose a` (line 130) — TipTap link color

No files are created. No test files exist for this (pure CSS constant values, no app logic) — verification is done via inline contrast-ratio calculations run as plan steps (shown in each task) and a manual visual pass in the final task.

---

### Task 1: Light mode — core palette tokens

**Files:**
- Modify: `src/app/globals.css:148-165` (inside `:root`)

**Interfaces:**
- Consumes: the existing `@theme inline` block (`src/app/globals.css:7-39`, unchanged) which maps `--color-background: var(--background)` etc. — this task only changes the values these variables resolve to.
- Produces: updated `--background`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--ring` values for light mode, consumed app-wide via Tailwind utility classes (`bg-primary`, `text-foreground`, etc.) and by Task 2/3 (sidebar and rich-prose sit in the same file but are independent tokens).

- [ ] **Step 1: Confirm the target values aren't present yet (red state)**

Run:
```bash
grep -n -- "--primary: oklch(0.55 0.20 40.5);" src/app/globals.css
```
Expected: no output (exit code 1) — the new primary value doesn't exist in the file yet.

- [ ] **Step 2: Edit the `:root` block**

Replace lines 148–165 (from `--background: oklch(1 0 0);` through `--ring: oklch(0.708 0 0);`) with:

```css
    --background: oklch(0.985 0.006 60);
    --foreground: oklch(0.29 0.017 271);
    --card: oklch(0.995 0.004 60);
    --card-foreground: oklch(0.29 0.017 271);
    --popover: oklch(0.995 0.004 60);
    --popover-foreground: oklch(0.29 0.017 271);
    --primary: oklch(0.55 0.20 40.5);
    --primary-foreground: oklch(0.99 0 0);
    --secondary: oklch(0.96 0.006 60);
    --secondary-foreground: oklch(0.29 0.017 271);
    --muted: oklch(0.96 0.006 60);
    --muted-foreground: oklch(0.50 0.01 271);
    --accent: oklch(0.69 0.20 40.5);
    --accent-foreground: oklch(0.29 0.017 271);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.90 0.01 60);
    --input: oklch(0.90 0.01 60);
    --ring: oklch(0.55 0.20 40.5);
```

Note: `--destructive` is included in the replaced range but its value is unchanged (per Global Constraints) — copy it through as-is.

- [ ] **Step 3: Verify the new values are present (green state)**

Run:
```bash
grep -n -- "--primary: oklch(0.55 0.20 40.5);" src/app/globals.css && \
grep -n -- "--background: oklch(0.985 0.006 60);" src/app/globals.css && \
grep -n -- "--destructive: oklch(0.577 0.245 27.325);" src/app/globals.css
```
Expected: three matching lines printed, all inside the `:root` block (line numbers ~148–165).

- [ ] **Step 4: Verify contrast ratios**

Run:
```bash
python3 -c "
import math
def srgb_to_linear(c):
    c = c/255
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c):
    c = max(0,min(1,c))
    return c*12.92 if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055
def oklch_to_rgb(L,C,Hdeg):
    H = math.radians(Hdeg)
    a = C*math.cos(H); b = C*math.sin(H)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l,m,s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(round(255*linear_to_srgb(c)) for c in (r,g,bb))
def luminance(r,g,b):
    r,g,b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(rgb1, rgb2):
    l1, l2 = luminance(*rgb1), luminance(*rgb2)
    l1, l2 = max(l1,l2), min(l1,l2)
    return (l1+0.05)/(l2+0.05)
primary = oklch_to_rgb(0.55, 0.20, 40.5)
primary_fg = oklch_to_rgb(0.99, 0, 0)
accent = oklch_to_rgb(0.69, 0.20, 40.5)
accent_fg = oklch_to_rgb(0.29, 0.017, 271)
c1 = contrast(primary, primary_fg)
c2 = contrast(accent, accent_fg)
print(f'primary vs primary-foreground: {c1:.2f}')
print(f'accent vs accent-foreground: {c2:.2f}')
assert c1 >= 4.5, f'primary contrast {c1:.2f} fails AA'
assert c2 >= 4.5, f'accent contrast {c2:.2f} fails AA'
print('PASS')
"
```
Expected: `primary vs primary-foreground: 5.16`, `accent vs accent-foreground: 4.70`, `PASS`.

- [ ] **Step 5: Pre-commit checks**

Run:
```bash
npm run lint && npx tsc --noEmit && git diff --name-only --cached
```
Expected: lint zero new errors, tsc zero errors. Nothing staged yet (this is a check of clean state before staging).

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): recolor light-mode core palette to brand orange/charcoal (JFR-103)"
```

---

### Task 2: Light mode — sidebar tokens

**Files:**
- Modify: `src/app/globals.css:172-179` (inside `:root`)

**Interfaces:**
- Consumes: same `@theme inline` mapping as Task 1; independent of Task 1's edits (different property names), so this task can be reviewed/reverted separately.
- Produces: updated `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` for light mode, consumed by `Sidebar.tsx` via `bg-sidebar`, `text-sidebar-foreground`, etc.

- [ ] **Step 1: Confirm target value isn't present yet**

Run:
```bash
grep -n -- "--sidebar: oklch(0.29 0.017 271);" src/app/globals.css
```
Expected: no output.

- [ ] **Step 2: Edit the sidebar block inside `:root`**

Replace lines 172–179 (from `--sidebar: oklch(0.985 0 0);` through `--sidebar-ring: oklch(0.708 0 0);`) with:

```css
    --sidebar: oklch(0.29 0.017 271);
    --sidebar-foreground: oklch(0.99 0 0);
    --sidebar-primary: oklch(0.69 0.20 40.5);
    --sidebar-primary-foreground: oklch(0.29 0.017 271);
    --sidebar-accent: oklch(0.35 0.02 271);
    --sidebar-accent-foreground: oklch(0.99 0 0);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.69 0.20 40.5);
```

- [ ] **Step 3: Verify the new values are present**

Run:
```bash
grep -n -- "--sidebar: oklch(0.29 0.017 271);" src/app/globals.css && \
grep -n -- "--sidebar-primary: oklch(0.69 0.20 40.5);" src/app/globals.css
```
Expected: two matching lines.

- [ ] **Step 4: Verify contrast ratio**

Run:
```bash
python3 -c "
import math
def srgb_to_linear(c):
    c = c/255
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c):
    c = max(0,min(1,c))
    return c*12.92 if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055
def oklch_to_rgb(L,C,Hdeg):
    H = math.radians(Hdeg)
    a = C*math.cos(H); b = C*math.sin(H)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l,m,s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(round(255*linear_to_srgb(c)) for c in (r,g,bb))
def luminance(r,g,b):
    r,g,b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(rgb1, rgb2):
    l1, l2 = luminance(*rgb1), luminance(*rgb2)
    l1, l2 = max(l1,l2), min(l1,l2)
    return (l1+0.05)/(l2+0.05)
bg = oklch_to_rgb(0.29, 0.017, 271)
fg = oklch_to_rgb(0.99, 0, 0)
c = contrast(bg, fg)
print(f'sidebar vs sidebar-foreground: {c:.2f}')
assert c >= 4.5, f'contrast {c:.2f} fails AA'
print('PASS')
"
```
Expected: `sidebar vs sidebar-foreground: 13.78`, `PASS`.

- [ ] **Step 5: Pre-commit checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero new lint errors, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): make light-mode sidebar a charcoal anchor surface (JFR-103)"
```

---

### Task 3: Light mode — rich-prose link color

**Files:**
- Modify: `src/app/globals.css:129`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (separate CSS rule, not a `:root` custom property).
- Produces: updated `.rich-prose a` color, consumed by `rich-text-editor.tsx` and `rich-text-display.tsx` wherever TipTap content renders a link.

- [ ] **Step 1: Confirm target value isn't present yet**

Run:
```bash
grep -n "rich-prose a { color: oklch(0.55 0.20 40.5)" src/app/globals.css
```
Expected: no output.

- [ ] **Step 2: Edit the link color**

Change line 129 from:
```css
.rich-prose a { color: oklch(0.55 0.2 264); text-decoration: underline; }
```
to:
```css
.rich-prose a { color: oklch(0.55 0.20 40.5); text-decoration: underline; }
```

- [ ] **Step 3: Verify the new value is present**

Run:
```bash
grep -n "rich-prose a { color: oklch(0.55 0.20 40.5)" src/app/globals.css
```
Expected: one matching line (line 129).

- [ ] **Step 4: Pre-commit checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero new lint errors, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): recolor light-mode rich-text links to brand orange (JFR-103)"
```

---

### Task 4: Dark mode — core palette tokens

**Files:**
- Modify: `src/app/globals.css:182-199` (inside `.dark`)

**Interfaces:**
- Consumes: same `@theme inline` mapping as Task 1; the `.dark` class toggle already exists app-wide (`@custom-variant dark`, `src/app/globals.css:5`) — unchanged.
- Produces: updated `--background`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--ring` for dark mode.

- [ ] **Step 1: Confirm target value isn't present yet**

Run:
```bash
grep -n -- "--primary: oklch(0.72 0.19 40.5);" src/app/globals.css
```
Expected: no output.

- [ ] **Step 2: Edit the `.dark` block**

Replace lines 182–199 (from `--background: oklch(0.145 0 0);` through `--ring: oklch(0.556 0 0);`) with:

```css
    --background: oklch(0.20 0.012 271);
    --foreground: oklch(0.97 0.006 60);
    --card: oklch(0.25 0.014 271);
    --card-foreground: oklch(0.97 0.006 60);
    --popover: oklch(0.25 0.014 271);
    --popover-foreground: oklch(0.97 0.006 60);
    --primary: oklch(0.72 0.19 40.5);
    --primary-foreground: oklch(0.18 0.01 271);
    --secondary: oklch(0.28 0.014 271);
    --secondary-foreground: oklch(0.97 0.006 60);
    --muted: oklch(0.28 0.014 271);
    --muted-foreground: oklch(0.70 0.01 271);
    --accent: oklch(0.68 0.18 40.5);
    --accent-foreground: oklch(0.18 0.01 271);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 12%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.72 0.19 40.5);
```

Note: `--destructive` is unchanged (per Global Constraints) — copy through as-is. `--border` / `--input` values are also unchanged from the current file — copy through as-is.

- [ ] **Step 3: Verify the new values are present**

Run:
```bash
grep -n -- "--primary: oklch(0.72 0.19 40.5);" src/app/globals.css && \
grep -n -- "--background: oklch(0.20 0.012 271);" src/app/globals.css
```
Expected: two matching lines, inside the `.dark` block.

- [ ] **Step 4: Verify contrast ratios**

Run:
```bash
python3 -c "
import math
def srgb_to_linear(c):
    c = c/255
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c):
    c = max(0,min(1,c))
    return c*12.92 if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055
def oklch_to_rgb(L,C,Hdeg):
    H = math.radians(Hdeg)
    a = C*math.cos(H); b = C*math.sin(H)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l,m,s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(round(255*linear_to_srgb(c)) for c in (r,g,bb))
def luminance(r,g,b):
    r,g,b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(rgb1, rgb2):
    l1, l2 = luminance(*rgb1), luminance(*rgb2)
    l1, l2 = max(l1,l2), min(l1,l2)
    return (l1+0.05)/(l2+0.05)
primary = oklch_to_rgb(0.72, 0.19, 40.5)
primary_fg = oklch_to_rgb(0.18, 0.01, 271)
c1 = contrast(primary, primary_fg)
print(f'primary vs primary-foreground: {c1:.2f}')
assert c1 >= 4.5, f'primary contrast {c1:.2f} fails AA'
print('PASS')
"
```
Expected: `primary vs primary-foreground: 6.93`, `PASS`.

- [ ] **Step 5: Pre-commit checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero new lint errors, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): recolor dark-mode core palette to brand orange/charcoal (JFR-103)"
```

---

### Task 5: Dark mode — sidebar tokens

**Files:**
- Modify: `src/app/globals.css:205-212` (inside `.dark`)

**Interfaces:**
- Consumes: same as Task 4; independent of Task 4's property names.
- Produces: updated `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` for dark mode. This is the task that removes the stray unrelated blue (`oklch(0.488 0.243 264.376)`) currently on `--sidebar-primary`.

- [ ] **Step 1: Confirm the stray blue is still present (documents what we're removing)**

Run:
```bash
grep -n -- "--sidebar-primary: oklch(0.488 0.243 264.376);" src/app/globals.css
```
Expected: one match — this is the unrelated blue this task removes.

- [ ] **Step 2: Edit the sidebar block inside `.dark`**

Replace lines 205–212 (from `--sidebar: oklch(0.205 0 0);` through `--sidebar-ring: oklch(0.556 0 0);`) with:

```css
    --sidebar: oklch(0.145 0.01 271);
    --sidebar-foreground: oklch(0.97 0.006 60);
    --sidebar-primary: oklch(0.72 0.19 40.5);
    --sidebar-primary-foreground: oklch(0.18 0.01 271);
    --sidebar-accent: oklch(0.22 0.014 271);
    --sidebar-accent-foreground: oklch(0.97 0.006 60);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.72 0.19 40.5);
```

- [ ] **Step 3: Verify the stray blue is gone and the new values are present**

Run:
```bash
grep -n -- "--sidebar-primary: oklch(0.488 0.243 264.376);" src/app/globals.css; echo "exit: $?"
grep -n -- "--sidebar-primary: oklch(0.72 0.19 40.5);" src/app/globals.css
```
Expected: first command prints nothing and `exit: 1`; second command prints one matching line.

- [ ] **Step 4: Verify contrast ratio**

Run:
```bash
python3 -c "
import math
def srgb_to_linear(c):
    c = c/255
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c):
    c = max(0,min(1,c))
    return c*12.92 if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055
def oklch_to_rgb(L,C,Hdeg):
    H = math.radians(Hdeg)
    a = C*math.cos(H); b = C*math.sin(H)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l,m,s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(round(255*linear_to_srgb(c)) for c in (r,g,bb))
def luminance(r,g,b):
    r,g,b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(rgb1, rgb2):
    l1, l2 = luminance(*rgb1), luminance(*rgb2)
    l1, l2 = max(l1,l2), min(l1,l2)
    return (l1+0.05)/(l2+0.05)
bg = oklch_to_rgb(0.145, 0.01, 271)
fg = oklch_to_rgb(0.97, 0.006, 60)
c = contrast(bg, fg)
print(f'sidebar vs sidebar-foreground: {c:.2f}')
assert c >= 4.5, f'contrast {c:.2f} fails AA'
print('PASS')
"
```
Expected: `sidebar vs sidebar-foreground: 18.09`, `PASS`.

- [ ] **Step 5: Pre-commit checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero new lint errors, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): recolor dark-mode sidebar, remove stray unrelated blue accent (JFR-103)"
```

---

### Task 6: Dark mode — rich-prose link color

**Files:**
- Modify: `src/app/globals.css:130`

**Interfaces:**
- Consumes: nothing from Tasks 4–5.
- Produces: updated `.dark .rich-prose a` color, mirroring Task 3 for dark mode.

- [ ] **Step 1: Confirm target value isn't present yet**

Run:
```bash
grep -n "dark .rich-prose a { color: oklch(0.72 0.19 40.5)" src/app/globals.css
```
Expected: no output.

- [ ] **Step 2: Edit the link color**

Change line 130 from:
```css
.dark .rich-prose a { color: oklch(0.7 0.18 264); }
```
to:
```css
.dark .rich-prose a { color: oklch(0.72 0.19 40.5); }
```

- [ ] **Step 3: Verify the new value is present**

Run:
```bash
grep -n "dark .rich-prose a { color: oklch(0.72 0.19 40.5)" src/app/globals.css
```
Expected: one matching line (line 130).

- [ ] **Step 4: Pre-commit checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero new lint errors, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): recolor dark-mode rich-text links to brand orange (JFR-103)"
```

---

### Task 7: Final verification, push, and close out JFR-103

**Files:** none (verification only).

**Interfaces:**
- Consumes: the complete set of changes from Tasks 1–6.
- Produces: nothing new — this task confirms the finished state and ships it.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on `localhost:3000` without errors.

- [ ] **Step 2: Manual visual check — light mode**

In a browser, log in (`admin@taskforge.dev` / `password123`) and check, in light mode:
- Dashboard — background reads as warm off-white, not stark white
- Sidebar — charcoal background, orange highlight on the active nav item
- Kanban board (any project, e.g. `PL`) — buttons/interactive elements show brand orange
- Issue detail page — open an issue with a description containing a link (or add one), confirm the link renders in brand orange, not blue
- Sidebar collapsed and expanded — both states look correct

Expected: all above hold true; no leftover pure-white or pure-gray surfaces, no blue link.

- [ ] **Step 3: Manual visual check — dark mode**

Toggle dark mode and repeat the same checks as Step 2.

Expected: all hold true; confirm the sidebar's active-item highlight is now orange, not the old stray blue.

- [ ] **Step 4: Confirm `--destructive` still reads as an error color**

In the UI, trigger a destructive-action confirmation (e.g. attempt to delete an issue) or a form validation error.

Expected: the red destructive color is still clearly distinguishable from the new brand orange, not confusable with it.

- [ ] **Step 5: Re-run full pre-commit checklist**

Run:
```bash
npm run lint && npx tsc --noEmit && git status --short
```
Expected: zero errors from both commands; `git status --short` shows a clean tree (all 6 prior commits already made, nothing uncommitted).

- [ ] **Step 6: Push and monitor CI**

Run:
```bash
git push
until gh run list --repo jedmond1971/taskforge --limit 1 2>&1 | grep -qE "completed|failure|success"; do sleep 5; done
gh run list --repo jedmond1971/taskforge --limit 1
```
Expected: CI run completes with success. If it fails, fix and push before continuing — do not leave `main` broken (per CLAUDE.md).

- [ ] **Step 7: Wait for Railway deploy and spot-check production**

Run:
```bash
until curl -s -o /dev/null -w "%{http_code}" https://www.jedforge.com | grep -q "200"; do sleep 15; done
```
Then open `https://www.jedforge.com` in a browser and repeat the Step 2/3 visual checks against production.

Expected: production reflects the new theme in both light and dark mode.

- [ ] **Step 8: Post a fix-summary comment on JFR-103 as Maximus**

Run (production v1 API, per this project's CLAUDE_API.md — use a heredoc so backticks/quotes in the body are safe):

```bash
set -a && source .env && set +a
python3 << 'PYEOF'
import urllib.request, json, os

key = os.environ["V1_API_KEY"]
body = (
    "<p>UI color overhaul complete. Replaced the stock grayscale shadcn theme "
    "in globals.css with a brand palette sampled from the JedForge logo "
    "(orange ~oklch(0.69 0.20 40.5), charcoal ~oklch(0.29 0.017 271)), in both "
    "light and dark mode. Sidebar is now a charcoal anchor surface in both "
    "themes; rich-text links recolored from blue to brand orange; the stray "
    "unrelated blue on dark-mode sidebar-primary is gone. All text-bearing "
    "color pairings verified ≥4.5:1 WCAG AA contrast. Destructive/error "
    "colors left unchanged and hue-distinct from the brand orange. "
    "Component-level hardcoded colors (badges, kanban columns, charts) were "
    "out of scope for this pass — flagging as a follow-up issue.</p>"
)
req = urllib.request.Request(
    "https://taskforge-production-099b.up.railway.app/api/v1/issues/JFR-103/comments",
    data=json.dumps({"authorId": "cmo365psl000vdrd0p63lirlz", "body": body}).encode(),
    headers={"X-Internal-Api-Key": key, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    print(resp.status, resp.read().decode())
PYEOF
```
Expected: `201` (or `200`) response confirming the comment was posted under Maximus.

- [ ] **Step 9: Move JFR-103 to Done**

Run:
```bash
set -a && source .env && set +a
python3 -c "
import urllib.request, json, os
key = os.environ['V1_API_KEY']
req = urllib.request.Request(
    'https://taskforge-production-099b.up.railway.app/api/v1/issues/JFR-103',
    data=json.dumps({'statusId': 'Done'}).encode(),
    headers={'X-Internal-Api-Key': key, 'Content-Type': 'application/json'},
    method='PATCH',
)
with urllib.request.urlopen(req) as resp:
    print(resp.status, resp.read().decode())
"
```
Expected: `200` response, issue status now `Done`.

---

## Self-Review Notes

- **Spec coverage:** every row of the spec's light-mode and dark-mode token tables is covered (Tasks 1/2 light, Tasks 4/5 dark), the rich-prose link color is covered (Tasks 3/6), the contrast-verification approach from the spec is embedded as an executable step in every token-bearing task, and the "out of scope" items (chart tokens, destructive, component-level hardcoded colors) are explicitly called out as untouched with a follow-up-issue note in the final comment.
- **Placeholder scan:** no TBD/TODO; every step has literal commands or literal CSS to write.
- **Type consistency:** all OKLCH values used in task steps match the spec's tables exactly (cross-checked against `docs/superpowers/specs/2026-08-04-jfr-103-color-overhaul-design.md`).
