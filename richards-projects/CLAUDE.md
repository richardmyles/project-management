# CLAUDE.md — Richard's Projects

## What This Is

Richard's personal project management hub for LP1 TSMS work at Eli Lilly's Lebanon API Manufacturing Plant. Tracks projects, milestones, ad-hoc tasks, goals, and generates progress reports as branded .docx files.

**Location:** `C:\Users\L075876\OneDrive - Eli Lilly and Company\Documents\richards-projects\`
**CONFIDENTIAL — NOT FOR GITHUB.** Do not suggest version control or moving to `C:\Dev`.

## ⚠ MANDATORY PROTOCOL — Read Before Every Session

**Every time you touch this project, follow this sequence. No exceptions.**

### Before ANY change:
1. **Read this entire CLAUDE.md** to understand current state and architecture.
2. **Scan `data/state.json`** — read it and understand what projects, milestones, tasks, and journal entries currently exist. Note active project count, milestone statuses, and any recent journal entries.
3. **Scan `data/goals/`** — check what goals are loaded, what year, and current mappings.
4. **Scan `data/reports/`** and `data/archive/`** — know what reports and closed projects exist.
5. **Read `server.js` route list** — understand what API endpoints exist before adding or modifying any.
6. **Read `public/index.html`** tab structure — understand what UI tabs and features exist.
7. **Summarize what you found** to Richard before proceeding with any changes.

### After ANY change:
1. **Test the server starts** — run `node server.js` and confirm no errors.
2. **Verify data integrity** — confirm `state.json` is valid JSON and no data was lost.
3. **Update this CLAUDE.md** to reflect what changed:
   - If you added an API endpoint, add it to the API Endpoints table.
   - If you changed the data model, update the Data Contracts section.
   - If you added a feature, add it to the feature descriptions.
   - If you changed the UI tabs, update the Architecture section.
   - Add a dated entry to the Change Log at the bottom of this file.
4. **Confirm the update** to Richard with a summary of what changed.

### Why this matters:
This tool is Richard's central PM hub. It contains real project data, real deadlines, and real goal connections that feed into his performance reviews. A botched update that corrupts `state.json` or breaks a feature costs real work. The scan-before-change protocol ensures you have context. The CLAUDE.md-update-after-change protocol ensures the next Claude Code session has context too.

## Running

```bash
npm install   # first time only
npm start     # http://localhost:3200, auto-opens browser
```

## Architecture

```
richards-projects/
├── CLAUDE.md              # You're reading this
├── README.md              # Human documentation
├── server.js              # Express server (port 3200), REST API, docx generation
├── package.json           # Dependencies: express, docx
├── public/
│   └── index.html         # Single-page vanilla JS UI (no framework, no build step)
├── data/
│   ├── state.json         # ★ PRIMARY DATA FILE — projects, journal, tasks
│   ├── .history/          # Undo snapshots (auto-managed, last 30)
│   ├── goals/
│   │   ├── {year}_goals.json      # Annual goals from Workday
│   │   └── goal_project_map.json  # Goal ↔ project mappings
│   ├── archive/                   # Closed project snapshots + markdown reports
│   ├── reports/                   # Generated .md and .docx reports
│   └── drafts/                    # Report draft storage
└── scripts/
    └── import-goals.js            # CLI goal importer
```

## How to Make Changes

### CRITICAL: Data Changes vs Code Changes

- **Data changes** (add project, update milestone, add task): Edit `data/state.json` directly OR use the REST API while server is running. Either works.
- **Code changes** (new features, bug fixes, UI changes): Edit `server.js` and/or `public/index.html` directly. Restart server after server.js changes. HTML changes take effect on page refresh.
- **NEVER** overwrite `data/state.json` with a template — Richard has live data in there.

### Preferred approach: Direct file edits

Since Richard runs this locally, the fastest path for Claude Code is to edit files directly:

```bash
# Read current state
cat data/state.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['projects'][0]['name']))"

# Add a project (Python one-liner)
python3 -c "
import json
with open('data/state.json') as f: s = json.load(f)
s['projects'].append({
    'id': 'new-id',
    'name': 'Project Name',
    'shortName': 'PRJ',
    'color': '#0A6E5C',
    'owner': 'Richard',
    'sponsor': 'Felicia Nguyen',
    'targetDate': '2026-12-31',
    'archived': False,
    'description': 'Description here',
    'dependencies': [],
    'risks': [],
    'milestones': [],
    'syncItems': [],
    'goalRefs': [],
    'links': []
})
with open('data/state.json','w') as f: json.dump(s, f, indent=2)
"
```

### Alternative: REST API (when server is running)

```bash
# Read state
curl http://localhost:3200/api/state

# Add a project
curl -X POST http://localhost:3200/api/project \
  -H "Content-Type: application/json" \
  -d '{"name":"New Project","shortName":"NEW","color":"#0A6E5C","owner":"Richard","sponsor":"Felicia Nguyen","targetDate":"2026-12-31","description":"..."}'

