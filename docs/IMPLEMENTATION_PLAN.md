# Implementation Plan: Vercel Frontend + Windows Local Agent

**Project:** NoFollow Web  
**Location:** `C:\Users\lenovo\Downloads\NoFollowWeb-portable`  

---

## 1. Overview of Execution Phases

This implementation plan organizes the system evolution into 13 discrete, sequential phases with strict validation gates:

| Phase | Milestone | Primary Deliverable |
|---|---|---|
| **Phase 1** | Repository Audit & Architecture Docs | `docs/PROJECT_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md` |
| **Phase 2** | Frontend & Local Agent Separation | Clean boundary between static SPA assets and local agent backend |
| **Phase 3** | Local Agent Security & Pairing Service | `src/services/pairing-service.mjs`, bearer auth, origin validation, CORS/PNA |
| **Phase 4** | Vercel Connectivity & Client Pairing | `assets/js/agent-client.js`, "Connect Local Agent" UI, pairing modal, fallback |
| **Phase 5** | Windows Automatic Startup | `scripts/install-autostart.ps1`, `scripts/remove-autostart.ps1`, `scripts/check-agent.ps1` |
| **Phase 6** | Playwright Session & Engine Integration | Persistent profile, manual login, session verification, recovery |
| **Phase 7** | Existing Modules Preservation | Zero regressions on Non-Followers ($1,801 - 3,124 = 729$) & Outgoing Pending ($26,990$) |
| **Phase 8** | Central Job Orchestrator & Approval Gate | `src/automation/central-orchestrator.mjs`, queue management, single worker |
| **Phase 9** | Additional Modules Implementation | Archive Manager, Highlights, Followers Intelligence, Analytics, Import/Export |
| **Phase 10** | Local Persistence & Data Isolation | `data/` schemas, atomic writes, `.gitignore`, `.vercelignore` isolation |
| **Phase 11** | Vercel Deployment Configuration | `vercel.json`, static asset routing, SPA rewrites, deployment guide |
| **Phase 12** | Local Fallback Dashboard Verification | Simultaneous direct loopback access at `http://127.0.0.1:4173` |
| **Phase 13** | Verification, Testing & Final Report | Full test suite execution, autostart verification, 100% pass guarantee |

---

## 2. Phase-by-Phase Technical Tasks

### Phase 2: Frontend & Agent Separation
- Extract API endpoint resolution into a centralized client helper ([`assets/js/agent-client.js`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/js/agent-client.js)).
- Enable dynamic configuration of the local agent URL (`http://127.0.0.1:4173` by default).
- Ensure all asset paths are relative or root-compatible for Vercel CDN deployment.

### Phase 3: Local Agent Security & Pairing Service
- Create [`src/services/pairing-service.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/services/pairing-service.mjs):
  - Manages pairing PIN generation and storage in `data/pairing.json`.
  - Generates secure random session tokens (`crypto.randomBytes(24).toString('hex')`).
  - Implements token expiration (default 30 days, revocable anytime).
- Add middleware in [`src/server.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/server.mjs):
  - Preflight `OPTIONS` handler with `Access-Control-Allow-Private-Network: true`.
  - Origin verification against allowed origins list (`settings.allowedOrigins`).
  - Bearer token validation for external / Vercel cross-origin requests.

### Phase 4: Vercel Connectivity & Pairing Workflow
- Implement "Connect Local Agent" bar/button in the topbar of the frontend.
- When running on a remote origin (e.g. `*.vercel.app`):
  - Display agent connection status indicator (`Disconnected`, `Connecting`, `Connected`).
  - Open a pairing modal where user enters the 6-character PIN shown on their local agent console.
  - Test health against `GET /api/ping`.
  - Handle Mixed Content / Local Network Access blocks gracefully:
    - Display diagnosis explaining browser security restrictions.
    - Provide a direct link: **"Open Local Dashboard (http://127.0.0.1:4173)"** which works 100% out of the box.

### Phase 5: Automatic Windows Startup
- Create [`scripts/install-autostart.ps1`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/scripts/install-autostart.ps1):
  - Uses Windows Task Scheduler (`Register-ScheduledTask`) with trigger `AtLogOn`.
  - Launches `node unfollow.mjs` in the project root directory.
  - Ensures interactive user session execution.
- Create [`scripts/remove-autostart.ps1`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/scripts/remove-autostart.ps1):
  - Unregisters the scheduled task cleanly.
- Create [`scripts/check-agent.ps1`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/scripts/check-agent.ps1):
  - Queries scheduled task state and queries `http://127.0.0.1:4173/api/ping`.

### Phase 6 & 7: Playwright & Existing Modules Preservation
- Retain existing `BrowserSessionManager`, `BrowserTabManager`, and `ProfileNavigator`.
- Keep Non-Followers calculations, state, and checkpoints 100% untouched.
- Keep Pending Requests calculations, state, and checkpoints 100% untouched.

### Phase 8: Central Job Orchestrator
- Create [`src/automation/central-orchestrator.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/central-orchestrator.mjs):
  - Unifies execution of `unfollow`, `cancel`, `archive`, `story_highlights`.
  - Enforces Single Mutating Worker rule.
  - Requires explicit user approval for any queued mutation (`confirm: true`).
  - Persists queue state in `data/central-queue-state.json`.

### Phase 9: Additional Modular Managers
- Add modules to navigation and routes:
  1. **Post Archive Manager**: Inspect posts, queue safe archives with user confirmation.
  2. **Stories & Highlights Manager**: Track stories, viewer history, highlights stats.
  3. **Followers Intelligence**: Deep segmentation (mutuals, fans, ghost followers, follow-back ratio).
  4. **Instagram Analytics**: Account health KPIs, growth trajectory, relationship breakdown.
  5. **Import/Export Center**: Inspect loaded HTML/JSON export files, summary verification.
  6. **Automation Queue**: Central dashboard view of queued, running, and completed jobs.

### Phase 10: Local Persistence & Data Isolation
- Maintain `.gitignore` and `.vercelignore` to strictly exclude:
  - `data/`
  - `profile/`
  - `logs/`
  - `backups/`
  - Export archives and secrets.

### Phase 11: Vercel Deployment Configuration
- Create `vercel.json` with clean static rewrites and HTTP security headers.
- Document deployment steps using Vercel CLI or Git repository linking.

### Phase 12 & 13: Local Fallback & Comprehensive Testing
- Verify that both `http://127.0.0.1:4173` (local fallback) and Vercel remote frontend work seamlessly.
- Run complete automated test suite ensuring 100% pass rate.
