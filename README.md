# Richard's Projects

Personal project management hub for LP1 TSMS work. Tracks projects, milestones, risks, dependencies, goals, and progress reports.

> **This is a personal, confidential tool.** It lives on OneDrive — not GitHub, not `C:\Dev`. It contains goal check-in notes, project status, and internal strategy details that should not be committed to any repository.

## Location

```
C:\Users\L075876\OneDrive - Eli Lilly and Company\Documents\richards-projects\
```

This path is OneDrive-synced. If you switch machines, OneDrive will sync the entire project directory including all data files. Just run `npm install && npm start` on the new machine.

## Quick Start

```powershell
cd "C:\Users\L075876\OneDrive - Eli Lilly and Company\Documents\richards-projects"
npm install
npm start
```

Open [http://localhost:3200](http://localhost:3200).

## Where Data Lives

Everything is in the `data/` folder as JSON and Markdown files. OneDrive syncs these automatically — no manual backup needed.

```
data/
├── state.json              # Active projects, journal entries
├── goals/
│   ├── 2026_goals.json     # Imported annual goals
│   └── goal_project_map.json   # Which goals map to which projects
├── archive/
│   └── {project}_summary.json/.md   # Closed project reports
└── reports/
    └── {date}_checkin.md    # Generated progress reports
```

## Features

### Projects
Create, track, and close projects with milestones, dependencies, risks, and sync items. Each project gets a health indicator (On Track / At Risk / Critical / Complete) based on milestone status.

### Close & Archive
When a project is done, "Close & Archive" generates:
- A JSON snapshot with full project history and statistics
- A Markdown closure report with milestones, lessons learned, and key decisions
- Both are saved to `data/archive/` for permanent reference

### Goals Integration
Load your annual goals and map them to projects. When you generate progress reports, they connect project status back to the goals they support. Goals import is non-destructive — updating goals mid-year preserves all existing status and notes.

Import goals via CLI:
```bash
node scripts/import-goals.js my_goals.json
```

Or use Claude Code to parse a goals document into the expected format and call the API.

### Progress Reports
Generate check-in, quarterly, or annual reports. Reports are Markdown and pull from both project status and goal mappings. Saved to `data/reports/` for historical reference.

### PM Journal
Log decisions, lessons learned, risks, action items, and meeting notes. Tag entries to specific projects. Journal entries are included in closure reports.

### Sync Checklist
Track external artifacts (Loop pages, Planner boards, Figma diagrams) so you know what else to update when project status changes.

## Claude Code Integration

This project includes a `CLAUDE.md` with complete instructions for Claude Code. Point Claude Code at this directory and it can:

- Import and parse goals documents (any format)
- Update project status and milestones
- Generate progress reports
- Help create new projects from goals
- Drive improvements to the application itself

## Architecture

- **server.js** — Express server (port 3200) with REST API
- **public/index.html** — Single-page UI, no build step
- **data/** — All persistent state as JSON/Markdown files
- **scripts/** — CLI utilities

The server is intentionally minimal (one dependency: Express). The UI is vanilla JS — no React, no build tools, no CDN dependencies. It works on restricted corporate networks.
