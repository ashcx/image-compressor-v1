# Execution Plan — Client-Side Parallel Image Compressor

Scrum-based delivery plan derived from [DESIGN.md](./DESIGN.md). This document is the
planning artifact: Product Goal, Definition of Done, backlog, sprint plan with story
points, and an execution/parallelization strategy (including where sub-agents can work
concurrently).

---

## 1. Product Goal

**Ship a static, backend-free web app on GitHub Pages that lets anyone drop in a batch of
images and convert/compress them to JPEG, PNG, WebP, AVIF, or JPEG XL entirely in the
browser, processing multiple images concurrently across a pool of Web Workers, and download
the results as a single zip — verified working on desktop and mobile browsers.**

The Product Goal is achieved when the Increment is live at
`https://ashcx.github.io/image-compressor-v1/` and satisfies the Definition of Done below
across the Phase 4 format matrix.

---

## 2. Definition of Done (DoD)

An Increment (sprint output) is **Done** only when all of the following hold:

1. **Merged** — all changes are committed to `main` (or merged into it).
2. **Builds clean** — `vite build` and typecheck/lint complete with zero errors.
3. **Tests pass** — any unit/integration tests added for the story pass locally and in CI.
4. **Deploys** — the GitHub Pages workflow succeeds and the change is reachable on the live
   URL.
5. **Console clean** — no new errors, uncaught rejections, or asset 404s in the browser
   console on the live deployment.
6. **Criteria verified** — the story's own acceptance criteria are demonstrably true
   (measured where the criterion is "faster"/"responsive", per DESIGN.md §7).
7. **No regressions** — a smoke test of previously delivered features still passes.
8. **Docs current** — `README.md` / `DESIGN.md` updated if scope, behavior, or architecture
   changed.

**Definition of Ready (DoR)** — a backlog item can enter a sprint only when: the user
value is stated, acceptance criteria are written, dependencies are identified, and (for
UI/worker items) the relevant interface is already frozen.

**Increment** — every sprint must produce a potentially shippable Increment; if a story
cannot be finished, it is returned to the Product Backlog rather than partially merged.

---

## 3. Estimation & Velocity Assumptions

- **Story points:** Fibonacci-ish scale `1, 2, 3, 5, 8, 13` (relative complexity + risk).
- **Sprint length:** 1 week (agent-accelerated). Adjust if velocity diverges.
- **Team:** one driver (you) plus orchestrator-dispatched sub-agents.
- **Planned velocity:** 15–20 points/sprint single-track; 25–30 when parallel tracks are
  active (see §6).
- **Total backlog (first build, S1–S8):** ~115 points across 8 sprints. S9 (Polish) and
  S10 (HEIC preview) are deferred and excluded from the first build.

---

## 4. Product Backlog (epics → stories)

Priority: `P0` = required for the first build (S1–S8). `P1` and `P2` items are
**deferred** and are not part of the first build.

### Epic E1 — Toolchain & Deployment Foundation (P0) — 15 pts
| ID | Story | Pts |
|---|---|---|
| S1.1 | Scaffold Vite project with correct `base` and `.nojekyll` | 3 |
| S1.2 | GitHub Actions build + deploy to Pages | 5 |
| S1.3 | Add first jsquash package (`@jsquash/webp`) and configure Vite/JSquash WASM handling | 5 |
| S1.4 | Verify live deploy with zero console 404s | 2 |

### Epic E2 — Single-Image Conversion, Main Thread (P0) — 17 pts
| ID | Story | Pts |
|---|---|---|
| S2.1 | Single-file input / drag-drop | 3 |
| S2.2 | Decode + re-encode to chosen format/quality on the main thread | 5 |
| S2.3 | Before/after file size + download link | 3 |
| S2.4 | Resolve Vite/jsquash bundling quirks (`optimizeDeps.exclude`) | 3 |
| S2.5 | Desktop Chrome/Firefox/Safari smoke test | 3 |

