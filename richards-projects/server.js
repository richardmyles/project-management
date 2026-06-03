const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3200;

const DATA = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA, "state.json");
const GOALS_DIR = path.join(DATA, "goals");
const ARCHIVE_DIR = path.join(DATA, "archive");
const REPORTS_DIR = path.join(DATA, "reports");
const HISTORY_DIR = path.join(DATA, ".history");
const DRAFTS_DIR = path.join(DATA, "drafts");
const GOAL_MAP_FILE = path.join(GOALS_DIR, "goal_project_map.json");

[DATA, GOALS_DIR, ARCHIVE_DIR, REPORTS_DIR, HISTORY_DIR, DRAFTS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readJSON(fp, fallback) {
  try { if (!fs.existsSync(fp)) return fallback; return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8"); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function today() { return new Date().toISOString().split("T")[0]; }

// ═══ UNDO/REDO ═══
const MAX_HISTORY = 30;
let redoStack = [];

function pushHistory(clearRedo = true) {
  if (!fs.existsSync(STATE_FILE)) return;
  const current = fs.readFileSync(STATE_FILE, "utf8");
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  const next = files.length ? parseInt(files[files.length - 1]) + 1 : 1;
  fs.writeFileSync(path.join(HISTORY_DIR, String(next).padStart(6, "0") + ".json"), current, "utf8");
  const all = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  while (all.length > MAX_HISTORY) fs.unlinkSync(path.join(HISTORY_DIR, all.shift()));
  if (clearRedo) redoStack = [];
}

function saveState(state) {
  pushHistory();
  state.lastUpdated = new Date().toISOString();
  writeJSON(STATE_FILE, state);
}

app.post("/api/undo", (req, res) => {
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  if (!files.length) return res.json({ ok: false, message: "Nothing to undo" });
  if (fs.existsSync(STATE_FILE)) redoStack.push(fs.readFileSync(STATE_FILE, "utf8"));
  const latest = files[files.length - 1];
  fs.writeFileSync(STATE_FILE, fs.readFileSync(path.join(HISTORY_DIR, latest), "utf8"));
  fs.unlinkSync(path.join(HISTORY_DIR, latest));
  res.json({ ok: true, remaining: files.length - 1 });
});

app.post("/api/redo", (req, res) => {
  if (!redoStack.length) return res.json({ ok: false, message: "Nothing to redo" });
  pushHistory(false);  // save current to history but DON'T clear redo stack
  fs.writeFileSync(STATE_FILE, redoStack.pop());
  res.json({ ok: true, remaining: redoStack.length });
});

app.get("/api/history/count", (req, res) => {
  res.json({ undo: fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).length, redo: redoStack.length });
});

// ═══ STATE ═══
app.get("/api/state", (req, res) => { res.json(readJSON(STATE_FILE, { projects: [], journal: [] })); });
app.put("/api/state", (req, res) => { saveState(req.body); res.json({ ok: true }); });

app.post("/api/project", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [] });
  const p = { id: uid(), ...req.body, archived: false };
  ["milestones","dependencies","risks","syncItems","goalRefs"].forEach(k => { if (!p[k]) p[k] = []; });
  state.projects.push(p); saveState(state); res.json({ ok: true, project: p });
});

app.patch("/api/project/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [] });
  const idx = state.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  state.projects[idx] = { ...state.projects[idx], ...req.body };
  saveState(state); res.json({ ok: true });
});

app.delete("/api/project/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [] });
  state.projects = state.projects.filter(p => p.id !== req.params.id);
  saveState(state); res.json({ ok: true });
});

