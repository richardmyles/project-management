# My Projects

A self-contained desktop app for tracking projects, milestones, goals, risks, and progress reports. Data is stored locally as JSON files — no cloud account, no database, no setup beyond a one-time personalisation step.

Built with Electron + Node.js. Available as a Windows installer or portable `.exe`.

---

## Download

Go to the [Releases](../../releases/latest) page and download one of:

| File | When to use |
|------|-------------|
| `My Projects Setup 1.0.5.exe` | Standard installer — adds to Start Menu and desktop |
| `MyProjects-portable.exe` | No install needed — run from anywhere, including a USB drive |

---

## Installation

### Installer (recommended)

1. Download `My Projects Setup 1.0.5.exe`
2. Run it and follow the prompts
3. Launch **My Projects** from the Start Menu or desktop shortcut

### Portable

1. Download `MyProjects-portable.exe`
2. Move it wherever you like
3. Double-click to run — no installation required

> **Note:** Windows may show a SmartScreen warning ("Windows protected your PC") because the app isn't signed with a paid certificate. Click **More info → Run anyway** to proceed.

---

## First Run

On first launch a setup screen appears. Fill in:

- **Your name** — used in report headers
- **Team** — appears in exported Word documents
- **Organisation** — appears in exported Word documents
- **Accent colour** — sets the app's header and highlight colour

Click **Get Started**. Your settings are saved locally in `config.json` and the app opens to the main dashboard.

---

## Auto-Updates

The app checks for updates automatically a few seconds after launch. When a new version is available it downloads in the background. Once ready, a prompt asks whether to **Restart Now** or **Later**. Updates are pulled from this repository's GitHub Releases.

---

## AI Features (optional)

Some features use the Claude API for AI-assisted summaries and suggestions. This is optional — the app works fully without it.

To enable AI features, create a `.env` file next to the app's data folder with one of the following options:

**Option A — Anthropic API key:**
```
ANTHROPIC_API_KEY=your-key-here
```

**Option B — Corporate API gateway:**
```
AI_API_KEY=your-key-here
AI_BASE_URL=https://your-gateway.example.com
AI_MODEL=claude-sonnet-4-5
```

**Option C — CLI token command (SSO):**
```
AI_TOKEN_CMD=your-cli-tool token
```

See `.env.example` in the repository for a full template. `.env` is gitignored — never commit it, since it holds your API key or gateway credentials.

**Troubleshooting:** if AI responses come back empty, check your gateway's response shape. The app reads the first `text`-type content block rather than assuming it's always at index 0, since some gateways prepend a non-standard block (e.g. an extended-thinking preamble) before the actual answer.

---

## Features

**Dashboard** — live summary of all active projects, overdue milestones, open tasks, and a daily AI-generated briefing

**Projects** — create and manage projects with milestones, risks, dependencies, links, and goal references. Each milestone has a status (complete / in-progress / at-risk / blocked / not-started), owner, notes, and sub-bullets.

**Tasks** — standalone task list with tags, project links, owners, and completion tracking

**Notes** — freeform notes, separate from the project journal

**Profile** — your personal profile, generated and refreshed with AI assistance

**Goals** — import annual goals from a Word document (`.docx`). Goals are grouped by category with quarterly notes fields (Q1–Q4), status badges, and structured sub-items. Importing is non-destructive: existing notes and statuses are preserved; removed goals are marked discontinued rather than deleted.

**Timeline** — Gantt-style view of milestones across all projects

**Board** — Kanban view of milestones by status

**Journal** — decision log, lessons learned, risk notes, meeting notes, and actions — tagged by project and type

**Reports** — generate progress reports at four detail levels (summary / check-in / full / comprehensive) and export as Word (`.docx`) or markdown, with optional AI-assisted generation

**1:1s** — track one-on-one meeting notes

**Archive** — closed project snapshots with auto-generated closure reports

**Undo / Redo** — every save is snapshotted; up to 30 steps back

---

## Running from Source

Requires [Node.js](https://nodejs.org/) 24 or later.

```bash
git clone https://github.com/richardmyles/project-management.git
cd project-management
npm install
npm start          # opens in browser at http://localhost:3201
```

To run as a desktop app:
```bash
npm run electron
```

To build a Windows installer locally:
```bash
npm run dist
```

---

## Data Storage

All data is stored locally in the app's working directory:

```
data/
├── state.json          # Projects, tasks, journal
├── goals/               # Annual goal files
├── reports/             # Generated reports (.md and .docx)
├── archive/             # Closed project snapshots
├── notes.json           # Standalone notes
├── profile.json         # AI-generated profile
├── briefing/            # Daily AI briefing data
└── .history/            # Undo/redo snapshots
config.json              # Your name, team, org, accent colour
```

No data is sent anywhere unless you explicitly use the AI features, which call the configured API endpoint.

---

## License

MIT
