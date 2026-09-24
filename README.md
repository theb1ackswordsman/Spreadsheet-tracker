# Tessera: Real-Time Collaborative Spreadsheet Engine

> **A real-time multiplayer spreadsheet built from first principles.** Features a custom incremental DAG formula engine running inside a Web Worker, deterministic monotonic WebSocket synchronization, live multiplayer presence, and Google OAuth workspace sharing—all with **zero heavy UI, grid, or state libraries**.

---

## Executive Summary

Most modern web spreadsheets either rely on server-side compute for formula recalculation or bundle massive, black-box libraries that lag under multi-cell dependencies. 

**Tessera was engineered from scratch** to prove that a modern browser can deliver desktop-class spreadsheet performance and real-time collaboration using pure algorithms:
1. **Never stall the UI**: All formula computation is offloaded to a background Web Worker singleton with an active watchdog supervisor.
2. **Only compute what changed**: A custom directed acyclic graph (DAG) dependency engine evaluates only the exact blast radius of affected downstream cells.
3. **Deterministic convergence**: Multiple concurrent collaborators converge to the exact same formula and value state using a sequenced operation log with automated session resumption.
4. **Transparent observability**: A built-in live Performance Strip exposes real-time telemetry on blast radius scope, recalculation latency (ms), DOM render counts, and network round-trip time (RTT).

---

## What Makes Tessera Unique?

### 1. Custom Incremental DAG Dependency Engine
Instead of brute-force evaluating cells or using `eval()`, Tessera implements an algorithmic compiler and dependency graph:
- **Custom Pratt Parser**: Tokenizes and parses expressions with proper operator precedence (`^` right-associativity, unary negatives, binary arithmetic, grouped parentheses, strings, numbers, ranges like `A1:B10`, and case-insensitive functions).
- **Bidirectional Dependency Tracking**: Maintains `deps` (cells read by a formula) and `rdeps` (formulas reading a cell). Reverse dependencies are maintained even for empty cells, so referencing an empty cell immediately links once data is entered.
- **Blast Radius Subgraph Extraction**: When a cell is edited, a multi-source Breadth-First Search (BFS) traverses only downstream dependents. In a sheet with 11,000+ formulas, editing an independent cell recalculates **only 3 cells in ~0.15 ms**, while a naive engine sweeps the entire sheet taking 10+ ms.
- **Kahn's Topological Sorting**: Evaluates dependencies in topological order using an array-head queue (avoiding $O(N^2)$ array shift penalties).
- **Tarjan's Strongly Connected Components (SCC)**: Automatically detects cyclic formula dependencies and self-loops (e.g., `A1 = =B1`, `B1 = =A1`), gracefully isolating the cycle, flagging affected cells as `#CIRCULAR!`, and allowing non-cyclic formulas to compute unaffected.

### 2. Built-in Incremental vs. Naive Engine Oracle & Switcher
Tessera includes two complete evaluation modes side-by-side in the live product:
- **Incremental Mode**: Production mode evaluating only the minimal topological blast radius.
- **Naive Mode**: Full-sheet baseline recalculating all formula cells.
- **Live UI Toggle**: The Performance Strip allows toggling between modes on the fly to inspect exact millisecond and scope differences.
- **10,000-Step Randomized Fuzzing Oracle**: An automated test suite subjects both engines to 10,000 random mutations, asserting that the incremental engine always produces results identical to the naive engine.

### 3. Worker-Isolated Compute with Watchdog Auto-Recovery
- **60 FPS Thread Isolation**: The main React UI thread is completely decoupled from the formula evaluation engine. Keystrokes, selections, and scrolling remain butter-smooth even while recalculating thousands of formulas.
- **Watchdog Supervisor**: The main thread bridge monitors worker execution with a 2,000 ms timeout. If an infinite loop or anomalous computation occurs, the worker is immediately terminated, respawned, and re-synchronized from the store's mirror without losing user state.

