# BSM App — Design Brief

*Companion to `docs/updated-prd.md`. This document sets the visual
identity and design system direction for the build ahead of
implementation — palette, typography, component conventions, and
motion language every screen shall follow.*

## 1. Design Principles

- **Dark-first.** The app defaults to a near-black theme, with a full
  light-theme toggle as a secondary, equally-supported mode — not an
  afterthought. Most usage happens in a warehouse or under variable
  field lighting, where a dark UI reduces glare and battery draw on the
  OLED-class phones this app targets; the light toggle exists for users
  who prefer or need it (bright outdoor conditions, personal
  preference), persisted per device.
- **One color, one meaning, everywhere.** Green/neon always means an
  issuance (stock or sacks leaving a warehouse); amber always means a
  receipt (stock or sacks arriving). This convention is fixed app-wide —
  WTS's two sides, the pile action menu, transaction type badges, the
  NFA Ricemill Issuance/Receipt breakdown — never locally overridden for
  a single screen's own taste.
- **Numbers are the product.** This is a stock-counting app; bag counts,
  kilos, and balances must be maximally legible — comma-formatted,
  tabular-numeral (fixed-width digits so a running total never visibly
  wobbles as it updates), and never truncated.
- **Motion confirms, never decorates for its own sake.** Every animation
  in the system exists to answer a specific question the user would
  otherwise have to guess at — did my tap register, which direction did
  I just navigate, did that value actually change, is data still
  syncing. Motion in this system is a native-app-adjacent product
  cue, not visual flourish.
- **Never use the browser's native `alert()`/`confirm()`.** All
  feedback routes through the app's own toast and modal/dialog
  components, styled consistently with the rest of the system.

## 2. Color System

Defined as Tailwind theme extensions (`tailwind.config.js`), so every
color used app-wide traces back to one of these tokens rather than an
ad hoc hex value in a component.

### 2.1 Neutrals (the dark-theme scale)

| Token | Hex | Role |
|---|---|---|
| `neutral-950` | `#0A0A0A` | App background |
| `neutral-900` | `#171717` | Card / panel surface |
| `neutral-800` | `#262626` | Raised surface, table row divider |
| `neutral-700` | `#404040` | Border, secondary divider |
| `neutral-600` | `#525252` | Muted border / disabled state |
| `app-text` | `#FFFFFF` | Primary text on dark surfaces |

### 2.2 Brand accents

| Token | Hex | Meaning |
|---|---|---|
| `brand-neon` | `#00FFA3` | **Issuance** (stock/sacks leaving); primary interactive accent (FAB, active nav pill, links); "Complete" status |
| `brand-amber` | `#F59E0B` | **Receipt** (stock/sacks arriving); "Pending" attention states |
| `brand-crimson` | `#EF4444` | Error, "Over-Issued" status, destructive actions |
| `brand-byproduct` | `#F2B949` | By-Products cereal-category accent, distinct from the general receipt-amber |
| `brand-contrast` | `#0A0A0A` | Fixed dark text for content sitting *on* an accent-colored fill (e.g. text on the neon FAB) — never theme-variable, since it must stay dark regardless of dark/light mode |

### 2.3 Light theme

The light theme is implemented as an explicit override layer (a `.light`
class on `<html>`, toggled by the app, with brute-force per-utility-class
CSS overrides in `index.css` rather than CSS custom properties threaded
through Tailwind's own theme mechanism — the custom-property approach
was attempted first and abandoned after failing to render correctly in
testing for reasons that couldn't be diagnosed without a running build;
the explicit override list is blunter but has no dependency on that
mechanism working correctly).

| Dark token | Light override |
|---|---|
| `bg-neutral-950` | `#F4F4F5` |
| `bg-neutral-900` | `#FFFFFF` |
| `bg-neutral-800` | `#E4E4E7` |
| `text-app-text` | `#171717` |
| `brand-neon` (as text/border) | `#00754A` (deepened — the raw neon reads as washed-out glare on white) |
| `brand-amber` (as border) | `#D97706` |
| `brand-crimson` | `#DC2626` (kept close to the dark-theme value — crimson already reads fine on white) |
| `brand-byproduct` | `#92690E` (deepened, same reasoning as neon) |

