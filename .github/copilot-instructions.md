## Purpose

This file tells AI coding agents how to be immediately productive in the tsp_solver_react repository.
Focus on small, targeted changes: algorithm implementations under `src/algorithms`, parsing rules in `src/utils/coordinateParser.ts`, and the OpenRouteService integration in `src/services/openRouteService.ts`.

## Quick workspace facts & commands

- Language: TypeScript + React (Vite). Tests use Vitest + Testing Library.
- Start dev server: `npm run dev` (runs `vite`).
- Build: `npm run build` (runs `tsc && vite build`).
- Preview production build: `npm run preview`.
- Tests: `npm test` (Vitest). UI runner: `npm run test:ui`.

Use the scripts in `package.json` rather than the README’s older `npm start` reference.

## Key files and components (read these first)

- `src/App.tsx` — top-level app wiring: reads input, calls `fetchMatrix`, selects solver (adaptive/brute/heuristic) and requests route geometry. Good place to see end-to-end flow.
- `src/services/openRouteService.ts` — ORS integration and Haversine fallback. Note: when no API key or on ORS failures the code falls back to `buildHaversineMatrix` (approximate straight-line distances).
- `src/algorithms/*.ts` — solver implementations:
  - `adaptive.ts` picks brute-force for small N (BRUTE_FORCE_LIMIT = 9) and otherwise runs heuristic.
  - `bruteForce.ts` implements exhaustive search and must return a `SolveResult`.
  - `heuristic.ts` implements nearest-neighbour + 2-opt refinements.
- `src/utils/coordinateParser.ts` — flexible coordinate parsing. See examples below.
- `src/types.ts` — canonical data shapes (CoordinatePoint, MatrixData, SolveRequest, SolveResult, TravelMode, SolverMode).

## Important patterns & conventions

- Matrix indexing: `MatrixData.distances` is a square matrix whose rows/cols map to `MatrixData.sourceIds`/`destinationIds` (which mirror the `points` order passed to `fetchMatrix`). Keep the ordering consistent when producing or consuming matrices.
- API key header: `openRouteService` sets the ORS API key in the `Authorization` header. If `apiKey` is falsy, the module returns a Haversine fallback.
- ID generation: `parseCoordinateLines` sanitises labels to create stable `id` values using `sanitizeId(label, index)` — new code that manipulates points should preserve or accept these ids.
- Solver signatures: algorithms accept a `SolveRequest` and return a `SolveResult` (see `src/types.ts`). Adaptive solver returns an extra `notes` array in `solveAdaptiveTsp`.

## Examples & gotchas (useful snippets)

- Coordinate input accepted forms (examples you can paste into the UI/tests):
  - "51.5074, -0.1278, London"
  - "34.0522 -118.2437 Los Angeles"
  - "Point A; 48.8566, 2.3522"

- Calling the matrix service (see `src/App.tsx`):
  - `fetchMatrix({ apiKey, profile: 'driving-car', points })` → returns `{ data: MatrixData, warnings: string[], error?: string }`.
  - If ORS returns non-OK or invalid payload, the code falls back and surfaces a warning.

- Solver selection rules:
  - `solveAdaptiveTsp` uses brute-force for N <= 9 (BRUTE_FORCE_LIMIT = 9) otherwise heuristic.
  - The UI will still allow forcing `brute-force` mode; the app warns on very large N since brute-force can block the browser.

## Tests & development tips

- Unit tests live under `src/**/__tests__` (examples: `src/algorithms/__tests__/heuristic.test.ts`). Use Vitest (jsdom) — configuration is in `vite.config.ts`.
- When adding new algorithm tests, mock `MatrixData` distances carefully and use `CoordinatePoint[]` with predictable ids/ordering.

## Where to add features

- New solver: add a module under `src/algorithms/`, export a function matching `solve*(request: SolveRequest): SolveResult`, and wire it into `src/App.tsx` and/or `src/algorithms/adaptive.ts` if you want automatic selection.
- New matrix provider: update `src/services/openRouteService.ts` (handle fetch, validate payload) and ensure you emit `MatrixData` with `provider` set and `sourceIds`/`destinationIds` populated.

## Minimal checklist for PRs an agent should follow

1. Run `npm run test` and ensure tests pass locally.
2. Preserve or update `src/types.ts` for any shape changes.
3. Update `src/App.tsx` wiring when changing solver public API (inputs/outputs).
4. Add or update tests under `src/**/__tests__` showing the new behavior.

## If you need help understanding behavior

- Read `src/services/openRouteService.ts` to understand how real routing data is consumed and when the app falls back to Haversine distances.
- Open `src/algorithms/heuristic.ts` and `src/algorithms/bruteForce.ts` for concrete algorithmic decisions (2-opt iterations, candidate selection, loop handling).

---
If anything in this file is unclear or you want more examples (e.g. sample test stubs for a new solver), tell me what area to expand and I will iterate.