// ═══ CLOSE PROJECT ═══
app.post("/api/project/:id/close", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [] });
  const idx = state.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const project = state.projects[idx], closeDate = today();
  const totalMs = project.milestones.length, completeMs = project.milestones.filter(m => m.status === "complete").length;
  const relJ = state.journal.filter(j => j.project === project.id || j.project === "all");
  const summary = { closedAt: new Date().toISOString(), closeDate, project: { ...project },
    statistics: { totalMilestones: totalMs, completedMilestones: completeMs, completionRate: totalMs ? Math.round((completeMs / totalMs) * 100) : 0, projectTarget: project.targetDate, actualCloseDate: closeDate },
    lessonsLearned: relJ.filter(j => j.type === "lesson").map(j => ({ date: j.date, text: j.text })),
    decisions: relJ.filter(j => j.type === "decision").map(j => ({ date: j.date, text: j.text })),
    closureNotes: req.body.notes || "" };
  let md = "# Closure Report: " + project.shortName + " — " + project.name + "\n\n";
  md += "**Closed:** " + closeDate + " | **Completion:** " + completeMs + "/" + totalMs + " (" + summary.statistics.completionRate + "%)\n\n";
  md += "## Milestones\n\n| Milestone | Target | Status | Notes |\n|---|---|---|---|\n";
  project.milestones.forEach(m => { md += "| " + m.name + " | " + (m.target||"—") + " | " + m.status + " | " + (m.notes||"") + " |\n"; });
  if (summary.lessonsLearned.length) { md += "\n## Lessons Learned\n\n"; summary.lessonsLearned.forEach(l => { md += "- " + l.date + ": " + l.text + "\n"; }); }
  if (summary.closureNotes) md += "\n## Notes\n\n" + summary.closureNotes + "\n";
  const slug = project.id + "_" + project.shortName + "_" + closeDate;
  writeJSON(path.join(ARCHIVE_DIR, slug + ".json"), summary);
  fs.writeFileSync(path.join(ARCHIVE_DIR, slug + ".md"), md, "utf8");
  state.projects.splice(idx, 1);
  state.journal.unshift({ id: uid(), date: closeDate, text: "Project " + project.shortName + " closed. " + completeMs + "/" + totalMs + " milestones.", project: "all", type: "decision" });
  saveState(state); res.json({ ok: true, archiveFile: slug + ".json", summary });
});

// ═══ GOALS ═══
app.get("/api/goals", (req, res) => {
  const files = fs.readdirSync(GOALS_DIR).filter(f => f.match(/^\d{4}_goals\.json$/));
  const all = {}; files.forEach(f => { const yr = f.split("_")[0]; all[yr] = readJSON(path.join(GOALS_DIR, f), { year: parseInt(yr), goals: [] }); });
  res.json(all);
});
app.post("/api/goals/import", (req, res) => {
  const { year, goals, sourceFile } = req.body;
  if (!year || !goals) return res.status(400).json({ error: "year and goals required" });
  const file = path.join(GOALS_DIR, year + "_goals.json");
  const existing = readJSON(file, null);
  if (existing) {
    const map = new Map(existing.goals.map(g => [g.id, g]));
    const ids = new Set();
    goals.forEach(g => { ids.add(g.id); const ex = map.get(g.id); if (ex) { ex.text = g.text; ex.category = g.category; } else { map.set(g.id, { ...g, status: "on-track" }); } });
    map.forEach((g, id) => { if (!ids.has(id) && g.status !== "discontinued") g.status = "discontinued"; });
    existing.goals = Array.from(map.values()); existing.importedAt = new Date().toISOString();
    writeJSON(file, existing); res.json({ ok: true, merged: true, goalCount: existing.goals.length });
  } else {
    const data = { year, importedAt: new Date().toISOString(), sourceFile, goals: goals.map(g => ({ ...g, status: "on-track", q1Notes: "", q2Notes: "", q3Notes: "", q4Notes: "" })) };
    writeJSON(file, data); res.json({ ok: true, merged: false, goalCount: data.goals.length });
  }
});
app.get("/api/goals/map", (req, res) => { res.json(readJSON(GOAL_MAP_FILE, { lastUpdated: null, mappings: [] })); });
app.put("/api/goals/map", (req, res) => { writeJSON(GOAL_MAP_FILE, { ...req.body, lastUpdated: new Date().toISOString() }); res.json({ ok: true }); });