Every accent that appears as a *fill* on white is deepened relative to
its dark-theme value; every accent used only as small text/border
detail is kept closer to its original value. `brand-contrast` is never
touched by the light override — it must stay dark in both themes.

## 3. Typography

- **Typeface**: Inter, self-hosted via `@fontsource` (not Google Fonts'
  CDN `@import`) specifically so the offline service worker can precache
  the actual font files — a CDN-hosted font would silently fall back to
  a system font for any user who has never been online on that device.
  Weights loaded: 400, 500, 600, 700, 800.
- **Numeral rendering**: `font-variant-numeric: tabular-nums` is set
  globally on `body`, not opted into per-component — every digit
  app-wide renders at a fixed width so a live-updating figure (a running
  total, a stepping serial number) never visibly shifts as its digits
  change, and stacked numbers in a table or receipt align cleanly by
  default.
- **Responsive base sizing**: the root `<html>` font-size scales at
  breakpoints (18px at ≥768px, 20px at ≥1024px) rather than each
  component defining its own responsive text classes. Because most
  Tailwind spacing/sizing utilities are `rem`-based, this single change
  scales text, padding, gaps, and radii together in lockstep — an
  element's internal proportions never distort or overlap as the
  viewport grows, since everything inside it grows by the same ratio.

## 4. The Six-Move Responsive Table Method

The app's data-dense tables (age-bucket breakdowns, stock summaries,
authority lists) do not simply shrink their columns at narrow
viewports — past a certain point, a shrunk table becomes illegible
rather than merely tight. Below the `sm` breakpoint, the same data is
instead restructured into a card list using six specific moves, applied
together, not as alternatives to each other:

1. **Rank** — identify the one headline figure the row exists to
   communicate (e.g. a warehouse's Total), and give it visual priority;
   every other figure becomes secondary detail.
2. **Stack** — what was side-by-side as table columns becomes vertically
   stacked within the card (e.g. row label + headline value on one
   line, the full breakdown below it), instead of attempting to
   preserve a horizontal layout at a width that can no longer support it.
3. **Slot** — the headline figure occupies the same fixed position on
   every card (e.g. always top-right), so a user scanning down a list of
   cards can find it at a glance without re-reading each card's layout.
4. **Label** — once a figure is no longer under a shared column header,
   it carries its own short inline unit label (e.g. "mo" for months)
   so it remains unambiguous in isolation.
5. **Reveal** — the detail that doesn't fit on the card's collapsed
   state is never dropped — it's one tap away (an in-place expand),
   never relocated to a separate page or hidden without an affordance.
6. **Breakpoint** — the card list and the plain table are two separate
   renders gated by the same breakpoint (card list below `sm`, table at
   `sm` and above), not one layout attempting to serve both — each is
   built and read as a complete solution for its own viewport, not a
   compromise between the two.

Every new data table the app introduces at a similar density should
apply this same six-move breakdown for its narrow-viewport
presentation, rather than inventing a new one-off collapsing strategy
per screen.

## 5. Component Conventions

- **Cards**: `neutral-900` surface on `neutral-950` background, `rounded-2xl`
  or `rounded-xl`, a `neutral-800` border — the base unit almost every
  piece of content sits inside, from a pile summary to a single report
  line item.
- **Modals / sheets**: bottom sheets (the FAB's five-way transaction
  picker, detail drill-downs) slide up from the bottom edge
  (`animate-sheet-slide-up` / `-down`) rather than fading in centered —
  this reads as more native-app-like on a touch device and keeps the
  action anchored near the thumb. Full-screen detail panels that should
  feel like navigating deeper (rather than a modal interrupting the
  current screen) instead push in from the right
  (`animate-push-slide-in` / `-out`), mirroring how they arrived.
  Small popovers/menus use a one-time bounce-in
  (`animate-bounce-in`) — Tailwind's built-in `animate-bounce` was
  rejected because it loops forever, which reads as broken for
  something that should settle once and stay still.
- **Toasts, never `alert()`/`confirm()`.** A single custom toast
  renderer (`AnimatedToast`) hooks into `react-hot-toast`'s `Toaster` at
  one integration point, so every existing `toast.success/error/...`
  call site across the app gets a consistent entrance animation and a
  distinct per-type icon motion (a check for success, a shake for
  error, a spin for loading, a nod for info) without needing to touch
  each call site individually.
- **Forms**: every transaction form is a full-screen overlay (never a
  modal box competing for space with the page behind it), entered/exited
  with a pop transition that the header and bottom nav coordinate with
  (they slide out of view while a form is open, and slide back in on
  close) — the full screen belongs to data entry while a form is active.
- **Buttons/inputs**: native `<select>` chrome is fully suppressed
  (`appearance: none`) in favor of one consistent custom chevron across
  every dropdown in the app, since the browser/OS default arrow ignores
  a component's own padding and renders flush against the box edge
  regardless of styling intent. Every numeric bags/kilos/pieces field
  live-formats with comma separators as the user types.
- **Date fields**: always the app's own `CalendarDatePicker`, never a
  native OS date input — needed for visual consistency and because the
  native control's behavior (and appearance) varies too much across the
  Android/iOS/desktop browsers this PWA runs on.
- **Validation messaging**: inline, directly under the field it
  concerns, one or two lines, stating what's wrong and how to fix it —
  never a top-of-form summary list disconnected from the actual fields.

## 6. Motion Language

Every animation in the system is cataloged in `src/index.css` with a
named class and a comment explaining the specific problem it solves —
new motion should follow that same discipline (name the class for what
it does, document why it exists) rather than adding an unexplained
one-off `@keyframes` block. Representative patterns already established:

- **Page transitions**: forward navigation (deeper into the app, e.g.
  Home → Piles) slides in from the right; back navigation slides in
  from the left — direction is computed from each route's position in
  the bottom-nav column order, not hardcoded per route pair.
- **The bottom-nav active pill**: a single, always-mounted element
  driven purely by a CSS `transform` transition (never remounted per
  navigation), so a second rapid tap always continues smoothly from the
  pill's actual current position rather than restarting from a stale
  remembered one. A squash-and-stretch flourish and, when the pill's
  path crosses the FAB, a "dodge" animation on the FAB itself, layer on
  top of the same positional transition without fighting it for the
  `transform` property.
- **Serial number navigation**: stepping backward/forward through a
  document series crossfades the old value out (toward the direction of
  travel) while the new value enters from the opposite side — the input
  box itself never moves, only its text content does.
- **Sync status**: the header's cloud icon pulses while a push is in
  flight and shows a checkmark ripple, inside the same icon, once
  caught up — deliberately not a separate badge, after earlier attempts
  at a separate pulsing badge read as visually disconnected from the
  icon it was meant to describe.
- **Value changes that alter shape** (e.g. a Total row gaining an
  unwithdrawn/potential-inventory detail line) use a 3D flip
  (`animate-value-flip`) rather than the plain flow-down used for
  ordinary content appearing, since a flip communicates "this became
  something structurally different," not just "new content arrived."
- **List-row completion** (an authority or MO/TMO being marked done):
  a color pulse (green for completed, crimson for reverted) that holds
  long enough to actually read, then the row visually flattens
  (`scaleY` toward 0) as the list closes the gap — never an instant
  disappearance.
- **Full-screen surfaces** (pile layout's full-screen mode) use a
  distinct rotate+zoom entrance and a slide+fade exit, differentiating
  a genuinely modal, edge-to-edge experience from the app's ordinary
  page-slide navigation.

## 7. Iconography

`lucide-react` is the app's single icon library — no mixing icon sets.
Icons are chosen for immediate real-world legibility over cleverness
(e.g. `Radar` for the cross-warehouse Monitor tab, `LayoutGrid` for
Piles, a `Plus` in a filled circle for the FAB) since the primary users
are not expected to have prior exposure to app-design icon conventions.
