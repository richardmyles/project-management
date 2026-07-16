# CLAUDE.md — My Projects (Shareable Edition)

## What This Is

A self-contained, file-based project management tool. Tracks projects, milestones, risks, dependencies, goals, and progress reports. Data persists as JSON files in `data/`. Designed to be shared with colleagues — each user personalizes it on first run via a setup modal.

**Location:** *(your local clone path)*

## Architecture

```
Project Management/
├── server.js              # Express server (port 3201, auto-opens browser on start)
├── public/index.html      # Single-page app (628 lines, vanilla JS, innerHTML re-render)
├── package.json
├── config.json            # User personalization (name, team, org, primaryColor, setupComplete)
├── uploads/               # Temp storage for .docx uploads — auto-deleted after parse
└── data/
    ├── state.json         # Active projects, journal, tasks
    ├── .history/          # Undo/redo snapshots (up to 30, numbered JSON files)
    ├── drafts/            # Report drafts
    ├── goals/
    │   ├── {year}_goals.json          # Goals by year
    │   └── goal_project_map.json      # Maps goal IDs → project IDs
    ├── archive/
    │   ├── {id}_{short}_{date}.json   # Closed project snapshots
    │   └── {id}_{short}_{date}.md     # Closure report (markdown)
    └── reports/
        └── {date}_{type}.md/.docx     # Generated progress reports
```

## Running

```bash
npm install
npm start    # http://localhost:3201 — browser opens automatically
```

On first run, the browser shows a setup modal. Fill in name, team, org, and accent color, then click "Get Started". This writes `config.json` with `setupComplete: true`.

## Key Behaviors

### First-run setup
`config.json` ships with `setupComplete: false`. On page load, `GET /api/config` is fetched — if `setupComplete` is false, the setup overlay is shown before any app content renders. After the user fills in their details, `PUT /api/config` is called and the app renders normally.

The `--primary` CSS variable is set from `cfg.primaryColor` at load time, so the header, active tabs, and accents all use the user's chosen color.

### Goals import from .docx
Upload a Word document via the Goals tab. The server uses `mammoth` to convert it to HTML, then `parseGoalsFromHtml()` extracts:
- Headings (`<h1>`–`<h6>`) and fully-bold paragraphs → goal categories
- List items (`<li>`) → individual goals, with nested lists as sub-items
- Plain paragraphs (length > 8 chars) → goals under the current category

Parsed goals merge non-destructively into `data/goals/{year}_goals.json`. Existing goals keep their status and quarterly notes; new ones are added as `on-track`; goals no longer present are marked `discontinued`, not deleted.

### Auto-categorization suggestions
When creating a project or task, `suggestGoals()` runs client-side: it splits the input text into words (4+ chars, filtered against a stop-word set), scores each goal by the fraction of words that appear in that goal's text/category/subItems, and surfaces the top matches as clickable chips above `0.05` score. No server call needed — goals are loaded into the global `goals` object at startup.

### Undo/redo
Every state save (`PUT /api/state`, `PATCH /api/project/:id`, etc.) pushes the previous state to `data/.history/` before writing. Up to 30 snapshots are kept. `POST /api/undo` restores the latest snapshot; `POST /api/redo` reapplies from an in-memory redo stack.

### Closing a project
`POST /api/project/:id/close` generates a JSON snapshot + markdown closure report in `data/archive/`, then removes the project from active state. Lesson/decision journal entries tagged to that project are pulled into the closure report automatically.

### Report export
`POST /api/reports/export-docx` uses the `docx` npm package to build a formatted Word document. It reads `config.json` for the header/footer (name, team, org). Report detail levels: `summary`, `checkin`, `full`, `comprehensive`. The generated `.docx` is saved to `data/reports/` and returned as a download URL.

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/config | Read config.json |
| PUT | /api/config | Write config.json (sets setupComplete: true) |
| GET | /api/state | Full project state |
| PUT | /api/state | Save full state |
| POST | /api/project | Add new project |
| PATCH | /api/project/:id | Update single project |
| DELETE | /api/project/:id | Remove project |
| POST | /api/project/:id/close | Close project → archive |
| POST | /api/undo | Restore previous state snapshot |
| POST | /api/redo | Reapply undone state |
| GET | /api/history/count | Count of available undo/redo steps |
| GET | /api/goals | All loaded goals (keyed by year) |
| POST | /api/goals/import | Import goals from structured JSON |
| PATCH | /api/goals/:goalId | Update a single goal (status, quarterly notes) |
| GET | /api/goals/map | Goal → project mapping |
| PUT | /api/goals/map | Update goal → project mapping |
| POST | /api/goals/upload-docx | Parse a .docx file → import goals |
| GET | /api/reports | List all reports |
| POST | /api/reports/generate | Generate markdown progress report |
| POST | /api/reports/export-docx | Generate Word (.docx) progress report |
| GET | /api/reports/:filename | Read or download a report |
| GET | /api/archive | List all archived projects |
| GET | /api/archive/:filename | Read an archive file (JSON, MD, or DOCX) |
| POST | /api/archive/:id/export-docx | Export closure report as .docx |
| GET | /api/tasks | List all tasks |
| POST | /api/tasks | Add a task |
| PATCH | /api/tasks/:id | Update a task |
| DELETE | /api/tasks/:id | Delete a task |

## Data Contracts

