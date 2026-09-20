# Chess.com-like Game Review from pasted PGN

**Status:** Planning only
**Prepared:** 2026-09-21
**Scope:** A privacy-first tool or assistant workflow that accepts a pasted PGN and produces a guided, engine-backed game review comparable to the user-visible parts of Chess.com's Game Review.
**Repository impact:** This document is standalone planning material. It does not change the existing image-compression product or its runtime.

## 1. Objective

Build a PGN review experience in which a user can paste one chess game and receive:

1. A legal, navigable replay of the game.
2. A report card for both players.
3. An evaluation graph and per-move classifications.
4. A guided review of the most important moments.
5. Human-readable, evidence-linked explanations of mistakes, missed opportunities, and strong moves.
6. “Show the line,” “Best move,” “Retry,” and counterfactual feedback.
7. Opening, phase, tactical-theme, and practice recommendations where the required data is available.

The product should reproduce the learning workflow, not pretend to reproduce Chess.com's private implementation. Chess.com's exact CAPS2 calculations, performance-rating calibration, Coach language, opening-course database, Skills progression, server engine settings, and premium entitlements are not public APIs and should not be copied or represented as exact equivalents.

## 2. Reference feature inventory

This inventory is based on Chess.com's official help and product pages checked on 2026-09-21. It is the parity target for the plan.

### 2.1 Core Game Review features

| Area | Current user-visible capability | Implementation target |
|---|---|---|
| PGN/game access | Review a completed game from the game screen or archive | Paste/import PGN, validate it, and cache the resulting review by a canonical game hash |
| Highlights | A highlights screen with game statistics, graph, accuracy, and a short Coach summary | Implement a report-card view with progressive analysis states |
| Evaluation graph | Shows who had the advantage after each move; points are navigable | Store one normalized evaluation per ply, render a clickable graph, and synchronize graph, board, and move list |
| Accuracy | 0–100 score for each player based on closeness to engine-preferred play | Implement a documented expected-points/CAPS2-inspired score; label it as an independent score, not Chess.com's exact score |
| Performance/game rating | Estimated playing level for that game, separate from the player's account rating | Implement an optional calibrated performance estimate, with a clear “single-game estimate” disclaimer |
| Game phases | Separate opening, middlegame, and endgame performance | Detect phase boundaries and show phase accuracy, score, and grade for each side |
| Move classifications | Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, and Blunder | Implement all ten labels with transparent rules and an engine-backed reason for each label |
| Key moments | Guided review jumps between critical moves, beginning commonly with the last book move | Select and rank critical swings, missed tactics, turning points, and the last book move |
| Coach summary | Short narrative describing how the game unfolded | Generate a concise, deterministic summary from verified game facts; optionally add a language-model layer later |
| Coach explanations | Explains why a move was strong or weak in human-readable language | Generate explanations from engine PVs, material changes, checks, captures, threats, mates, and positional features |
| Show moves | Shows a computer continuation after a mistake or critical move | Support one or more principal variations, animated or stepwise playback, and notation in the explanation panel |
| Best move | Reveals the strongest move and its resulting position/evaluation | Keep the best move hidden until requested when the setting requires it; display the move, PV, and evaluation delta |
| Explanation types | Examples include fork, lost piece, checkmate, idea, and other move-specific explanations | Use an explanation taxonomy and expose only categories supported by verified board facts |
| Retry | Lets the user replay a critical position and try to find the best move | Return the board to the position before the move, accept a legal attempt, and compare it to acceptable engine moves |
| Retry feedback | Gives immediate feedback and shows the positional score if the better move had been played | Show correct/near-best/incorrect feedback, the resulting evaluation, and a counterfactual accuracy estimate |
| Navigation | Move arrows, keyboard navigation, “Next” key move navigation, and mobile swipe/navigation | Provide keyboard-accessible previous/next, next key moment, move-list selection, and responsive touch controls |
| Review perspective | Review as White, Black, or both | Add a perspective selector that changes whose moves are emphasized without changing engine evaluations |
| Board overlays | Move classification markers, best-move arrows, square highlights, and Coach visual explanations | Render classification badges, arrows, and highlighted squares with accessible text equivalents |
| Review settings | Show best move, show classification on board, autoplay shown moves, show/hide Coach avatar | Implement settings with persisted local preferences and explicit defaults |
| Coach audio | Read review feedback aloud and mute/unmute it | Add optional browser text-to-speech; keep audio nonessential and provide captions/text at all times |
| Reopen review | Previously generated reviews can be opened again without re-running the review | Persist canonical PGN, engine settings, schema version, and report; invalidate safely when the analyzer changes |