# Update a project
curl -X PATCH http://localhost:3200/api/project/PROJECT_ID \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated description"}'

# Add a task
curl -X POST http://localhost:3200/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"text":"Task description","tags":["tag1"],"project":"project-id-or-null","owner":"","bullets":[],"links":[]}'

# Update a task
curl -X PATCH http://localhost:3200/api/tasks/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"done","notes":"Completed this"}'

# Undo last change
curl -X POST http://localhost:3200/api/undo

# Generate a report
curl -X POST http://localhost:3200/api/reports/export-docx \
  -H "Content-Type: application/json" \
  -d '{"type":"checkin","detail":"checkin"}'
```

## Data Contracts

### state.json — The Primary Data File

```json
{
  "lastUpdated": "ISO timestamp",
  "projects": [ /* see Project schema below */ ],
  "journal": [ /* see Journal Entry schema below */ ],
  "tasks": [ /* see Task schema below */ ]
}
```

### Project Schema

```json
{
  "id": "unique-string",
  "name": "Full project name",
  "shortName": "3-4 CHAR CODE",
  "color": "#hex",
  "owner": "Richard",
  "sponsor": "Felicia Nguyen",
  "targetDate": "YYYY-MM-DD",
  "archived": false,
  "description": "Project description",
  "dependencies": ["string array"],
  "risks": [{"text": "Risk description", "severity": "high|medium|low"}],
  "milestones": [ /* see Milestone schema */ ],
  "syncItems": ["Loop page: ...", "Planner: ..."],
  "goalRefs": ["goal-id-1"],
  "links": [{"label": "Display text", "url": "https://..."}]
}
```

### Milestone Schema

```json
{
  "id": "unique-string",
  "name": "Milestone name",
  "target": "YYYY-MM-DD",
  "status": "complete|in-progress|at-risk|blocked|not-started",
  "notes": "Quick summary",
  "owner": "Person responsible",
  "bullets": ["Structured note 1", "Structured note 2"],
  "links": [{"label": "Loop conversation", "url": "https://..."}]
}
```

### Task Schema

```json
{
  "id": "unique-string",
  "text": "Task description",
  "status": "open|done",
  "created": "YYYY-MM-DD",
  "completed": "YYYY-MM-DD or null",
  "notes": "Quick summary",
  "tags": ["tag1", "tag2"],
  "project": "project-id or null",
  "owner": "Person responsible",
  "bullets": ["Detailed note 1", "Detailed note 2"],
  "links": [{"label": "Reference", "url": "https://..."}]
}
```

### Journal Entry Schema

```json
{
  "id": "unique-string",
  "date": "YYYY-MM-DD",
  "text": "Entry text",
  "project": "project-id or 'all'",
  "type": "decision|lesson|risk|action|note|meeting"
}
```

### Goals Schema (data/goals/{year}_goals.json)

```json
{
  "year": 2026,
  "importedAt": "ISO timestamp",
  "sourceFile": "filename",
  "orgAlignments": [
    {"id": "oa1", "name": "Make TEAM Lilly Better"},
    {"id": "oa2", "name": "Help People"},
    {"id": "oa3", "name": "Deliver Results"}
  ],
  "goals": [{
    "id": "unique-string",
    "category": "Goal category from Workday",
    "orgAlignment": "oa1|oa2|oa3",
    "text": "Goal description",
    "cascaded": true|false,
    "subItems": ["sub-goal 1", "sub-goal 2"],
    "status": "on-track|needs-attention|complete|discontinued",
    "q1Notes": "", "q2Notes": "", "q3Notes": "", "q4Notes": "",
    "linkedProjects": ["project-id-1", "project-id-2"]
  }]
}
```

## Common Operations for Claude Code

### Adding a project from a document

When Richard provides a document (memo, email, meeting notes, etc.) and asks to create a project:

1. Parse the document for: project name, description, key deliverables, stakeholders, target dates, dependencies, risks
2. Generate a project object with milestones derived from the deliverables
3. Set sensible defaults: owner="Richard", sponsor="Felicia Nguyen", color from available palette
4. Add to `data/state.json`
5. Add a journal entry noting the project creation
6. If the document references existing projects, note cross-dependencies

### Adding tasks from communications

When Richard forwards emails, Teams messages, or meeting notes:

1. Extract actionable items
2. Determine if each is a task (ad-hoc) or should be a milestone on an existing project
3. For tasks: create with appropriate tags, project linkage, and any noted deadlines
4. For milestones: add to the relevant project with owner and target date
5. Add journal entry summarizing what was captured

### Importing goals

Goals come from Workday and may be in .docx, screenshot text, or pasted text. They are NOT consistently structured.

1. Parse goal categories, individual goals, sub-items, and org alignment
2. Check `data/goals/` for existing year file
3. If exists: MERGE — update text, preserve status and quarterly notes, flag removed goals as "discontinued"
4. If new: create fresh file
5. Map goals to existing projects via `linkedProjects` field
6. NEVER delete existing goal data or quarterly notes

### Generating reports

```bash
# Via API (server must be running)
curl -X POST http://localhost:3200/api/reports/export-docx \
  -H "Content-Type: application/json" \
  -d '{
    "type": "checkin",
    "detail": "checkin",
    "dateFrom": "2026-01-01",
    "dateTo": "2026-06-30",
    "includeTables": false,
    "includeTasks": true,
    "title": "Q2 2026 Check-in",
    "notes": "Additional context"
  }'
