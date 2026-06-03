# CLAUDE.md — Richard's Projects

## What This Is

This is Richard's central project management hub for Manufacturing Sciences work. It tracks projects, milestones, risks, dependencies, goals, and progress reports. All data is file-based JSON stored in `data/` and syncs via OneDrive.

**Location:** `C:\Users\L075876\OneDrive - [REDACTED]\Documents\richards-projects\`

**CONFIDENTIAL — NOT FOR GITHUB.** This tool contains personal goal notes, project strategy details, and check-in content. It lives exclusively on OneDrive. Do not suggest committing this to any repository or moving it to `C:\Dev`.

## Architecture

```
richards-projects/
├── server.js              # Express server (port 3200)
├── public/index.html      # Single-page UI
├── data/
│   ├── state.json         # Active projects, journal, sync items
│   ├── goals/
│   │   ├── {year}_goals.json          # Imported goals by year
│   │   └── goal_project_map.json      # Maps goal IDs → project IDs
│   ├── archive/
│   │   └── {id}_{shortname}_{date}.json  # Closed project summaries
│   └── reports/
│       └── {date}_{type}.md           # Generated progress reports
└── scripts/
    └── import-goals.js    # CLI: node scripts/import-goals.js <file>
```

## Running

```bash
npm install
npm start          # http://localhost:3200
```

## API Endpoints

All data operations go through the REST API so the filesystem stays consistent:

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/state | Full project state |
| PUT | /api/state | Save full state |
| PATCH | /api/project/:id | Update single project |
| POST | /api/project | Add new project |
| DELETE | /api/project/:id | Remove project |
| POST | /api/project/:id/close | Close project → generates summary in archive/ |
| GET | /api/goals | All loaded goals |
| POST | /api/goals/import | Import goals from structured text/JSON |
| GET | /api/goals/map | Goal → project mapping |
| PUT | /api/goals/map | Update mapping |
| POST | /api/reports/generate | Generate progress report |
| GET | /api/reports | List all reports |
| GET | /api/reports/:filename | Read specific report |

## Data Contracts

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
      "milestones": [
        {
          "id": "string",
          "name": "string",
          "target": "YYYY-MM-DD",
          "status": "complete|in-progress|at-risk|blocked|not-started",
          "notes": "string",
          "goalRef": "optional goal ID this milestone maps to"
        }
      ],
      "syncItems": ["string"],
      "goalRefs": ["goal IDs this project supports"]
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
  ]
}
```

### {year}_goals.json
```json
{
  "year": 2026,
  "importedAt": "ISO timestamp",
  "sourceFile": "filename if applicable",
  "goals": [
    {
      "id": "string",
      "category": "e.g. Deliver Results – Safety, Schedule, Development",
      "text": "full goal text",
      "subItems": ["bullet items under the goal"],
      "status": "on-track|needs-attention|complete",
      "q1Notes": "string",
      "q2Notes": "string",
      "q3Notes": "string",
      "q4Notes": "string"
    }
  ]
}
```

### goal_project_map.json
```json
{
  "lastUpdated": "ISO timestamp",
  "mappings": [
    {
      "goalId": "string",
      "projectIds": ["string"],
      "notes": "how this goal connects to these projects"
    }
  ]
}
```

### Archive files: {id}_{shortname}_{date}.json
Generated automatically when a project is closed. Contains:
- Full project snapshot at close time
- Summary statistics (duration, milestones completed, etc.)
- Lessons learned (pulled from journal entries tagged to this project)
- Final status of all milestones

### Report files: {date}_{type}.md
Markdown progress reports. Types: `checkin`, `quarterly`, `annual`.

## Key Behaviors for Claude Code

### When asked to update project status
1. Read `data/state.json`
2. Find the project and milestone
3. Update status, add journal entry if significant
4. Write back to `data/state.json` via API or direct file write

### When asked to import goals
1. Parse the input (goals docs are not structured identically every time — use judgment)
2. Extract goal categories, individual goals, and sub-items
3. Check `data/goals/` for existing year file — if it exists, MERGE don't overwrite:
   - New goals get added
   - Existing goals get their text updated but preserve status and quarterly notes
   - Goals that no longer appear get flagged as "removed" but NOT deleted
   - Goal-to-project mappings in `goal_project_map.json` are preserved
4. Write to `data/goals/{year}_goals.json`
5. Prompt Richard to review mappings if new goals don't clearly map to existing projects

### When asked to generate a progress report
1. Read `data/state.json` for current project status
2. Read `data/goals/{year}_goals.json` for goals
3. Read `data/goals/goal_project_map.json` for mappings
4. Generate a markdown report that connects projects → goals → status
5. Save to `data/reports/{date}_{type}.md`
6. Report format should match corporate check-in structure (goal category → goal → progress notes → linked project status)

### When asked to close a project
1. Generate archive summary with full project snapshot
2. Pull all journal entries tagged to this project
3. Calculate statistics (start date from first milestone, duration, completion rate)
4. Save to `data/archive/{id}_{shortname}_{date}.json`
5. Remove from active projects in `state.json`
6. Preserve goal mappings for historical reference (mark as closed in map)

### Non-destructive goal updates (CRITICAL)
When Richard loads new goals or updates existing ones mid-year:
- NEVER delete active projects or milestones
- NEVER overwrite quarterly notes that already have content
- If a goal is removed from the new goals doc, flag it as "discontinued" — don't delete
- If a goal is reworded, update the text but preserve the ID and all linked data
- If goals map to projects that are in-progress, preserve the project and note the goal change in the journal
- Always show Richard what changed before committing

## Brand (for any generated UI or reports)
- Primary red: #E1251B
- Blue: #0F3A85
- Green: #144B2D
- Gold: #FFC709
- Background blush: #FDE8E5
- Dark text: #212121
- Heading font: Times New Roman, Georgia, serif
- Body font: Arial, Helvetica Neue, sans-serif
- Footer: "Company Confidential © 2026 [REDACTED]"

## Common Commands

```bash
npm start                                    # Start server
node scripts/import-goals.js goals.docx      # Import goals from file
curl http://localhost:3200/api/state          # Read current state
curl http://localhost:3200/api/reports        # List reports
```