### 2.2 Opening and learning context

These features are visible in or adjacent to Game Review but require data beyond the PGN and engine.

| Feature | Current behavior to reproduce or document | Delivery decision |
|---|---|---|
| Opening name | The first key move can show the opening name and link to an opening page | MVP: identify ECO/opening from a bundled, licensed opening database. If unavailable, show ECO and “opening name unavailable.” |
| Opening history | Shows how often the player used the opening and results | Requires a user's local game archive. Make it opt-in and local-only; never imply a statistic from one PGN. |
| Opening course suggestion | Suggests a course for the played opening | Optional integration. Use a local curated resource or link out; do not scrape or clone Chess.com Courses. |
| Course deviations | The current Chess.com feature identifies deviation from an owned opening course, shows the course line, and can link to Study | Phase 3 adapter only. It requires a course corpus and user-owned course data; it cannot be implemented from an isolated PGN alone. |
| Skills | Newer Chess.com feature that awards points for habits such as development, forks, castling, and endgame technique; categories include Fundamentals, Openings, Tactics, Strategy, and Endgame | Phase 3 optional learning layer. Implement an independent skill taxonomy and local progress store; do not reuse Chess.com names, icons, or progression thresholds without permission. |
| Themes and practice | Analysis themes can feed recommended puzzles and lessons | MVP: produce practice themes and custom retry positions. External puzzle/lesson recommendations are a later integration. |

### 2.3 Adjacent Self Analysis features

Chess.com distinguishes guided Game Review from Self Analysis. These are useful parity extensions but should not be allowed to delay the core review.

- Evaluation bar.
- Engine lines and multiple principal variations.
- Suggestion arrows and threat arrows.
- Move feedback while stepping through the game.
- Score, time, best-move-difference, and theme charts.
- Alternate variations, comments, arrows, and square highlights.
- FEN/PGN export and an analysis save/collection model.
- Opening Explorer and master-game examples.
- Tablebase lookup for positions with seven or fewer pieces, subject to a compatible local or remote tablebase source.
- Configurable engine, depth, thinking time, and number of lines.

The core product should expose a clearly labeled “Explore position” or “Self analysis” mode after the guided review. It should not conflate a deep analysis board with the review report.

## 3. Product boundaries and parity policy

### 3.1 What this tool can provide from one pasted PGN

- Complete legal replay and board state at every ply.
- Independent engine evaluation and principal variations.
- Per-move quality classification.
- Accuracy and phase summaries.
- Key-moment selection.
- Engine-grounded explanations.
- Best-line display, retry positions, and custom practice prompts.
- Opening identification if a local opening database is bundled.

### 3.2 What one PGN cannot provide by itself

- The user's Chess.com rating history or true account rating.
- Personal opening frequency and results across games.
- A recommendation from a course the user owns unless the user supplies the course data.
- Chess.com's proprietary Coach responses, exact classifications, or exact accuracy score.
- Chess.com's server-side engine depth or cloud analysis result.
- Account-level premium limits, saved archive, or cross-device synchronization.

The UI must say “independent engine review” or equivalent wherever a metric could be confused with Chess.com output.

### 3.3 Privacy and legal requirements

- Default to local-only processing. The PGN may contain player names, usernames, event names, and timestamps even though it does not contain image bytes.
- Do not require Chess.com login, scrape Chess.com, automate a paid account, bypass usage limits, or call undocumented endpoints.
- Do not copy Chess.com branding, Coach avatars, proprietary icons, course content, or explanatory text.
- Use a separately licensed/open-source chess engine and record its license and version in the build metadata.
- Use only licensed or public-domain opening and endgame data.
- If an optional language-model explanation service is introduced, make it opt-in, show the data boundary, and send only the minimum position/move data required.
- Keep all generated reports exportable and deletable by the user.

## 4. Recommended user experience

### 4.1 Primary flow

```text
Paste PGN
  -> Parse and validate
  -> Show game metadata and start-review button
  -> Run progressive engine analysis
  -> Show highlights/report card
  -> Guide user through key moments
  -> Let user show the line, ask for Best, or Retry
  -> Summarize lessons and generate practice positions
  -> Save or export the review
```

### 4.2 Input screen

The first screen should have one focused action:

- A large PGN textarea with paste support.
- Optional file import for `.pgn`.
- A “Review game” action.
- A compact example PGN link or sample button.
- A parser message that identifies the exact move number and token when invalid.
- A multi-game notice if the input contains more than one game, with a choice to review the selected game or queue all games later.

Do not begin engine work until the selected game is legal and canonicalized.

### 4.3 Report card

At the top, show:

- White and Black names, result, date, time control, and opening metadata when present.
- Accuracy for both sides.
- Independent performance estimate for both sides, if enabled.
- A short summary of the game's turning point.
- Evaluation graph with clickable ply markers.
- Counts of each classification by player.
- Opening, middlegame, and endgame grades/accuracy.
- Number of key moments and available practice positions.

The report card should remain useful while analysis is still running. Show per-section skeletons or “analyzing” states instead of a blank screen.

### 4.4 Guided review screen

Use a three-column desktop layout that collapses to a single ordered mobile flow:

1. Board with evaluation bar, arrows, and highlights.
2. Move list and graph.
3. Coach-style explanation panel with `Next`, `Best`, `Show moves`, and `Retry`.

On small screens, keep the board and active explanation visible, move the graph and report details below, and make the primary next action sticky but safe-area aware.

Each key moment should show:

- Move number and SAN/UCI move.
- Player perspective.
- Classification and severity.
- Position before the move.
- What the player played.
- Best or acceptable alternatives.
- Evaluation before, after, and after the best move.
- Material/tactical/positional evidence.
- A visual overlay and text alternative.
- An optional retry action.

### 4.5 Final learning summary

End the review with:

- Three strengths.
- Three highest-value improvements, ordered by expected learning value rather than raw centipawn loss alone.
- Repeated themes such as hanging pieces, missed checks, king safety, opening development, or endgame conversion.
- Retry positions as small practice puzzles.
- A short next-session checklist.

Avoid overwhelming the user with every engine fluctuation. The full move table remains available, but the guided path should prioritize a small number of actionable moments.

## 5. Technical architecture

### 5.1 Proposed modules

```text
PgnReviewScreen
├── PgnInput
├── GameMetadata
├── ReviewHighlights
│   ├── AccuracyCards
│   ├── PerformanceCards
│   ├── PhaseBreakdown
│   └── EvaluationGraph
├── ReviewBoard
│   ├── BoardRenderer
│   ├── EvaluationBar
│   └── AnnotationOverlay
├── MoveList
├── CoachPanel
│   ├── Explanation
│   ├── PrincipalVariation
│   ├── RetryMode
│   └── AudioControls
├── ReviewSettings
└── SelfAnalysisBridge
```

Domain and worker modules should be independent of the UI:

- `pgn/parser`: tokenization, headers, comments, NAGs, variations, FEN, and legality.
- `pgn/canonical`: normalized headers and movetext hash.
- `chess/position`: replayed board state, legal moves, material, repetition, and phase facts.
- `engine/worker`: Stockfish/WASM or another approved engine, isolated from the main thread.
- `engine/protocol`: request IDs, cancellation, progress, depth, multipv, and errors.
- `review/scoring`: evaluation normalization, expected points, accuracy, phase scores, and performance estimate.
- `review/classification`: Best/Excellent/Good/Book/Inaccuracy/Mistake/Miss/Blunder/Great/Brilliant rules.
- `review/keyMoments`: turning-point selection and ranking.
- `review/explanations`: evidence extraction and explanation templates.
- `review/opening`: ECO/opening lookup and book-move detection.
- `review/practice`: retry positions and practice prompts.
- `review/storage`: versioned cache, preferences, and export.

### 5.2 Core data model

Use versioned, serializable structures so a saved review can be migrated when engine or scoring behavior changes.