### Epic E3 — Worker Offload (P0) — 12 pts
| ID | Story | Pts |
|---|---|---|
| S3.1 | Worker script implementing the §6 message protocol | 5 |
| S3.2 | Main-thread single-job dispatch + response handling | 3 |
| S3.3 | Verify `Transferable` zero-copy transfer | 2 |
| S3.4 | Responsiveness test during a slow AVIF encode | 2 |

### Epic E4 — Worker Pool & Job Queue (P0) — 26 pts (split across Sprints 4–5)
| ID | Story | Pts |
|---|---|---|
| S4.1 | Worker pool manager (`N = hardwareConcurrency`, cap 8) | 8 |
| S4.2 | FIFO job queue with idle-worker pulling | 5 |
| S4.5 | Fault isolation — a corrupt file never stalls the queue | 3 |
| S4.3 | Multi-file drag-drop / multi-select input | 3 |
| S4.4 | Per-file + overall progress UI | 5 |
| S4.6 | Measure wall-clock speedup vs. sequential | 2 |

### Epic E5 — Format Coverage & Options (P0) — 19 pts
| ID | Story | Pts |
|---|---|---|
| S5.1 | Add `@jsquash/{jpeg,avif,jxl,png,oxipng}` codecs | 5 |
| S5.2 | Per-format quality/effort controls wired through to codecs | 5 |
| S5.3 | Optional resize step via `@jsquash/resize` | 3 |
| S5.4 | Format auto-detection by file signature | 3 |
| S5.5 | Full format-matrix manual test pass | 3 |

### Epic E6 — Batch Output & Download (P0) — 14 pts
| ID | Story | Pts |
|---|---|---|
| S6.1 | Zip all results with JSZip | 5 |
| S6.2 | Output naming + download handling | 2 |
| S6.3 | (Optional) File System Access API with zip fallback | 5 |
| S6.4 | Verify zip fallback on Safari + Firefox | 2 |

### Epic E7 — Cross-Device Validation (P0) — 12 pts
| ID | Story | Pts |
|---|---|---|
| S7.1 | Test matrix: Android phone, iOS device, tablet, desktop ×3 | 5 |
| S7.2 | Mobile tuning (worker count / quality fallback) | 5 |
| S7.3 | Document device-specific breakage | 2 |

### Epic E8 — Polish (deferred — not in first build) — 15 pts
| ID | Story | Pts |
|---|---|---|
| S8.1 | Persist last-used settings (`localStorage`) | 3 |
| S8.2 | Per-file overrides / drag-reorder within a batch | 5 |
| S8.3 | Before/after comparison slider | 5 |
| S8.4 | Finalize README + docs | 2 |

### Epic E9 — HEIC Preview (deferred — not in first build) — 13 pts
| ID | Story | Pts |
|---|---|---|
| S9.1 | `libheif-js` decode + `ftyp` detection | 5 |
| S9.2 | `elheif` encode preview, lazily loaded | 5 |
| S9.3 | Preview labeling + graceful failure | 3 |

---

## 5. Sprint Plan

| Sprint | Goal | Stories | Pts | Depends on |
|---|---|---|---|---|
| **S1 — Foundation** | A static page builds and deploys to Pages with zero 404s. | S1.1–S1.4 | 15 | — |
| **S2 — Single image** | Convert one JPEG → WebP on the main thread, correctly, in 3 desktop browsers. | S2.1–S2.5 | 17 | S1 |
| **S3 — Worker offload** | All codec work runs in one worker; UI stays responsive on a slow encode. | S3.1–S3.4 | 12 | S2 |
| **S4 — Pool core** | N images dispatch across a sized worker pool with fault isolation. | S4.1, S4.2, S4.5 | 16 | S3 |
| **S5 — Batch UX & proof** | Multi-file UX + progress; measured wall-clock speedup vs sequential. | S4.3, S4.4, S4.6 | 10 | S4 |
| **S6 — Formats & options** | All five formats round-trip; quality/effort/resize controls are wired through. | S5.1–S5.5 | 19 | S3 (protocol) |
| **S7 — Batch output** | N images → one correctly-named zip; works on Safari + Firefox. | S6.1–S6.4 | 14 | S4 (result shape) |
| **S8 — Cross-device** | Live app processes images on Android, iOS, tablet, and desktop. | S7.1–S7.3 | 12 | S5, S6, S7 |