```

Detail levels: `summary` (1 page), `checkin` (goal-connected), `full` (everything with tables), `comprehensive` (all data including bullets, links, journal)

### Updating milestones in bulk

```python
import json
with open('data/state.json') as f: s = json.load(f)
proj = next(p for p in s['projects'] if p['shortName'] == 'PMP')
for m in proj['milestones']:
    if m['name'] == 'Some milestone':
        m['status'] = 'complete'
        m['notes'] = 'Completed on schedule'
with open('data/state.json', 'w') as f: json.dump(s, f, indent=2)
```

### Making UI changes

The UI is vanilla JS in `public/index.html`. Key patterns:
- State is in global `state` variable, loaded from API on init
- `render()` rebuilds the entire DOM (no virtual DOM)
- `save()` PUTs state to API with undo history
- `ds()` is debounced save (600ms) for inline edits
- Tab content is rendered by functions: `rDashboard()`, `rProjects()`, `rTasks()`, `rTimeline()`, `rBoard()`, `rJournal()`, `rReports()`, `rSync()`, `rArchive()`
- Milestones and tasks are expandable (click to toggle, `expMs` and `expTk` track open state)

### Making server changes

Express server in `server.js`. Key patterns:
- All data reads: `readJSON(filepath, fallback)`
- All data writes: through `saveState(state)` which pushes undo history first
- `pushHistory(clearRedo=true)` manages undo snapshots in `data/.history/`
- Docx generation uses the `docx` npm package with LP1 brand colors

## LP1 Brand Spec

```
Primary Red:    #E1251B     Dark Text:   #212121 / #333333
Blue:           #0F3A85     Gray Text:   #888888
Green:          #144B2D     Light Gray:  #C0C0C0
Gold:           #FFC709     Background:  #FDE8E5 (blush)
Purple:         #7B2D8E     Sage:        #C6DCD8
Coral:          #F58E7D     Ice:         #E4EBF1
Maroon:         #511207     Peach:       #FDD1B0

Heading font:  Times New Roman, Georgia, serif
Body font:     Arial, Helvetica Neue, sans-serif
Footer:        "Company Confidential © {year} Eli Lilly and Company"
```

## Available project color palette

```
#E1251B  #0F3A85  #144B2D  #7B2D8E  #F58E7D  #511207  #0A6E5C  #C4571A
```

Pick the first unused color when creating a new project.

## Richard's Context

- Process Engineer at LP1 (Lebanon API Manufacturing), TSMS department
- Manager: Felicia Nguyen, Skip-level: David Goeddel
- Key collaborators: Kelly Hoerst, Tanisha Gosain, Tymie Duckett, Carolina Serrano, Jeremiah Bechtold
- Based at LP1 in Lebanon, Indiana (was on short-term assignment at Kinsale, but does not support Kinsale)
- Active projects span process monitoring (TZP synthesis), APR strategy, MTS/MTM verification, BOM strategy, and digital systems
- Uses Loop pages, Planner, Figma, SharePoint, and Teams for collaboration
- Annual goals come from Workday, organized under Lilly org alignments
- Check-ins map project progress back to Workday goals

## Change Log

*Claude Code: add a dated entry here after every change you make.*

| Date | Change | Files Modified |
|------|--------|----------------|
| 2026-04-22 | Initial project creation with 4 projects (PMP, APR, MTM, BOM) | All files |
| 2026-04-22 | Added Dashboard, Timeline, Kanban Board, Global Search tabs | public/index.html |
| 2026-04-22 | Added undo/redo system with 30-snapshot history | server.js |
| 2026-04-22 | Added Tasks tab for ad-hoc work tracking | server.js, public/index.html |
| 2026-04-22 | Added DSKM (Digital Systems Knowledge Management) project | data/state.json |
| 2026-04-22 | Loaded 2026 Workday goals with org alignment hierarchy | data/goals/2026_goals.json |
| 2026-04-22 | Redesigned docx export — refined styling, goals-connected structure | server.js |
| 2026-04-22 | Added report detail levels: Executive Summary, Check-in, Full Detail, Comprehensive | server.js, public/index.html |
| 2026-04-22 | Added date range filtering to reports | server.js, public/index.html |
| 2026-04-22 | Expandable milestones with owner, bullet notes, and links | public/index.html |
| 2026-04-22 | Project-level links bar (Loop, SharePoint, Figma, etc.) | public/index.html |
| 2026-04-22 | Expandable tasks with owner, bullet notes, and links (matching milestone features) | public/index.html |
| 2026-04-23 | Added mandatory scan/update protocol to CLAUDE.md | CLAUDE.md |