```ts
type ReviewRequest = {
  pgn: string;
  perspective: 'white' | 'black' | 'both';
  engine: {
    name: string;
    version: string;
    depth?: number;
    timeMs?: number;
    multiPv: number;
  };
};

type PositionSnapshot = {
  ply: number;
  moveNumber: number;
  fen: string;
  san?: string;
  uci?: string;
  sideToMove: 'w' | 'b';
  phase: 'opening' | 'middlegame' | 'endgame';
  material: { white: number; black: number };
};

type EngineResult = {
  fen: string;
  depth: number;
  score: { cp?: number; mate?: number; wdl?: [number, number, number] };
  principalVariations: Array<{ moves: string[]; score: EngineResult['score'] }>;
};

type MoveReview = {
  ply: number;
  played: string;
  best: string;
  alternatives: string[];
  classification: MoveClass;
  expectedPointsLoss: number;
  evaluationBefore: number;
  evaluationAfter: number;
  bestEvaluationAfter: number;
  evidence: Evidence[];
  isKeyMoment: boolean;
};

type ReviewReport = {
  schemaVersion: number;
  pgnHash: string;
  engine: { name: string; version: string; depth: number; multiPv: number };
  opening?: OpeningInfo;
  players: Record<'white' | 'black', PlayerReport>;
  phases: PhaseReport[];
  moves: MoveReview[];
  keyMoments: KeyMoment[];
  summary: Summary;
  generatedAt: string;
};
```

### 5.3 Analysis pipeline

1. Parse PGN headers and movetext.
2. Select one game and reject illegal or ambiguous movetext.
3. Replay every move and create immutable position snapshots.
4. Detect opening/book boundaries and game phases.
5. Analyze each relevant pre-move position and each played move in a worker.
6. Normalize scores to White's perspective internally and to the current player's perspective for explanations.
7. Calculate expected-points loss and accuracy.
8. Apply move classifications and extract evidence.
9. Select key moments using swing, tactical evidence, phase boundaries, and repetition suppression.
10. Generate report-card summaries and Coach-style explanations from the evidence.
11. Persist the versioned report and progressively update the UI.

Use cancellation and checkpoints. If the user navigates away or changes engine strength, cancel stale work and keep already completed analysis only when its engine/scoring fingerprint still matches.

## 6. Scoring and classification design

### 6.1 Evaluation normalization

The engine's raw centipawn score is not a human outcome probability. Convert it to a bounded expected-points value in `[0, 1]`, with:

- `1.00`: effectively winning for the side being measured.
- `0.50`: approximately even.
- `0.00`: effectively losing.

Handle mate scores separately and clamp extreme centipawn values before conversion. Store both raw engine score and normalized score so the UI can show an evaluation bar without losing auditability.

### 6.2 Accuracy

Implement a documented, deterministic score based on expected-points loss rather than a count of Best moves. A first version can use:

```text
moveAccuracy = 100 * f(expectedPointsBefore - expectedPointsAfter)
gameAccuracy = weightedMean(moveAccuracy for the player's plies)
```

The exact curve should be calibrated against fixtures and human-readable examples, not tuned to claim numerical equality with CAPS2. Accuracy must be stable under a repeat of the same engine version, depth, and settings.

### 6.3 Classification rules

Use a two-stage classifier:

1. Calculate expected-points loss and identify tactical/structural evidence.
2. Apply special rules for Book, Great, Brilliant, and Miss before selecting the severity label.

Initial rules:

- **Book:** move is present in the selected opening book and remains within the book boundary.
- **Best:** top engine move or an equivalent move within the configured tolerance.
- **Excellent:** very small expected-points loss.
- **Good:** playable move with a small but measurable loss.
- **Inaccuracy:** noticeable loss without immediate tactical collapse.
- **Mistake:** material, tactical, or positional deterioration large enough to change the practical situation.
- **Blunder:** severe loss, forced mate, or significant material loss.
- **Miss:** the opponent offered a materially better opportunity and the player failed to exploit it; compare the position before and after the opponent's error.
- **Great:** a critical move that changes the outcome or is the only/near-only move that preserves or creates a favorable result.
- **Brilliant:** a strong, difficult move with a verified sacrifice or tactical idea, while avoiding false positives when the position was already trivially winning or remains bad after the move.

Use configurable thresholds and record the classifier version in each report. Do not hard-code thresholds into UI components.

### 6.4 Game rating/performance estimate

Treat this as a separate optional model:

- Input: player rating if supplied, move quality distribution, opponent strength if supplied, game phase, and result.
- Output: one-game performance estimate with a confidence band.
- Copy must explain that it is not a permanent rating and can be noisy in a single game.
- If no player rating is supplied, show “not enough context” rather than inventing a precise number.

## 7. Explanation engine

### 7.1 Evidence-first generation

Every explanation must be constructed from verified evidence, in this order:

1. State the move and classification.
2. State the concrete consequence: mate, material, forced tactic, king safety, pawn structure, initiative, or endgame conversion.
3. Show the best move or a short principal variation.
4. Explain the key difference between the played move and the best move.
5. Give a practical takeaway.

Example template:

