# Tessera

Tessera is a real-time multiplayer collaborative spreadsheet built from first principles. It combines a custom incremental DAG formula engine running in a Web Worker, a deterministic WebSocket sync protocol, and role-based workspace sharing.

---

## Key Features

- **Incremental Formula Engine**: Custom dependency graph with Pratt formula parser, Kahn's topological sort, and Tarjan's strongly connected components (SCC) algorithm for cycle detection (`#CIRCULAR!`). Only cells within the blast radius of a change are recalculated.
- **Worker-Isolated Compute**: Formula evaluation runs entirely off the main thread in a dedicated Web Worker singleton with watchdog auto-recovery, ensuring 60 FPS UI responsiveness even during heavy recalculations.
- **Deterministic Real-Time Sync**: Server-sequenced monotonic operation log over WebSockets. Automatic reconnection with session resumption (`RESUME`), client deduplication (`cid`), and conflict convergence.
- **Multiplayer Presence**: Live collaborator cell cursors with distinct presence colors, initial avatars, name tags, and SELECT throttling.
- **Role-Based Access Control**: Google OAuth authorization-code popup flow with secure HttpOnly session cookies. Sheet access levels for Owners, Editors, and Viewers with live role transition and room eviction.
- **Performance Diagnostics**: Built-in collapsible Performance Strip displaying blast radius scope, populated cells, recalculation time (ms), cells re-rendered, network round-trip time (RTT), and live Incremental vs. Naive comparison.
- **Stress-Tested Scale**: Virtualized 26-column by 1,000-row grid (26,000 addressable cells), capable of evaluating 11,000+ formula cells with sub-millisecond incremental updates.

---

## Performance Benchmarks

Measured on incremental recalculation mode:
- **10,000 fan-out formulas**: ~10.6 ms
- **1,000 chained formula dependencies**: ~1.7 ms
- **Localized edit blast radius**: Sub-millisecond (~0.15 ms for localized 3-cell chains vs. ~10+ ms full-sheet naive sweep)

---

## Tech Stack

- **Client**: React 18, TypeScript (strict), Vite, Web Workers, History API router, Vanilla CSS design tokens
- **Server**: Node.js, `ws` (WebSockets), atomic filesystem persistence
- **Auth**: Google OAuth via `google-auth-library` (with local developer bypass for offline testing)
- **Engine**: Pure TypeScript, zero external dependencies

---

## Getting Started

### Prerequisites

- Node.js 18+ (tested on Node 20 / 22)
- npm

### Installation

```bash
git clone https://github.com/theb1ackswordsman/Spreadsheet-tracker.git
cd Spreadsheet-tracker
npm install
```

### Environment Configuration (Optional)

Create a `.env` file in the root directory if configuring Google OAuth:

```env
PORT=8787
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
ALLOW_DEV_LOGIN=1
```

> **Note**: When `ALLOW_DEV_LOGIN=1` is set, a "Dev sign-in" link is available for local loopback development without requiring Google Cloud credentials.

### Development Mode

Run the development server (Node WebSocket/API server + Vite dev server concurrently):

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

### Production Build & Serve

```bash
npm run build
npm run start:prod
```

Visit `http://localhost:8787` in your browser.

---

## Verification & Testing

Tessera includes an automated test suite, typecheck, and a multi-client bot simulation:

- **Unit and Integration Tests**:
  ```bash
  npm test
  ```
  Runs 147 test cases covering the formula parser, evaluator, dependency graph, cycle detection, hostile inputs, stress tests, server ACLs, and routing.

- **Typecheck**:
  ```bash
  npm run typecheck
  ```

- **Oracle Equivalence Test**:
  Runs 10,000 random sequences verifying exact output equivalence between incremental and naive recalculation modes.

- **Multiplayer Bot Simulation**:
  ```bash
  npm run sim
  ```
  Spawns 20 concurrent bot clients sending 2,000 edits with randomized connection dropouts to verify convergence to identical state and version.

---

## Project Structure

```
src/
├── engine/             # Pure TypeScript formula engine (zero external dependencies)
│   ├── constants.ts    # Grid dimensions (26x1000) and engine constraints
│   ├── types.ts        # CellId, Result, Node, Stats, Mode
│   ├── parser.ts       # Pratt parser for formulas and expressions
│   ├── evaluator.ts    # Mathematical and aggregate function evaluation
│   ├── graph.ts        # Dependency DAG, Kahn's algorithm, Tarjan's SCC
│   └── engine.ts       # Engine facade combining graph and evaluation
├── shared/
│   └── protocol.ts     # Client-to-server (C2S) and server-to-client (S2C) message contracts
├── server/
│   ├── index.ts        # HTTP REST server, WebSocket server, static file serving
│   ├── room.ts         # In-memory room manager and client broadcaster
│   ├── auth.ts         # Session management, rate limiting, Google OAuth
│   └── sheets.ts       # Sheet metadata, persistence, and access control
└── client/
    ├── main.tsx        # React root boot
    ├── Root.tsx        # Top-level routing, auth boot, and sheet state
    ├── Landing.tsx     # Landing page with Google and dev authentication
    ├── AuthPanel.tsx   # Access gate panel for unauthenticated / unauthorized requests
    ├── SheetPage.tsx   # Sheet container managing socket lifecycle
    ├── App.tsx         # Main spreadsheet interface (TopBar, Toolbar, FormulaBar, Grid)
    ├── Grid.tsx        # Virtualized grid container with keyboard navigation
    ├── Cell.tsx        # Individual cell renderer with presence borders and selection
    ├── FormulaBar.tsx  # Name box, fx label, formula editor, and error explanations
    ├── PerformanceStrip.tsx # Live metrics and mode toggle
    ├── bridge.ts       # Main-thread bridge communicating with Web Worker
    ├── worker.ts       # Web Worker entry evaluating formula engine
    ├── socket.ts       # WebSocket singleton handling sync, rejoin, and presence
    ├── store.ts        # Reactive external store with useSyncExternalStore
    └── styles/
        └── tokens.css  # CSS custom properties design tokens
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **Arrow Keys** | Navigate cells |
| **Enter / Shift+Enter** | Move down / up (or commit edit and move) |
| **Tab / Shift+Tab** | Move right / left (or commit edit and move) |
| **F2** / **Double Click** | Enter edit mode for selected cell |
| **Escape** | Cancel active edit / close open popovers |
| **Delete / Backspace** | Clear selected cell value |
| **Ctrl+C / Ctrl+V** | Copy / paste cell values and tab-delimited ranges |
| **?** | Open keyboard shortcuts help |