### 4. Deterministic Real-Time Sync & Conflict Awareness
- **Monotonic Operation Sequencer**: Operations are assigned sequential versions by the server, ensuring all connected clients apply edits in strict order.
- **Smart Session Resumption (`RESUME`)**: Each browser tab generates an in-memory 128-bit client ID (`cid`). If network connectivity drops, the client automatically reconnects with its last acknowledged version, receiving missed ops or a fresh snapshot without duplicating edits.
- **SELECT Broadcast Throttling**: Rapid cursor movements across cells are throttled to conserve network bandwidth while broadcasting crisp presence updates to collaborators.
- **Overwrite Awareness**: Tracks user edits in a rolling time window. If another collaborator overwrites a cell you recently modified, a non-intrusive notification notifies you immediately (e.g., *"Sarah changed B4 after your edit"*).

### 5. Multi-Client Chaos Bot Simulator (`npm run sim`)
Tessera includes a headless simulation harness to validate real-time convergence under stress:
- Launches a local server and connects **20 automated bot clients**.
- Simultaneously fires **2,000 concurrent edits** with simulated network latency, message interleaving, and randomized socket disconnect/reconnect cycles.
- Verifies that all 20 clients and the server converge to **identical cryptographic state hashes** (`raw_hash`, `val_hash`, and server version).

### 6. Fine-Grained Role-Based Access Control (RBAC) & Dynamic ACL
- **Google OAuth (Authorization-Code Flow)**: Secure server-side code exchange via popup UX; session credentials stored in HttpOnly, SameSite, Secure cookies.
- **Three Granular Roles**:
  - `Owner`: Full edit permissions, sheet renaming, and live share management.
  - `Editor`: Real-time editing and title updates.
  - `Viewer`: Read-only access with an active "View only" banner; formula bar and grid editors are disabled, and clipboard cut/paste/delete actions are rejected.
- **Dynamic Live Eviction**: If an owner restricts access or revokes a collaborator's permission, the server automatically updates connected roles live or severs the connection (code 4403), displaying an *"Access removed"* panel.

### 7. Virtualized Grid & Pure Design System
- **High-Density Virtualization**: Renders a 26-column by 1,000-row grid (26,000 addressable cells) with smooth vertical windowing and sticky headers.
- **Zero Third-Party Component Overhead**: Built without heavy UI libraries (Tailwind, MUI, AG Grid, Ant Design). All styles are driven by an ultra-lean CSS custom property design system (`tokens.css`) adhering to WCAG AA accessibility standards.

---

## Live Performance Telemetry

The built-in **Performance Strip** provides real-time, inspectable proof of engine efficiency:

| Metric | Incremental Mode | Naive Mode | What It Proves |
| :--- | :--- | :--- | :--- |
| **Localized Chain Edit (`O1`)** | **~0.15 ms** (Scope: 3) | **~10.5 ms** (Scope: 11,003) | Only affected cells are evaluated |
| **10,000 Fan-out Formulas** | **~10.6 ms** | ~45.0 ms | Sub-linear dependency scaling |
| **1,000 Sequential Chain** | **~1.7 ms** | ~18.2 ms | Efficient topological ordering |
| **UI Responsiveness** | **Steady 60 FPS** | Frequent frame drops | Web Worker compute isolation |
| **Round-Trip Time (RTT)** | Live EMA estimation | Live EMA estimation | Network latency transparency |

---

## Feature Comparison Matrix

| Capability | Standard Web Sheets | Tessera |
| :--- | :---: | :---: |
| **Formula Engine Location** | Main Thread / Cloud API | **Isolated Web Worker** |
| **Recalculation Strategy** | Full Sweep / Dirty Flags | **Incremental DAG (Blast Radius)** |
| **Cycle Handling** | Freezes / Max Call Stack | **Tarjan SCC Cycle Detection (`#CIRCULAR!`)** |
| **Engine Observability** | Hidden / DevTools only | **Live In-Product Performance Strip** |
| **Multiplayer Sync** | Heavy CRDTs (MB payloads) | **Sequenced Monotonic WS Protocol** |
| **Stress Simulation** | Manual QA | **Headless 20-Bot Chaos Simulator** |
| **Access Control** | Static Auth | **Dynamic Real-Time Role & Room Eviction** |
| **Bundle Size** | Megabytes of UI/Grid code | **Zero UI/State Dependencies** |