```text
{classification}: {playedMove} changed the evaluation from {before} to {after}.
The strongest response was {bestMove}, because {verifiedEvidence}.
After {pv}, {consequence}.
Practical lesson: {shortTakeaway}.
```

### 7.2 Explanation taxonomy

Detect and rank these evidence types:

- Checkmate or forced mate.
- Fork, pin, skewer, discovered attack, double attack, or zwischenzug.
- Hanging/undefended piece.
- Lost or won material.
- Missed check, capture, or forcing move.
- King exposure and castling opportunity.
- Development and piece activity.
- Pawn-structure change.
- Passed pawn or promotion race.
- Repetition, stalemate, insufficient material, or 50-move-rule context.
- Endgame conversion or defensive technique.

Only mention an evidence type when the analyzer can verify it on the before/after boards or in the principal variation. If confidence is low, use neutral wording such as “the engine prefers...” rather than asserting a human motif.

### 7.3 Optional language-model layer

Do not make a language model a prerequisite for the core product. Deterministic explanations are easier to test and keep local. A later opt-in language layer may:

- Rephrase verified facts for the user's skill level.
- Answer follow-up questions about a selected position.
- Produce a concise lesson summary.

It must receive structured evidence, not raw authority to invent lines. Validate its response against the stored legal moves and engine PVs before displaying it.

## 8. Retry and practice design

Each retry position should include:

- FEN and the original PGN ply.
- Side to move and user perspective.
- Target move set: best move plus accepted near-equivalents.
- Hint sequence: strategic clue, tactical clue, then move/line reveal.
- Immediate response after an attempt.
- The original evaluation, played-move evaluation, and retry-move evaluation.
- A short lesson and a link back to the original game move.

Use the same legal move validator as the PGN replay. Never accept a text move that the board does not consider legal.

Adjusted accuracy should be labeled as a hypothetical practice result. It must not overwrite the original game score.

## 9. Opening, book, and course data

### 9.1 Book moves

The opening detector should:

- Use a versioned, licensed opening database.
- Match positions by normalized FEN or zobrist key.
- Track the last position still in book.
- Return ECO, opening name, variation, and confidence.
- Distinguish “not in this book” from “not a theoretical move.”

### 9.2 Local game history

If the user imports multiple PGNs later, add a local archive index:

- `player identity -> opening -> color -> results -> sample size`.
- Explicit controls to exclude anonymous or opponent games.
- No cloud sync by default.
- Small, explainable samples; show `n` beside every aggregate.

### 9.3 Course deviation adapter

Keep course data behind an adapter interface:

```ts
interface OpeningCourseSource {
  listCourses(): Promise<CourseSummary[]>;
  lineFor(positionKey: string): Promise<CourseLine | null>;
  studyLink(courseId: string, lineId: string): string | null;
}
```

The first implementation should support a user-imported PGN/JSON course corpus. A Chess.com course connector is out of scope unless an official, permitted integration becomes available.

## 10. Delivery plan

Planning assumptions match the repository's existing Scrum conventions: two-week sprints, roughly 25 points per sprint, one senior engineer with part-time design and QA support. Story points include implementation, tests, review, and documentation.

### Sprint 0 — Product, legal, and reference specification (8 points)

**Goal:** lock the independent-parity scope before engine or UI work.

**Stories**

- **SPEC-01 (3):** Turn the feature inventory into a versioned product spec and explicitly mark core, optional, and unavailable features.
- **SPEC-02 (2):** Select an engine, opening database, and tablebase strategy; record licenses and distribution obligations.
- **SPEC-03 (3):** Define fixture games covering opening novelty, tactics, sacrifices, endgames, mates, draws, promotions, and malformed PGN.

**Acceptance criteria**

- No feature is described as exact Chess.com parity unless the implementation can verify that claim.
- Engine and opening-data licenses are approved before bundling assets.
- The test fixture list includes expected themes and known best moves.

**Dependencies:** none.

### Sprint 1 — PGN input, parsing, and legal replay (18 points)

**Goal:** make pasted PGN reliable and fully navigable.

**Stories**

- **PGN-01 (5):** Parse headers, comments, NAGs, nested variations, results, clock annotations, and multiple games.
- **PGN-02 (5):** Support standard initial positions and `SetUp`/`FEN` games, promotions, castling, en passant, checks, and checkmate.
- **PGN-03 (3):** Replay legal positions and produce canonical FEN/SAN/UCI snapshots.
- **PGN-04 (3):** Provide exact parser errors with move number, token, and recovery guidance.
- **PGN-05 (2):** Canonicalize the selected game and produce a stable cache hash.