### config.json
```json
{
  "name": "Jane Smith",
  "team": "Manufacturing Sciences",
  "org": "Acme Corp",
  "primaryColor": "#0F3A85",
  "setupComplete": true
}
```

### state.json
```json
{
  "lastUpdated": "ISO timestamp",
  "projects": [
    {
      "id": "string",
      "name": "string",
      "shortName": "3-4 char code",
      "color": "hex",
      "owner": "string",
      "sponsor": "string",
      "targetDate": "YYYY-MM-DD",
      "archived": false,
      "description": "string",
      "dependencies": ["string"],
      "risks": [{"text": "string", "severity": "high|medium|low"}],
      "links": [{"label": "string", "url": "string"}],
      "goalRefs": ["goal IDs"],
      "milestones": [
        {
          "id": "string",
          "name": "string",
          "target": "YYYY-MM-DD",
          "status": "complete|in-progress|at-risk|blocked|not-started",
          "notes": "string",
          "owner": "string",
          "bullets": ["string"],
          "links": [{"label": "string", "url": "string"}]
        }
      ]
    }
  ],
  "journal": [
    {
      "id": "string",
      "date": "YYYY-MM-DD",
      "text": "string",
      "project": "project ID or 'all'",
      "type": "decision|lesson|risk|action|note|meeting"
    }
  ],
  "tasks": [
    {
      "id": "string",
      "text": "string",
      "status": "open|done",
      "created": "YYYY-MM-DD",
      "completed": "YYYY-MM-DD or null",
      "notes": "string",
      "tags": ["string"],
      "project": "project ID or null",
      "owner": "string",
      "bullets": ["string"],
      "links": [{"label": "string", "url": "string"}]
    }
  ]
}
```

### {year}_goals.json
```json
{
  "year": 2026,
  "importedAt": "ISO timestamp",
  "goals": [
    {
      "id": "g-1",
      "category": "Deliver Results",
      "text": "Full goal text",
      "subItems": ["bullet items"],
      "linkedProjects": ["project IDs"],
      "status": "on-track|needs-attention|complete|discontinued",
      "q1Notes": "",
      "q2Notes": "",
      "q3Notes": "",
      "q4Notes": ""
    }
  ]
}
```

## Non-destructive Goal Updates (Critical)

When importing new goals, NEVER:
- Delete goals that are missing from the new document — mark as `discontinued`
- Overwrite quarterly notes that already have content
- Remove `linkedProjects` references

Always show the user a summary of what changed (added / updated / discontinued counts) before committing.

## Release Workflow

Standard workflow for any release/push to GitHub. **Every release must ship with the built `.exe` (installer + portable) attached** — a release with no downloadable app is not a complete release. **Every release must also leave README.md in sync with the new version** — a release where the docs describe an older version is not a complete release either.

1. **Pull first** — `git fetch origin` and rebase/merge local commits onto `origin/master` before pushing, to avoid rejected pushes.
2. **Bump the version** in `package.json` before pushing:
   - Default: patch bump (`1.0.5` → `1.0.6`) for bug fixes and small updates.
   - Minor/major bump only when explicitly specified as a bigger update (e.g. `1.0.x` → `1.1.0` or `2.0.0`).
3. **Update README.md in the same commit as the version bump:**
   - Bump the version string in the Download section (`My Projects Setup 1.0.5.exe` → `1.0.6.exe`), in both the table and the installer instructions.
   - Add/update the Features list if the release adds, changes, or removes user-facing functionality.
   - Update the Data Storage / directory listing if data file structure changed.
   - Never let README describe an older version than what's actually being released — check the diff for stale version strings before committing.
4. **Commit message** must summarize what changed — not just the fix, but a short list of updates included in that release.
5. **Push the commit, then push a matching tag** (`git tag vX.Y.Z && git push origin vX.Y.Z`) — the tag push is what triggers `.github/workflows/release.yml`, which builds the Windows installer/portable `.exe` and uploads them via `electron-builder --publish always`.
6. **Do NOT create or edit the GitHub release before the workflow finishes.** `gh release create` (or any release created before the build completes) creates a *published* release; electron-builder's publish step then finds an "incompatible" existing release type and silently skips every asset upload — this broke releases v1.0.2 through v1.0.5 with zero `.exe` attached and no visible error. Let the workflow create the release itself.
7. **Wait for the workflow, then verify assets attached** — `gh run watch` or `gh run list --workflow=release.yml --limit 1`, then `gh release view vX.Y.Z --json assets` and confirm the installer `.exe`, `.exe.blockmap`, portable `.exe`, and `latest.yml` are all present. If assets are empty, do not consider the release done — check the run log for `existing type not compatible with publishing type`.
8. **Only after assets are confirmed**, add/refine release notes with `gh release edit vX.Y.Z --notes "..."` — this only edits metadata and never touches uploaded assets.

## Dependencies

| Package | Purpose |
|---------|---------|
| express ^4.21 | HTTP server |
| mammoth ^1.8 | .docx → HTML for goals import |
| multer ^1.4.5-lts | Multipart file upload handling |
| docx ^9.6 | Word document generation for report export |

## UI Tabs

Dashboard · Projects · Tasks · Goals · Timeline · Board · Journal · Reports · Sync · Archive

The **Goals** tab shows goals grouped by category with status badges and collapsible Q1–Q4 notes fields, plus a `.docx` upload section at the top.
