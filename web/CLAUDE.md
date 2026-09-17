# Calcsta — Basic 2D Web App

Calcsta is a Basic-only 2D structural analysis application. The web product
uses a Svelte 5 + TypeScript UI, Vite, a Canvas 2D viewport, and the shared
Rust/JavaScript analysis engine for planar frame and truss models.

## URLs and commands

- Production: `https://calcsta.pages.dev`
- Local development: `npm run dev` (port 4000)
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit`
- Optional WASM build: `npm run wasm`

Every web route is normalized to `/app/basic`; `/` and `/app/` are aliases.

## Product boundary

The browser product has one static Basic layout. It provides planar nodes,
frame/truss members, supports, 2D loads, linear/P-Δ/buckling/modal/dynamic
analysis, moving loads, section stress, DXF 2D import, and save/share/report
exports. New project, session, autosave, and share artifacts contain only this
2D model format. Legacy Basic metadata (`appMode: "basico"`,
`analysisMode: "2d"`, zero `z`) is ignored on read; spatial entities and
non-2D modes are rejected without mutating the current model.

The independent `dedaliano-engine` Rust crate may retain its own APIs and
validation coverage. Those APIs are not exposed by the web product.

## Architecture

- `src/App.svelte` — Basic shell, route normalization, autosave/share wiring
- `src/components/Viewport.svelte` — Canvas 2D rendering and interaction
- `src/components/ribbon/Ribbon.svelte` and `BasicPanel.svelte` — Basic tools
- `src/lib/store/model.svelte.ts` — model CRUD and 2D snapshots
- `src/lib/store/file.ts` — `.ded`, session, autosave, CSV/PDF/Excel/SVG/PNG I/O
- `src/lib/utils/url-sharing.ts` — compressed 2D share links
- `src/lib/engine/` — 2D DSM, advanced analysis, diagrams and stress helpers
- `src/lib/dxf/` — R12 DXF import/export

Use Svelte 5 runes, keep model snapshots plain and structured-cloneable, and
preserve the repository typecheck baseline. The Canvas viewport owns its
`requestAnimationFrame` loop; avoid reintroducing product-specific spatial
rendering or mode switches.

## Conventions

- Code and comments are English; the maintained UI locales are Spanish,
  English, Korean, and Portuguese.
- SI units only (m, kN, kN·m, MPa).
- Use `rg` for source searches and `apply_patch` for edits.
- Do not push `main` without explicit user approval.