// ═══ REPORTS ═══
app.get("/api/reports", (req, res) => {
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith(".md") || f.endsWith(".docx")).sort().reverse();
  res.json(files.map(f => ({ filename: f, date: f.split("_")[0], type: f.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/\.(md|docx)$/, ""), format: f.endsWith(".docx") ? "docx" : "md" })));
});
app.get("/api/reports/:filename", (req, res) => {
  const file = path.join(REPORTS_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  if (req.params.filename.endsWith(".docx")) res.download(file);
  else res.type("text/markdown").send(fs.readFileSync(file, "utf8"));
});

app.post("/api/reports/generate", (req, res) => {
  const { type = "checkin", quarter, notes, projectIds } = req.body;
  const state = readJSON(STATE_FILE, { projects: [], journal: [] });
  const selected = projectIds && projectIds.length ? state.projects.filter(p => projectIds.includes(p.id)) : state.projects.filter(p => !p.archived);
  let md = "# " + (type === "quarterly" ? "Q" + (quarter||"?") : type) + " Progress Report — " + today() + "\n\n";
  selected.forEach(p => {
    const comp = p.milestones.filter(m => m.status === "complete").length;
    md += "## " + p.shortName + ": " + p.name + "\n\n**" + getHealth(p) + "** | " + comp + "/" + p.milestones.length + " milestones | Target: " + (p.targetDate || "TBD") + "\n\n";
    p.milestones.filter(m => m.status !== "not-started").forEach(m => { md += "- _" + m.status + "_: " + m.name + (m.notes ? " — " + m.notes : "") + "\n"; });
    md += "\n";
  });
  if (notes) md += "## Notes\n\n" + notes + "\n";
  const filename = today() + "_" + type + ".md";
  fs.writeFileSync(path.join(REPORTS_DIR, filename), md, "utf8");
  res.json({ ok: true, filename, content: md });
});

// ═══ DOCX EXPORT ═══
app.post("/api/reports/export-docx", async (req, res) => {
  try {
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            WidthType, BorderStyle, Header, Footer, PageNumber, ShadingType,
            TableLayoutType, TabStopPosition, TabStopType, Tab } = docx;
    let { type = "checkin", quarter, notes, projectIds, title,
            detail = "checkin", includeTables = false, includeTasks = false,
            dateFrom = null, dateTo = null } = req.body;
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    const yr = new Date().getFullYear();
    const goalsData = readJSON(path.join(GOALS_DIR, yr + "_goals.json"), null);
    const selected = projectIds && projectIds.length
      ? state.projects.filter(p => projectIds.includes(p.id))
      : state.projects.filter(p => !p.archived);

    // Comprehensive = everything, force all includes
    if (detail === "comprehensive") { includeTables = true; includeTasks = true; }

    // Date filter helper
    const inRange = (dateStr) => {
      if (!dateStr) return true; // no date = always include
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    };
    const rangeLabel = dateFrom || dateTo
      ? (dateFrom || "start") + " → " + (dateTo || "present")
      : "all time";

    const DARK = "333333", GRAY = "888888", LGRAY = "C0C0C0", RED = "E1251B", BLUE = "0F3A85", GREEN = "144B2D";
    const SC = { "complete": GREEN, "in-progress": BLUE, "at-risk": "B8860B", "blocked": RED, "not-started": "999999" };
    const SL = { "complete": "✓", "in-progress": "▸", "at-risk": "△", "blocked": "✕", "not-started": "○" };
    const noBorder = { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } };
    const thinBottom = { ...noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" } };

    const c = []; // children

    // ── Title block (understated) ──
    c.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: title || (type === "quarterly" ? "Q" + (quarter||"") + " " + yr + " Progress Report" : "Progress Report"), font: "Times New Roman", size: 28, color: RED }),
    ]}));
    c.push(new Paragraph({ spacing: { after: 20 }, children: [
      new TextRun({ text: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (dateFrom || dateTo ? "  ·  Scope: " + rangeLabel : ""), font: "Arial", size: 18, color: GRAY }),
    ]}));
    c.push(new Paragraph({ spacing: { after: 20 }, children: [
      new TextRun({ text: "Richard  ·  LP1 Technical Services Manufacturing Sciences", font: "Arial", size: 18, color: GRAY }),
    ]}));
    // Thin accent line
    c.push(new Paragraph({ border: { bottom: { color: RED, space: 4, style: BorderStyle.SINGLE, size: 2 } }, spacing: { after: 240 } }));

    // ── Summary snapshot ──
    const totalMs = selected.reduce((s,p) => s + p.milestones.length, 0);
    const compMs = selected.reduce((s,p) => s + p.milestones.filter(m => m.status === "complete").length, 0);
    const pctComplete = totalMs ? Math.round((compMs/totalMs)*100) : 0;

    c.push(new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: "Overview", font: "Times New Roman", size: 22, color: BLUE }),
    ]}));
    c.push(new Paragraph({ spacing: { after: 20 }, children: [
      new TextRun({ text: selected.length + " active projects  ·  " + compMs + " of " + totalMs + " milestones complete (" + pctComplete + "%)  ·  " + (state.tasks||[]).filter(t=>t.status==="done").length + " ad-hoc tasks completed", font: "Arial", size: 18, color: DARK }),
    ]}));

    // Quick project health line
    selected.forEach(p => {
      const h = getHealth(p), comp = p.milestones.filter(m=>m.status==="complete").length;
      c.push(new Paragraph({ spacing: { after: 8 }, indent: { left: 200 }, children: [
        new TextRun({ text: SL[h === "ON TRACK" ? "complete" : h === "AT RISK" ? "at-risk" : h === "CRITICAL" ? "blocked" : "complete"] + "  ", font: "Arial", size: 18, color: SC[h === "ON TRACK" ? "complete" : h === "AT RISK" ? "at-risk" : h === "CRITICAL" ? "blocked" : "complete"] }),
        new TextRun({ text: p.shortName, font: "Arial", size: 18, bold: true, color: DARK }),
        new TextRun({ text: "  " + p.name + "  —  " + comp + "/" + p.milestones.length, font: "Arial", size: 18, color: GRAY }),
      ]}));
    });
    c.push(new Paragraph({ spacing: { after: 200 } }));

    // ── Goals-Connected Section (checkin + full only) ──
    if (detail !== "summary" && goalsData && goalsData.goals && goalsData.goals.length) {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { after: 160 }, children: [
        new TextRun({ text: "Progress by Goal", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));

      // Group by org alignment
      const alignments = goalsData.orgAlignments || [];
      const goalsByAlign = {};
      goalsData.goals.forEach(g => {
        const key = g.orgAlignment || "other";
        if (!goalsByAlign[key]) goalsByAlign[key] = [];
        goalsByAlign[key].push(g);
      });

      for (const oa of alignments) {
        const goalsInAlign = goalsByAlign[oa.id] || [];
        if (!goalsInAlign.length) continue;

        // Org alignment label
        c.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [
          new TextRun({ text: oa.name.toUpperCase(), font: "Arial", size: 16, bold: true, color: LGRAY, characterSpacing: 80 }),
        ]}));

        for (const goal of goalsInAlign) {
          // Goal category
          c.push(new Paragraph({ spacing: { after: 30 }, children: [
            new TextRun({ text: goal.category, font: "Times New Roman", size: 20, color: DARK }),
            goal.cascaded ? new TextRun({ text: "  (cascaded)", font: "Arial", size: 16, italics: true, color: LGRAY }) : new TextRun({ text: "" }),
          ]}));

          // Linked projects under this goal
          const linked = selected.filter(p => (goal.linkedProjects || []).includes(p.id));
          if (linked.length) {
            for (const p of linked) {
              const comp = p.milestones.filter(m => m.status === "complete").length;
              const health = getHealth(p);
              c.push(new Paragraph({ spacing: { after: 12 }, indent: { left: 240 }, children: [
                new TextRun({ text: p.shortName + ": " + p.name, font: "Arial", size: 18, bold: true, color: DARK }),
                new TextRun({ text: "  ·  " + health + "  ·  " + comp + "/" + p.milestones.length, font: "Arial", size: 16, color: GRAY }),
              ]}));

              // Milestones grouped by status — no ambiguity
              const completed = p.milestones.filter(m => m.status === "complete" && inRange(m.target));
              const inProgress = p.milestones.filter(m => m.status === "in-progress" && inRange(m.target));
              const atRisk = p.milestones.filter(m => (m.status === "at-risk" || m.status === "blocked") && inRange(m.target));
              const nextUp = p.milestones.filter(m => m.status === "not-started" && inRange(m.target)).slice(0, detail === "comprehensive" ? 99 : 2);

              if (completed.length) {
                c.push(new Paragraph({ spacing: { before: 40, after: 4 }, indent: { left: 480 }, children: [
                  new TextRun({ text: "Completed", font: "Arial", size: 14, bold: true, color: GREEN, characterSpacing: 40 }),
                ]}));
                completed.slice(detail === "comprehensive" ? 0 : -3).forEach(m => {
                  c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 600 }, children: [
                    new TextRun({ text: m.name, font: "Arial", size: 16, color: GRAY }),
                    m.notes ? new TextRun({ text: "  — " + m.notes, font: "Arial", size: 14, italics: true, color: LGRAY }) : new TextRun({ text: "" }),
                  ]}));
                });
              }

              if (inProgress.length) {
                c.push(new Paragraph({ spacing: { before: 40, after: 4 }, indent: { left: 480 }, children: [
                  new TextRun({ text: "In Progress", font: "Arial", size: 14, bold: true, color: BLUE, characterSpacing: 40 }),
                ]}));
                inProgress.forEach(m => {
                  c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 600 }, children: [
                    new TextRun({ text: m.name, font: "Arial", size: 16, color: DARK }),
                    m.target ? new TextRun({ text: "  — target " + m.target, font: "Arial", size: 14, color: GRAY }) : new TextRun({ text: "" }),
                    m.notes ? new TextRun({ text: "  (" + m.notes + ")", font: "Arial", size: 14, italics: true, color: GRAY }) : new TextRun({ text: "" }),
                  ]}));
                });
              }

              if (atRisk.length) {
                c.push(new Paragraph({ spacing: { before: 40, after: 4 }, indent: { left: 480 }, children: [
                  new TextRun({ text: "Needs Attention", font: "Arial", size: 14, bold: true, color: RED, characterSpacing: 40 }),
                ]}));
                atRisk.forEach(m => {
                  c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 600 }, children: [
                    new TextRun({ text: m.name + " [" + m.status.replace(/-/g, " ") + "]", font: "Arial", size: 16, color: DARK }),
                    m.notes ? new TextRun({ text: "  — " + m.notes, font: "Arial", size: 14, italics: true, color: GRAY }) : new TextRun({ text: "" }),
                  ]}));
                });
              }

              if (nextUp.length) {
                c.push(new Paragraph({ spacing: { before: 40, after: 4 }, indent: { left: 480 }, children: [
                  new TextRun({ text: "Next Up", font: "Arial", size: 14, bold: true, color: DARK, characterSpacing: 40 }),
                ]}));
                nextUp.forEach(m => {
                  c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 600 }, children: [
                    new TextRun({ text: m.name, font: "Arial", size: 16, color: GRAY }),
                    m.target ? new TextRun({ text: "  — " + m.target, font: "Arial", size: 14, color: LGRAY }) : new TextRun({ text: "" }),
                  ]}));
                });
              }
              c.push(new Paragraph({ spacing: { after: 16 } }));
            }
          } else {
            // Goal with no linked projects — show Q notes if available
            const qKey = quarter ? "q" + quarter + "Notes" : "q1Notes";
            if (goal[qKey]) {
              c.push(new Paragraph({ spacing: { after: 16 }, indent: { left: 240 }, children: [
                new TextRun({ text: goal[qKey], font: "Arial", size: 18, color: DARK }),
              ]}));
            } else {
              c.push(new Paragraph({ spacing: { after: 16 }, indent: { left: 240 }, children: [
                new TextRun({ text: "No linked projects — progress tracked outside this tool", font: "Arial", size: 16, italics: true, color: LGRAY }),
              ]}));
            }
          }
        }
      }
      c.push(new Paragraph({ spacing: { after: 160 } }));
    }

    // ── Detailed Project Tables (only for "full" or when explicitly requested) ──
    if (detail === "full" || includeTables) {
    c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { after: 120 }, children: [
      new TextRun({ text: "Project Detail", font: "Times New Roman", size: 22, color: BLUE }),
    ]}));

    for (const p of selected) {
      const filteredMs = p.milestones.filter(m => inRange(m.target));
      if (!filteredMs.length) continue;
      c.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [
        new TextRun({ text: p.shortName + "  ", font: "Arial", size: 18, bold: true, color: BLUE }),
        new TextRun({ text: p.name, font: "Arial", size: 18, color: DARK }),
      ]}));

      const hdr = new TableRow({ children: ["Milestone", "Target", "Status", "Owner / Notes"].map(h =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, font: "Arial", size: 16, bold: true, color: BLUE })] })],
          shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
          borders: thinBottom,
          width: { size: h === "Milestone" ? 35 : h === "Owner / Notes" ? 35 : 15, type: WidthType.PERCENTAGE },
        })
      )});

      const rows = filteredMs.map((m) => new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: m.name, font: "Arial", size: 16, color: m.status === "complete" ? GRAY : DARK })] })], borders: thinBottom }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: m.target || "—", font: "Arial", size: 16, color: GRAY })] })], borders: thinBottom }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: SL[m.status] + " " + m.status.replace(/-/g," "), font: "Arial", size: 16, color: SC[m.status] || DARK })] })], borders: thinBottom }),
        new TableCell({ children: [new Paragraph({ children: [
          m.owner ? new TextRun({ text: m.owner + "  ", font: "Arial", size: 14, bold: true, color: BLUE }) : new TextRun({ text: "" }),
          new TextRun({ text: m.notes || "", font: "Arial", size: 14, italics: true, color: GRAY }),
        ]})], borders: thinBottom }),
      ]}));

      c.push(new Table({ rows: [hdr, ...rows], width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED }));

      if (detail === "comprehensive") {
        filteredMs.forEach(m => {
          const hasBullets = (m.bullets || []).length > 0;
          const hasLinks = (m.links || []).length > 0;
          if (!hasBullets && !hasLinks) return;
          c.push(new Paragraph({ spacing: { before: 40, after: 4 }, indent: { left: 200 }, children: [
            new TextRun({ text: m.name, font: "Arial", size: 14, bold: true, color: DARK }),
          ]}));
          (m.bullets || []).forEach(b => { if(b) c.push(new Paragraph({ spacing: { after: 2 }, indent: { left: 400 }, children: [new TextRun({ text: "•  " + b, font: "Arial", size: 14, color: DARK })] })); });
          (m.links || []).forEach(lk => { c.push(new Paragraph({ spacing: { after: 2 }, indent: { left: 400 }, children: [new TextRun({ text: "🔗 " + lk.label + ": " + lk.url, font: "Arial", size: 12, color: BLUE })] })); });
        });
      }
      c.push(new Paragraph({ spacing: { after: 60 } }));
    }
    } // end includeTables/full conditional

    // ── Tasks ──
    const allTasks = (state.tasks||[]).filter(t => inRange(t.created) || inRange(t.completed));
    const doneTasks = allTasks.filter(t => t.status === "done");
    const showTasks = detail === "comprehensive" ? allTasks : doneTasks;
    if (includeTasks && showTasks.length) {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: detail === "comprehensive" ? "All Tasks (" + showTasks.length + ")" : "Completed Tasks (" + doneTasks.length + ")", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));
      showTasks.forEach(t => {
        const proj = state.projects.find(p => p.id === t.project);
        const icon = t.status === "done" ? "✓" : "○";
        const iconColor = t.status === "done" ? GREEN : GRAY;
        c.push(new Paragraph({ spacing: { after: 4 }, children: [
          new TextRun({ text: icon + "  ", font: "Arial", size: 16, color: iconColor }),
          proj ? new TextRun({ text: "[" + proj.shortName + "]  ", font: "Arial", size: 16, bold: true, color: GRAY }) : new TextRun({ text: "" }),
          new TextRun({ text: t.text, font: "Arial", size: 16, color: DARK }),
          t.owner ? new TextRun({ text: "  (👤 " + t.owner + ")", font: "Arial", size: 14, color: BLUE }) : new TextRun({ text: "" }),
          t.completed ? new TextRun({ text: "  done " + t.completed, font: "Arial", size: 14, color: LGRAY }) : new TextRun({ text: "  added " + t.created, font: "Arial", size: 14, color: LGRAY }),
        ]}));
        if (detail === "comprehensive") {
          (t.bullets || []).forEach(b => { if(b) c.push(new Paragraph({ spacing: { after: 2 }, indent: { left: 400 }, children: [new TextRun({ text: "•  " + b, font: "Arial", size: 14, color: DARK })] })); });
          (t.links || []).forEach(lk => { c.push(new Paragraph({ spacing: { after: 2 }, indent: { left: 400 }, children: [new TextRun({ text: "🔗 " + lk.label + ": " + lk.url, font: "Arial", size: 12, color: BLUE })] })); });
        }
      });
    }

    // ── Journal ──
    const filteredJournal = state.journal.filter(j => inRange(j.date));
    const journalToShow = detail === "comprehensive" ? filteredJournal : filteredJournal.slice(0, 8);
    if (journalToShow.length && detail !== "summary") {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: detail === "comprehensive" ? "Journal (" + filteredJournal.length + " entries)" : "Recent Activity", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));
      journalToShow.forEach(j => {
        const proj = state.projects.find(pr => pr.id === j.project);
        c.push(new Paragraph({ spacing: { after: 6 }, children: [
          new TextRun({ text: j.date + "  ", font: "Arial", size: 14, color: LGRAY }),
          new TextRun({ text: "[" + (proj?.shortName || "ALL") + "]  ", font: "Arial", size: 14, bold: true, color: GRAY }),
          new TextRun({ text: j.text, font: "Arial", size: 16, color: DARK }),
        ]}));
      });
    }

    // ── Notes ──
    if (notes) {
      c.push(new Paragraph({ spacing: { before: 200, after: 60 }, children: [
        new TextRun({ text: "Notes", font: "Times New Roman", size: 20, color: BLUE }),
      ]}));
      c.push(new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun({ text: notes, font: "Arial", size: 18, color: DARK }),
      ]}));
    }

    const doc = new Document({ sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [
        new TextRun({ text: "Richard's Projects", font: "Times New Roman", size: 16, color: LGRAY }),
        new TextRun({ text: "  ·  Lilly Lebanon API  ·  " + today(), font: "Arial", size: 14, color: LGRAY }),
      ]})]})},
      footers: { default: new Footer({ children: [new Paragraph({ children: [
        new TextRun({ text: "Company Confidential  ©  " + yr + " Eli Lilly and Company          Page ", font: "Arial", size: 14, color: LGRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 14, color: LGRAY }),
      ]})]})},
      children: c,
    }]});

    const buffer = await Packer.toBuffer(doc);
    const filename = today() + "_" + type + ".docx";
    fs.writeFileSync(path.join(REPORTS_DIR, filename), buffer);
    res.json({ ok: true, filename, downloadUrl: "/api/reports/" + filename });
  } catch (e) { console.error("DOCX error:", e); res.status(500).json({ error: e.message }); }
});