**Acceptance criteria**

- Valid fixture PGNs replay to the expected final FEN and result.
- Illegal moves never reach the engine queue.
- Comments and variations do not alter the main-line replay unless the user explicitly selects a variation.
- A pasted game can be browsed move-by-move without engine analysis.

**Dependencies:** SPEC-03.

### Sprint 2 — Engine worker and progressive analysis (25 points)

**Goal:** analyze positions without freezing the interface.

**Stories**

- **ENG-01 (8):** Integrate the selected engine in a dedicated worker with a typed request/response protocol.
- **ENG-02 (5):** Add depth/time/multi-PV settings, cancellation, progress, and stale-request protection.
- **ENG-03 (5):** Analyze before/after positions, the played move, and best continuation for every main-line ply.
- **ENG-04 (4):** Add versioned analysis caching keyed by PGN hash and engine fingerprint.
- **ENG-05 (3):** Add engine failure, timeout, unsupported-browser, and low-resource messages.

**Acceptance criteria**

- The main thread remains responsive during a representative 200-ply review.
- The first summary appears progressively before every optional deep line finishes.
- Cancelling a review leaves no stale results in the active report.
- A cached report is rejected when the engine or scoring version changes.

**Dependencies:** Sprint 1; approved engine/license.

### Sprint 3 — Scoring, accuracy, phases, and classifications (25 points)

**Goal:** turn raw engine results into an auditable report.

**Stories**

- **SCORE-01 (5):** Normalize engine scores and mate states to expected points.
- **SCORE-02 (5):** Implement per-move and per-player accuracy with documented calibration fixtures.
- **SCORE-03 (5):** Implement phase detection and opening/middlegame/endgame summaries.
- **SCORE-04 (7):** Implement all ten move classifications and classifier versioning.
- **SCORE-05 (3):** Implement optional performance estimate and uncertainty/disclaimer copy.

**Acceptance criteria**

- White/Black score normalization is symmetric.
- A forced mate is never reported as a minor inaccuracy.
- A move's classification is reproducible with the same engine fingerprint.
- Miss, Great, and Brilliant require their special evidence and do not arise from centipawn loss alone.
- The report labels all metrics as independent from Chess.com.

**Dependencies:** Sprint 2.

### Sprint 4 — Highlights, graph, move list, and responsive board (25 points)

**Goal:** make the analysis understandable at a glance.

**Stories**

- **UI-01 (5):** Build the report card with player stats, classification counts, phase cards, and summary.
- **UI-02 (5):** Build synchronized evaluation graph with hover, click, keyboard, and touch interactions.
- **UI-03 (5):** Build responsive chessboard, evaluation bar, move list, and classification markers.
- **UI-04 (5):** Build desktop/tablet/mobile layout and robust empty/loading/error states.
- **UI-05 (5):** Add accessibility semantics, focus management, reduced motion, and screen-reader move descriptions.

**Acceptance criteria**

- Selecting a graph point selects the same move on the board and move list.
- The active key moment remains visible on mobile without hiding the board controls.
- Every board arrow/highlight has a text explanation or accessible label.
- Keyboard-only users can paste, start, navigate, and read a review.

**Dependencies:** Sprint 3.

### Sprint 5 — Guided Coach workflow, lines, and retry (30 points)

**Goal:** deliver the central learning loop.

**Stories**

- **REVIEW-01 (6):** Select and rank key moments, including last book move, critical swings, missed tactics, and game-ending errors.
- **REVIEW-02 (7):** Generate evidence-backed explanations and summaries.
- **REVIEW-03 (5):** Implement `Best`, `Show moves`, PV playback, and move notation.
- **REVIEW-04 (7):** Implement retry mode, hint sequence, accepted move set, and immediate feedback.
- **REVIEW-05 (5):** Add hypothetical adjusted accuracy and final learning summary.

**Acceptance criteria**

- `Next` visits ranked key moments without showing duplicate or trivial fluctuations.
- Explanations name the best move and give a legal, engine-backed continuation.
- Retry accepts only legal moves and distinguishes best, acceptable, and incorrect attempts.
- The original report remains unchanged after retry.
- A user can finish the review without opening Self Analysis.

**Dependencies:** Sprints 2–4.

### Sprint 6 — Opening context and local learning data (24 points)

