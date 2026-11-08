# Project Audit: NoFollow Web

**Date:** November 2026  
**Audited Location:** `C:\Users\lenovo\Downloads\NoFollowWeb-portable`  
**Target Architecture:** Vercel Static Frontend + Automatic Windows Local Playwright Agent  

---

## 1. Executive Summary

NoFollow Web is a specialized Instagram relationship analysis and automation utility. The project has been audited to establish a clean, secure separation between:
1. **A cloud-agnostic, static frontend** deployable to Vercel.
2. **A strictly local Windows agent** running Node.js and Playwright that manages local JSON storage, Instagram browser sessions, job orchestration, and execution safeguards on the user's laptop.

No cloud database (e.g., Supabase), cloud backend (e.g., Render, Railway), or third-party cloud relay is required or permitted. All sensitive data, sessions, exports, and automations reside strictly on the user's Windows machine.

---

## 2. Codebase Inventory & Technology Audit

### 2.1 Frontend Framework & Structure
- **Framework:** Vanilla ES Modules with zero heavy frontend framework dependencies (No React, Vue, or Angular build steps required).
- **Core Entry Point:** [`index.html`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/index.html) serving CSS variables ([`assets/css/variables.css`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/css/variables.css)), application stylesheet ([`assets/css/app.css`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/css/app.css)), and main ES module ([`assets/js/app.js`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/js/app.js)).
- **Component Views:**
  - Client-side SPA routing (`location.hash`, e.g. `#/dashboard`, `#/non-followers`, `#/pending-requests`).
  - Views module: [`assets/js/views.js`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/js/views.js) renders reactive table views, KPI cards, sorting, search, and activity logs.
  - Reusable control panels: [`assets/js/panels.js`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/js/panels.js) implements engine panels, confirmation modals, and browser inspection panels.
  - State store: [`assets/js/state.js`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/assets/js/state.js) provides a lightweight global reactive store with event hooks.
  - Standalone HTML views: [`pages/pending-requests.html`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/pages/pending-requests.html) provides an isolated component for outgoing pending request management.

### 2.2 Application Entry Point & Runtime
- **Entry script:** [`unfollow.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/unfollow.mjs) invoking `main()` in [`src/server.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/server.mjs).
- **Runtime:** Node.js (v20+ supported; currently executing on Node.js v24.19.0).
- **Server:** Native Node.js `http` and `net` modules.
- **Port:** Configurable via `PORT` environment variable; defaults to `4173`.
- **Host Binding:** Strictly loopback `127.0.0.1` (never `0.0.0.0`).
- **Single-Instance Enforcement:** [`src/utils/instance-lock.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/utils/instance-lock.mjs) utilizing atomic lock file `data/.app.lock` with PID heartbeat validation and automatic stale-lock recovery.

### 2.3 Playwright & Browser Session Implementation
- **Dependency:** `playwright-core` (^1.65.0).
- **Browser Profile:** Dedicated persistent directory at [`profile/`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/profile).
- **Session Management:** [`src/automation/browser-session-manager.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/browser-session-manager.mjs) manages Chrome/Chromium launch channels, single browser instance locking (`data/.browser.lock`), and health detection.
- **Tab & Navigator:**
  - [`src/automation/browser-tab-manager.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/browser-tab-manager.mjs): Coordinates work tabs vs inspection tabs without duplicates.
  - [`src/automation/profile-navigator.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/profile-navigator.mjs): Manages navigation, DOM timeouts, and anti-detection delays.
- **Relationship & Session Detectors:**
  - [`src/automation/session-detector.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/session-detector.mjs): Detects `AUTHENTICATED`, `LOGIN_REQUIRED`, `CHALLENGE`, `SECURITY_PAUSED`.
  - [`src/automation/relationship-detector.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/relationship-detector.mjs): Evaluates profile DOM states (`FOLLOWING`, `NOT_FOLLOWING`, `REQUESTED`, `PROFILE_UNAVAILABLE`, `AMBIGUOUS`).