// ═══ ARCHIVE ═══
app.get("/api/archive", (req, res) => {
  const files = fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith(".json")).sort().reverse();
  res.json(files.map(f => { const d = readJSON(path.join(ARCHIVE_DIR, f), {}); return { filename: f, markdownFile: f.replace(".json", ".md"), closedAt: d.closedAt, projectName: d.project?.name, shortName: d.project?.shortName, completionRate: d.statistics?.completionRate }; }));
});
app.get("/api/archive/:filename", (req, res) => {
  const file = path.join(ARCHIVE_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  if (req.params.filename.endsWith(".md")) res.type("text/markdown").send(fs.readFileSync(file, "utf8"));
  else if (req.params.filename.endsWith(".docx")) res.download(file);
  else res.json(readJSON(file, {}));
});

// ═══ ARCHIVE DOCX EXPORT ═══
app.post("/api/archive/:id/export-docx", async (req, res) => {
  try {
    const jsonFile = fs.readdirSync(ARCHIVE_DIR).find(f => f.startsWith(req.params.id) && f.endsWith(".json"));
    if (!jsonFile) return res.status(404).json({ error: "Not found" });
    const summary = readJSON(path.join(ARCHIVE_DIR, jsonFile), {});
    // Re-use same docx engine with closure data
    const fakeState = { projects: [summary.project], journal: [] };
    const reqBody = { type: "closure", projectIds: [summary.project.id], title: "Closure Report: " + summary.project.shortName + " — " + summary.project.name, notes: summary.closureNotes };
    req.body = reqBody;
    // Forward to export-docx
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, Header, Footer, PageNumber, ShadingType, TableLayoutType } = docx;
    const yr = new Date().getFullYear();
    const RED = "E1251B", BLUE = "0F3A85", DARK = "212121", BLUSH = "FDE8E5";
    const children = [];
    children.push(new Paragraph({ children: [new TextRun({ text: reqBody.title, font: "Times New Roman", size: 48, bold: true, color: RED })], spacing: { after: 200 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Closed: " + summary.closeDate + "  |  Completion: " + summary.statistics.completionRate + "%", font: "Arial", size: 22, color: BLUE })], spacing: { after: 300 } }));
    const doc = new Document({ sections: [{ properties: {},
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "Richard's Projects — Archive", font: "Times New Roman", size: 18, bold: true, color: RED })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: "Company Confidential  © " + yr + " Eli Lilly and Company", font: "Arial", size: 16, color: "888888" })] })] }) },
      children }] });
    const buffer = await Packer.toBuffer(doc);
    const filename = jsonFile.replace(".json", ".docx");
    fs.writeFileSync(path.join(ARCHIVE_DIR, filename), buffer);
    res.json({ ok: true, filename, downloadUrl: "/api/archive/" + filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function getHealth(p) {
  const b = p.milestones.filter(m => m.status === "blocked").length;
  const a = p.milestones.filter(m => m.status === "at-risk").length;
  const o = p.milestones.filter(m => { if (m.status === "complete" || !m.target) return false; return (new Date(m.target) - new Date()) / 864e5 < 0; }).length;
  const c = p.milestones.filter(m => m.status === "complete").length;
  if (b || o > 1) return "CRITICAL"; if (a || o === 1) return "AT RISK";
  if (c === p.milestones.length && p.milestones.length) return "COMPLETE"; return "ON TRACK";
}

// ═══ TASKS (ad-hoc, non-project work) ═══
app.get("/api/tasks", (req, res) => {
  const state = readJSON(STATE_FILE, { tasks: [] });
  res.json(state.tasks || []);
});

app.post("/api/tasks", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  if (!state.tasks) state.tasks = [];
  const task = {
    id: uid(), text: req.body.text, status: "open",
    created: today(), completed: null, notes: req.body.notes || "",
    tags: req.body.tags || [], project: req.body.project || null
  };
  state.tasks.unshift(task);
  saveState(state);
  res.json({ ok: true, task });
});

app.patch("/api/tasks/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { tasks: [] });
  if (!state.tasks) state.tasks = [];
  const task = state.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Not found" });
  Object.assign(task, req.body);
  if (req.body.status === "done" && !task.completed) task.completed = today();
  if (req.body.status === "open") task.completed = null;
  saveState(state);
  res.json({ ok: true, task });
});

app.delete("/api/tasks/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { tasks: [] });
  state.tasks = (state.tasks || []).filter(t => t.id !== req.params.id);
  saveState(state);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = "http://localhost:" + PORT;
  console.log("\n  Richard's Projects — http://localhost:" + PORT);
  console.log("  Data: " + DATA + "\n");
  const { exec } = require("child_process");
  exec(process.platform === "win32" ? "start " + url : process.platform === "darwin" ? "open " + url : "xdg-open " + url, () => {});
});