> **First build scope = S1–S8.** S9 (Polish) and S10 (HEIC preview) are deferred; their
> stories remain in the backlog (§4) for a later cycle but are not part of the first build.

**Current increment note:** the public repo, Pages workflow, and placeholder preview are
already live (S1.2 and most of S1.4 are effectively complete); S1.1 and S1.3 remain before
S1 can close.

---

## 6. Execution Strategy — Sequence, Parallelism & Sub-Agents

### 6.1 Critical path (must be sequential)

```
S1 → S2 → S3 → S4 → S5 → S7 → S8
```

S1–S3 are strictly sequential: the toolchain must exist before codec code, and codec code
must work on the main thread before being moved into a worker (this is exactly why
DESIGN.md §7 splits phases 0–2).

### 6.2 Forced interface freezes (parallelism enablers)

| Freeze point | Interface | Unlocks |
|---|---|---|
| End of S3 | Worker message protocol (DESIGN.md §6) | S6 (codecs) in parallel with S4 |
| End of S4 | Result object shape (`{jobId, outputBuffer, size, format}`) | S7 (zip) in parallel with S5 |

These freezes are the key: once an interface is fixed, the layer above and the layer below
can be developed independently.

### 6.3 Parallel waves (sub-agent orchestration)

| Wave | Runs concurrently | Sub-agent assignment | Why safe |
|---|---|---|---|
| W1 | S4 (pool/queue) ‖ S6 (format codecs) | one `general` agent per track, separate branches | pool dispatches jobs; codecs live inside the worker — different layers, same frozen protocol |
| W2 | S5 (batch UX) ‖ S7 (zip/download) | two `general` agents | UX reads pool status; zip consumes the frozen result shape |

**Recommended use of agents:**
- `explore` sub-agents (read-only, cheap) for research/verification tasks: desktop
  competitive scan (§10), confirming jsquash/Vite quirks, and verifying codec API behavior.
- `general` sub-agents for independent implementation tracks in W1/W2, each on a branch
  or git worktree, merged only when the shared interface is frozen and the DoD is met.
- **Guardrail:** no two agents may edit the same interface file or `DESIGN.md`
  concurrently. Merge the interface change first, then fan out.

### 6.4 Optimized wall-clock schedule (with parallelism)

| Week | Track A (driver) | Track B (agent) |
|---|---|---|
| 1 | S1 Foundation | — |
| 2 | S2 Single image | — |
| 3 | S3 Worker offload | — |
| 4 | S4 Pool core | S6 Formats & options |
| 5 | S5 Batch UX & proof | S7 Batch output |
| 6 | S8 Cross-device | — |

Expected near-critical-path duration: **~6 weeks** vs. ~8 weeks strictly sequential.

---

## 7. Scrum Ceremonies & Artifacts

- **Sprint Planning (start of each sprint):** confirm Sprint Goal, pull ready items to
  meet planned velocity, restate the DoD.
- **Backlog Refinement (mid-sprint):** verify DoR for the next sprint's stories; re-point
  as understanding improves.
- **Sprint Review (end):** demo the live Pages Increment against the Sprint Goal; confirm
  the DoD checklist per story.
- **Retrospective (end):** one improvement to apply next sprint.
- **Artifacts:** Product Backlog (§4), Sprint Backlog (Sprint Goal + selected stories),
  Increment (deployed static site).

---

## 8. Key Risks to the Plan

| Risk | Mitigation |
|---|---|
| Vite/jsquash bundling friction delays S1/S2 | Budgeted as S2.4; verify with one codec before adding the rest. |
| Worker pool memory blowup on mobile | Cap workers at 8; tune down in S7.2 based on measured device behavior. |
| Parallel agents create merge conflicts | Interface-freeze discipline (§6.2) + one owner per interface file. |
| AVIF/JXL encode slowness undermines "speedup" claim | Measure honestly (S4.6); set UI expectations rather than over-promise. |
| Safari/iOS worker/WASM quirks | Dedicated Sprint 8; do not assume desktop testing generalizes. |