**Goal:** add opening-aware and repeated-game value without requiring an account.

**Stories**

- **OPEN-01 (6):** Integrate licensed ECO/opening data and book boundary detection.
- **OPEN-02 (4):** Show opening name, variation, last book move, and confidence.
- **OPEN-03 (5):** Add local multi-PGN archive aggregates for opening frequency and results.
- **OPEN-04 (5):** Add practice-theme extraction and retry-position export.
- **OPEN-05 (4):** Add versioned report persistence and reopen/delete/export controls.

**Acceptance criteria**

- Opening labels identify their data source/version.
- History statistics show sample size and never infer a personal history from one game.
- Removing local data removes the report and derived aggregates.
- Exported PGN and practice positions are legal and re-importable.

**Dependencies:** Sprints 1, 3, and approved opening data.

### Sprint 7 — Settings, audio, and Self Analysis bridge (28 points)

**Goal:** cover configurable and adjacent features without confusing them with guided review.

**Stories**

- **PARITY-01 (4):** Add review perspective, best-move visibility, classification markers, autoplay, and Coach visibility settings.
- **PARITY-02 (4):** Add optional browser text-to-speech with mute, replay, captions, and fallback.
- **PARITY-03 (7):** Add Self Analysis view with evaluation bar, lines, suggestion arrows, threat arrows, and move feedback.
- **PARITY-04 (5):** Add score, time, best-move-difference, and theme charts where PGN clock data exists.
- **PARITY-05 (4):** Add alternate variation display and annotations without mutating the original game.
- **PARITY-06 (4):** Add optional tablebase adapter behind a capability check.

**Acceptance criteria**

- Every setting has a visible effect and persists locally.
- Audio never becomes the only form of feedback.
- Self Analysis is clearly labeled and can return to the guided review at the same position.
- Missing clock data disables the time chart with an explanation rather than showing fake values.
- Tablebase results are identified by tablebase source and piece-count limits.

**Dependencies:** Sprints 3–5; optional data sources.

### Sprint 8 — Skills and course-deviation adapters (22 points, optional)

**Goal:** provide extensible learning progression while keeping third-party content isolated.

**Stories**

- **LEARN-01 (5):** Define independent skill categories and evidence rules.
- **LEARN-02 (5):** Award points from verified move evidence and persist local progress.
- **LEARN-03 (5):** Add skill cards, progress, mastery, and disable/reset controls.
- **LEARN-04 (4):** Add imported course-line adapter and deviation detection.
- **LEARN-05 (3):** Add “study this line” links only for user-provided or permitted course sources.

**Acceptance criteria**

- A skill point always links to a concrete move and evidence.
- Disabling the feature stops new awards but does not silently delete progress.
- Course deviation reports show the source and line version.
- No Chess.com course content is copied or fetched through an undocumented path.

**Dependencies:** Sprints 1, 3, 5, and user-supplied/approved learning data.

### Sprint 9 — Performance, QA, security, and release (22 points)

**Goal:** make the review reliable for real pasted games and safe to ship.

**Stories**

- **QA-01 (5):** Add parser, replay, scoring, classifier, and explanation golden tests.
- **QA-02 (5):** Add browser end-to-end tests for paste, invalid input, review, graph navigation, retry, settings, export, and reopen.
- **QA-03 (4):** Add performance benchmarks for 40-, 100-, 200-, and 400-ply games at standard and deep settings.
- **QA-04 (4):** Add accessibility, reduced-motion, screen-reader, and mobile-touch checks.
- **QA-05 (4):** Complete threat model, dependency/license audit, privacy copy, and release documentation.

**Acceptance criteria**

- No unhandled parser, engine, or storage error reaches the user.
- Standard analysis has a documented time-to-first-summary target on supported devices.
- Engine memory is bounded and released after idle/cancellation.
- Reports are deterministic for a fixed engine/scoring fingerprint.
- The release checklist includes engine, opening data, tablebase, and optional language-model licenses.

**Dependencies:** all selected feature sprints.

**Estimated total:** 205 story points, or approximately 8–9 two-week sprints at 25 points per sprint, depending on whether optional Sprint 8 is included.

## 11. Testing strategy

### 11.1 Parser and chess-rule tests

- Standard PGN with comments, NAGs, and nested variations.
- Games beginning from a FEN position.
- Castling on both sides, en passant, promotion, underpromotion, check, mate, stalemate, repetition, and 50-move-rule metadata.
- SAN ambiguity and disambiguation.
- Illegal move, truncated movetext, invalid header, unsupported encoding, and multiple-game inputs.
- Unicode player/event names and unusual but valid headers.

