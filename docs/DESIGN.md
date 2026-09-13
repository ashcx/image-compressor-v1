# Responsive information architecture and design tokens (UX-01)

This defines the product shape and token vocabulary the later UX sprints build on.
The tokens are implemented in [`src/app.css`](../src/app.css); the layouts
described here are delivered by UX-02/03/04.

## Product shape

**Decision: single-file auto-compression and batch estimation remain distinct.**

- One file → compress immediately with the current settings. This keeps the common
  "convert this one image" path instant.
- Two or more files → estimate a bounded sample first so the user can tune settings
  before paying for a full batch. Nothing encodes until **Compress** is pressed.

Both paths share the same panel, queue, and result model; they differ only in
whether compression starts automatically.

## Information architecture

```
Header            title + privacy promise
Update/notice     dismissible banners (new version, zip errors)
Dropzone          empty state; drag-and-drop or click to choose files
Settings panel    output format, format controls, resize, progress, summary, actions
Queue             one row per file: thumbnail, name, dimensions/size, actions
Footnote          batch-mode guidance
Footer            app version
```

Desktop keeps the panel beside the scrollable queue (two-pane). Tablet stacks the
panel above the queue. Mobile uses a compact header and a sticky bottom action bar
with the primary action and an overflow menu for row actions.

## Breakpoints

| Token | Width | Layout |
| --- | --- | --- |
| mobile | ≤ 34rem (~544px) | Single column, sticky bottom actions, overflow row menu. |
| portrait tablet | 34–64rem | Single column, larger tap targets, panel above queue. |
| landscape tablet | 64–80rem | Two-pane, panel and queue side by side. |
| desktop | > 80rem | Two-pane, content expands to use available width. |

## States

| State | When | Presentation |
| --- | --- | --- |
| Empty | no files | Dropzone with title and format hint. |
| Importing | files added, reads in flight | Rows appear immediately with idle thumbnails; dimensions fill in. |
| Estimating | batch, samples running | "Calculating…" summary; Compress available but sizes approximate. |
| Compressing | encoding | Spinner thumbnails; settings and downloads disabled. |
| Complete | all settled | Thumbnails and exact sizes; download / download-all / save-to-folder. |
| Error | per-row failure | Row-level error text and icon; the rest of the batch continues. |

Approximate estimates must be visually distinct from exact sizes: prefix estimates
with `~` and show the exact byte count once compression completes.

## Design tokens

Defined in `:root` in `src/app.css`. Use these instead of raw values in new work.

### Colour

`--bg`, `--panel`, `--panel-border`, `--text`, `--muted`, `--accent`,
`--accent-strong`, `--bad`.

### Radius

`--radius-sm` (6px), `--radius` (10px), `--radius-pill` (999px).

### Spacing

`--space-1` … `--space-17`, ascending from 0.15rem to 4rem. Control padding is
aliased as `--control-pad-y/x` and `--button-pad-y/x`. Future layout work should
prefer a 4px-aligned subset (`--space-3`, `--space-6`, `--space-11`, `--space-13`,
`--space-14`, `--space-16`) and let the finer steps remain for dense, existing UI.

### Type

`--text-2xs` (0.75rem) … `--text-2xl` (1.6rem). Body/labels use `--text-lg`
(0.95rem); metadata uses `--text-sm`.

### Controls and focus

`--focus-width` (2px) and `--focus-offset` (1px) drive the shared focus ring on
selects, inputs, buttons, icon buttons, and the dropzone. Interactive controls must
keep a visible `:focus-visible` outline.

### Density

`--row-min-height` (64px) and `--thumb-size` (40px) define the default queue density.

## Wireframes

Desktop (two-pane):

```
┌───────────────────────────────┬───────────────────────────────┐
│ Image Compressor              │ ┌ settings ─────────────────┐ │
│ local-only privacy promise    │ │ Format        [ JPEG  v ] │ │
│                               │ │ Quality       [ Default v]│ │
│ ┌ drop ─────────────────────┐ │ │ Resize        [ 1024    ] │ │
│ │  Drop images here         │ │ │ [==== progress ====]      │ │
│ │  or click to choose       │ │ │ 12 / 12 compressed   w2/4 │ │
│ └───────────────────────────┘ │ │ [ Download all (12) ]     │ │
│                               │ │ [ Add ] [ Clear all ]     │ │
│                               │ └───────────────────────────┘ │
│                               │ ● row  thumb name  size  [x]  │
│                               │ ● row  thumb name  size  [x]  │
└───────────────────────────────┴───────────────────────────────┘
```

Mobile (single column, sticky actions):

```
┌───────────────────────────┐
│ Image Compressor          │
│ [ Format v ]              │
│ [==== progress ====]      │
│ ● row 60×60 px   [ ⋮ ]    │
│ ● row 60×60 px   [ ⋮ ]    │
├───────────────────────────┤
│ [   Compress all (24)   ] │  ← sticky, 44–48px targets
└───────────────────────────┘
```

## Acceptance criteria (for UX-02 … UX-05)

- Layouts hold at 360px, 768px, 1024px, and 1440px with no horizontal scroll.
- Primary actions are full width on mobile with ≥44px touch targets.
- Advanced settings collapse by default on mobile; worker diagnostics sit in an
  advanced details area.
- Progress is announced semantically; focus order follows the visual order.
- Approximate vs exact sizes are distinguishable at a glance.
- Reduced motion is respected for spinner and progress transitions.