### 2.4 Existing Non-Followers Functionality (Protected)
- **Mathematical Formula:** Non-Followers = $\text{Following} - \text{Followers}$.
- **Export Data Source:** [`followers_1.html`](file:///C:/Users/lenovo/Downloads/instagram-palash_more-2026-11-07-WFz6R9Dp/connections/followers_and_following/followers_1.html) and [`following.html`](file:///C:/Users/lenovo/Downloads/instagram-palash_more-2026-11-07-WFz6R9Dp/connections/followers_and_following/following.html).
- **Verified Counts:**
  - Following: 1,801
  - Followers: 3,124
  - Non-Followers: 729
  - Mutual Followers: 1,072 ($1,072 + 729 = 1,801$).
- **Unfollow Controller:** [`src/automation/automation-controller.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/automation-controller.mjs) executing single-worker sequential actions with safety pauses.
- **State Checkpoint:** [`src/services/checkpoint-service.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/services/checkpoint-service.mjs) persisting to `data/execution-state.json`.

### 2.5 Existing Pending Requests Functionality (Protected & Repaired)
- **Source of Truth:** [`pending_follow_requests.html`](file:///C:/Users/lenovo/Downloads/instagram-palash_more-2026-11-07-WFz6R9Dp/connections/followers_and_following/pending_follow_requests.html) (11.7 MB).
- **Verified Counts:**
  - Total unique outgoing requests: **26,990**.
  - Missing dates: **0**.
  - Processing order: strictly chronological **Oldest-First** (`2017-01-31` earliest request to `2026-11-06` latest request).
- **Dedicated Parser:** [`src/services/pending-request-parser.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/services/pending-request-parser.mjs).
- **Independent State:** [`src/services/pending-request-state.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/services/pending-request-state.mjs) persisting to `data/pending-request-state.json`.
- **Cancellation Engine:** [`src/automation/pending-request-cancellation.mjs`](file:///C:/Users/lenovo/Downloads/NoFollowWeb-portable/src/automation/pending-request-cancellation.mjs).

### 2.6 Storage & Persistence Audit
All storage is local JSON with atomic writes (`atomicWriteJson`):
- `data/import.json`: Parsed Instagram relationship model and account caches.
- `data/execution-state.json`: Unfollow execution history and account statuses.
- `data/pending-request-state.json`: Outgoing pending request cancellation state.
- `data/settings.json`: User automation settings, interval configs, UI theme.
- `data/.app.lock`: Application single-instance lock file.
- `data/.browser.lock`: Browser session single-instance lock file.
- `logs/audit.log` & `logs/*.log`: Local execution and error diagnostic logs.

---

## 3. Gap Analysis for Vercel + Local Windows Agent Architecture

| Area | Current State | Target State | Required Action |
|---|---|---|---|
| **Frontend Hosting** | Served directly by local Node.js server at `http://127.0.0.1:4173` | Hosted on Vercel as a static SPA; also served locally as fallback | Configure `vercel.json`, decouple API base URL, implement pairing UI |
| **API Connectivity** | Relative URLs `/api/...` assuming same origin | Connects to configurable local loopback URL (`http://127.0.0.1:4173`) | Implement dynamic client with agent discovery and health verification |
| **Authentication & Pairing** | Loopback Host header and `X-NoFollow: 1` header | Cryptographic pairing token, short-lived session token, origin allowlist | Implement `PairingService`, pairing modal, bearer authentication |
| **Browser Security (PNA / LNA)** | Plain loopback HTTP | Cross-origin HTTPS-to-HTTP loopback handled gracefully | Detect Mixed Content / Local Network Access blocks, provide 1-click fallback |
| **Windows Startup** | Manual startup via `run.bat` or `node unfollow.mjs` | Automatic startup at Windows user logon via Task Scheduler | Implement `install-autostart.ps1`, `remove-autostart.ps1`, `check-agent.ps1` |
| **Job Orchestration** | Two separate engine controllers (`unfollow` & `cancel`) | Unified `CentralJobOrchestrator` managing central queue & approval | Build central queue with strict approval for every mutation |
| **Module Coverage** | Non-Followers & Pending Requests | 8 complete managers (Archive, Highlights, Analytics, Intelligence, etc.) | Implement remaining modular managers |

---

## 4. Safety & Boundary Invariants

1. **Zero Cloud Storage:** Never transmit cookies, credentials, exports, or profile data to Vercel or any cloud service.
2. **Loopback Only:** Agent must never bind to `0.0.0.0` or expose open network ports.
3. **Approval Gate:** Automated mutations (unfollowing, cancelling, archiving) must NEVER run automatically upon Windows logon or export import. Every mutating job requires explicit user confirmation.
4. **Single Mutating Worker:** Maximum of ONE active mutating browser automation at any given time.
5. **No Password Storage:** Instagram credentials are never requested, handled, or stored by code. User authenticates manually in the persistent browser profile.