### 11.2 Engine/scoring tests

- Known mate-in-one and forced-mate positions.
- Tactical fork, pin, skewer, sacrifice, hanging piece, and missed-opportunity fixtures.
- Equal alternatives that should not be penalized as blunders.
- White/Black mirror positions.
- Mate score normalization and sign handling.
- Score stability across repeated analysis.
- Cancellation and stale response handling.

### 11.3 Classification tests

For each classification, store:

- FEN before the move.
- Played move.
- Best move/PV.
- Expected evidence.
- Expected class range rather than a brittle single label when engine depth can change the boundary.

Run classification at the supported standard engine setting and separately at deep settings. Document intentional changes when a deeper analysis changes a label.

### 11.4 UI and interaction tests

- Paste valid PGN and start analysis.
- Paste invalid PGN and jump to the reported token.
- Navigate by graph, move list, keyboard, next key move, and touch.
- Hide/show best move and classification icons.
- Play and pause a shown line.
- Retry a best, acceptable, and incorrect move.
- Switch perspective.
- Mute and replay audio.
- Leave and reopen a cached report.
- Export and re-import the original PGN and practice position.

### 11.5 Performance targets

Set device-specific baselines rather than one universal promise. At minimum, measure:

- Time to parse and show the board.
- Time to first evaluation.
- Time to first report-card summary.
- Time to complete standard review.
- Peak worker memory and number of engine workers.
- Main-thread long tasks and input latency while analysis runs.
- Cache hit time.
- Cancellation time and resource release.

The board, move list, and controls must remain responsive while analysis continues. Deep analysis may be slower, but the UI must communicate the selected strength and estimated remaining work.

## 12. Definition of Done

Every story is complete only when:

- The behavior is covered by the appropriate unit, integration, browser, or manual test.
- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass when implemented in this repository.
- User-visible failures have a clear recovery path.
- No PGN is sent anywhere in local-only mode.
- Engine, opening, tablebase, and optional language-model dependencies are documented with versions and licenses.
- Metrics state their method, source, and limitations.
- Accessible text equivalents exist for board annotations, classifications, and graph points.
- The report schema and classifier version are recorded for saved reviews.

## 13. Recommended first release

The first useful release should stop after Sprint 5, with a small part of Sprint 6:

- Paste one PGN.
- Validate and replay it.
- Run a local engine review.
- Show graph, accuracy, phase breakdown, classifications, key moments, explanations, best lines, and retry.
- Export the report and practice positions.
- Clearly label all scores as independent analysis.

Defer account history, course deviations, Skills progression, cloud analysis, full tablebases, external lessons, and language-model explanations until the core engine-backed workflow is stable and tested.

## 14. Official references

- [How does Game Review work?](https://support.chess.com/en/articles/8584089-how-does-game-review-work) — current highlights, classifications, Coach navigation, key moves, settings, audio, retry, and review-vs-analysis behavior.
- [How are moves classified?](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc) — current Expected Points Model and definitions for Best, Excellent, Good, Inaccuracy, Mistake, Blunder, Great, Brilliant, and Miss.
- [How is accuracy in Analysis determined?](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined) — current CAPS2 description and accuracy caveats.
- [How is Game Rating calculated in Game Review?](https://support.chess.com/en/articles/10773754-how-is-game-rating-calculated-in-game-review) — single-game performance-rating behavior and limitations.
- [How do I use Game Analysis?](https://support.chess.com/en/articles/8583757-how-do-i-use-game-analysis) — adjacent Self Analysis controls, charts, themes, saving, and Cloud Analysis boundary.
- [Game Review redesign and features](https://www.chess.com/news/view/game-review-design-update) — report card, visual explanations, guided Coach placement, and analysis feedback.
- [Game Review course deviations](https://www.chess.com/news/view/announcing-game-review-course-check) — current course-deviation behavior and data dependency.
- [What are Skills on Chess.com?](https://support.chess.com/en/articles/16243840-what-are-skills-on-chess-com) — current Skills categories, points, mastery, and rollout notes.
- [How do the chess engines on Chess.com work?](https://support.chess.com/en/articles/9462780-how-do-the-chess-engines-on-chess-com-work) — current server-engine description and why exact engine parity cannot be assumed.