---

## Supported Formula Syntax & Operations

Tessera supports standard spreadsheet syntax parsed and evaluated from first principles:

- **Operators**: `+`, `-`, `*`, `/`, `^` (exponentiation, left-associative), unary `-`, and parentheses `()`.
- **References**: Relative (`A1`, `B12`) and absolute (`$A$1`, `A$2`) cell references.
- **Range Expansions**: Multi-cell rectangular ranges (`A1:C10`, `B2:B50`).
- **Core Aggregate Functions**:
  - `SUM(...)`: Sum of values, numbers, and ranges (skips empty and text cells).
  - `AVERAGE(...)`: Mathematical mean (skips empty and text; returns `#DIV/0!` if empty).
  - `MIN(...)` / `MAX(...)`: Extrema calculation across values and ranges.
  - `COUNT(...)`: Counts numeric cells exclusively.
- **Comprehensive Error Codes**:
  - `#CIRCULAR!`: Cyclic dependency detected via Tarjan SCC.
  - `#DIV/0!`: Division by zero.
  - `#NAME?`: Unknown function identifier.
  - `#REF!`: Reference outside grid boundary or range exceeding limits.
  - `#VALUE!`: Type errors, syntax errors, or arithmetic on non-numeric strings.

---

## Tech Stack & Architecture

```
[Browser Window]
  ├── UI Thread: React 18 + Virtualized Grid + History Router (tokens.css)
  │     ├── External Store (useSyncExternalStore)
  │     └── Bridge Controller (Watchdog Timer: 2000ms)
  │
  ├── Web Worker (Isolated Background Thread)
  │     └── Formula Engine (Pratt Parser + DAG Graph + Evaluator)
  │
  └── WebSocket Client
        └── Monotonic Sync Protocol (JOIN, RESUME, EDIT, SELECT, PRESENCE, ROLE)
              │
              ▼
[Node.js Server]
  ├── WebSocket Hub (Monotonic Log, Room Manager, Client Deduplication)
  ├── Auth & ACL (Google OAuth2 Code Exchange, Session Storage, Rate Limiting)
  └── Atomic Storage Engine (Multi-sheet isolated JSON persistence)
```

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node 20 / 22)
- npm

### Installation & Setup

```bash
git clone https://github.com/theb1ackswordsman/Spreadsheet-tracker.git
cd Spreadsheet-tracker
npm install
```

### Environment Configuration

Create a `.env` file in the root directory:

```env
PORT=8787
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
ALLOW_DEV_LOGIN=1
```

> **Note**: With `ALLOW_DEV_LOGIN=1`, you can instantly test all multi-user collaborative and sharing flows using the local developer bypass without configuring Google Cloud credentials.

### Running the Application

- **Development Mode** (Hot reload server & client concurrently):
  ```bash
  npm run dev
  ```
  Open `http://localhost:5173`.

- **Production Mode** (Optimized build served from Node with SPA fallback):
  ```bash
  npm run build
  npm run start:prod
  ```
  Open `http://localhost:8787`.

---

## Verification & Automated Testing

Tessera maintains a rigorous testing protocol with 100% passing tests:

```bash
# Run full Vitest suite (147 unit, engine, and integration tests)
npm test

# Run strict TypeScript validation
npm run typecheck

# Execute multi-client chaos bot convergence simulation
npm run sim

# Build production bundle
npm run build
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **Arrow Keys** | Navigate cells smoothly |
| **Enter / Shift+Enter** | Move down / up (or commit edit and move) |
| **Tab / Shift+Tab** | Move right / left (or commit edit and move) |
| **F2** or **Double Click** | Enter edit mode for the active cell |
| **Escape** | Cancel active edit / close popovers and menus |
| **Delete / Backspace** | Clear cell content |
| **Ctrl+C / Ctrl+V** | Copy and paste single cells or tab-delimited multi-cell ranges |
| **?** | Open keyboard shortcuts dialog |
