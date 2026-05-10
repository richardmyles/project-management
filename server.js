const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3201;

const ROOT = process.env.APP_DATA_PATH || __dirname;
const DATA = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA, "state.json");
const GOALS_DIR = path.join(DATA, "goals");
const ARCHIVE_DIR = path.join(DATA, "archive");
const REPORTS_DIR = path.join(DATA, "reports");
const HISTORY_DIR = path.join(DATA, ".history");
const DRAFTS_DIR = path.join(DATA, "drafts");
const GOAL_MAP_FILE = path.join(GOALS_DIR, "goal_project_map.json");
const CONFIG_FILE = path.join(ROOT, "config.json");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const MEMORY_FILE = path.join(DATA, "memory.md");
const BRIEFING_DIR = path.join(DATA, "briefing");
const BRIEFING_FILE = path.join(BRIEFING_DIR, "latest.json");
const RESOLVED_FILE = path.join(BRIEFING_DIR, "resolved.json");
const NOTES_FILE = path.join(DATA, "notes.json");
const NOTES_HTML_DIR = path.join(DATA, "notes-html");

[DATA, GOALS_DIR, ARCHIVE_DIR, REPORTS_DIR, HISTORY_DIR, DRAFTS_DIR, UPLOADS_DIR, BRIEFING_DIR, NOTES_HTML_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 250 * 1024 * 1024 } });

let _upload = null;
function getUpload() {
  if (!_upload) _upload = require("multer")({ dest: UPLOADS_DIR, limits: { fileSize: 250 * 1024 * 1024 } });
  return _upload;
}

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readJSON(fp, fallback) {
  try { if (!fs.existsSync(fp)) return fallback; return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8"); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function today() { return new Date().toISOString().split("T")[0]; }
function getConfig() {
  return readJSON(CONFIG_FILE, { name: "My", team: "", org: "", primaryColor: "#0F3A85", setupComplete: false });
}

// ═══ CONFIG ═══
app.get("/api/config", (req, res) => { res.json(getConfig()); });
app.put("/api/config", (req, res) => {
  const updated = { ...getConfig(), ...req.body, setupComplete: true };
  writeJSON(CONFIG_FILE, updated);
  res.json({ ok: true, config: updated });
});

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
  pushHistory(false);
  fs.writeFileSync(STATE_FILE, redoStack.pop());
  res.json({ ok: true, remaining: redoStack.length });
});

app.get("/api/history/count", (req, res) => {
  res.json({ undo: fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).length, redo: redoStack.length });
});

// ═══ STATE ═══
app.get("/api/state", (req, res) => { res.json(readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] })); });
app.put("/api/state", (req, res) => { saveState(req.body); res.json({ ok: true }); });

app.post("/api/project", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  const p = { id: uid(), ...req.body, archived: false };
  ["milestones","dependencies","risks","syncItems","goalRefs"].forEach(k => { if (!p[k]) p[k] = []; });
  state.projects.push(p); saveState(state); res.json({ ok: true, project: p });
});

app.patch("/api/project/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  const idx = state.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  state.projects[idx] = { ...state.projects[idx], ...req.body };
  saveState(state); res.json({ ok: true });
});

app.delete("/api/project/:id", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  state.projects = state.projects.filter(p => p.id !== req.params.id);
  saveState(state); res.json({ ok: true });
});

// ═══ CLOSE PROJECT ═══
app.post("/api/project/:id/close", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  const idx = state.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const project = state.projects[idx], closeDate = today();
  const totalMs = project.milestones.length, completeMs = project.milestones.filter(m => m.status === "complete").length;
  const relJ = state.journal.filter(j => j.project === project.id || j.project === "all");
  const summary = { closedAt: new Date().toISOString(), closeDate, project: { ...project },
    statistics: { totalMilestones: totalMs, completedMilestones: completeMs,
      completionRate: totalMs ? Math.round((completeMs / totalMs) * 100) : 0,
      projectTarget: project.targetDate, actualCloseDate: closeDate },
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
  const all = {};
  files.forEach(f => { const yr = f.split("_")[0]; all[yr] = readJSON(path.join(GOALS_DIR, f), { year: parseInt(yr), goals: [] }); });
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

// Update a single goal's status or quarterly notes
app.patch("/api/goals/:goalId", (req, res) => {
  const { goalId } = req.params;
  const files = fs.readdirSync(GOALS_DIR).filter(f => f.match(/^\d{4}_goals\.json$/));
  for (const f of files) {
    const fp = path.join(GOALS_DIR, f);
    const data = readJSON(fp, null);
    if (!data) continue;
    const idx = data.goals.findIndex(g => g.id === goalId);
    if (idx !== -1) {
      const allowed = ["status","q1Notes","q2Notes","q3Notes","q4Notes","text","description","category","subItems","dueDate","orgAlignment"];
      allowed.forEach(k => { if (req.body[k] !== undefined) data.goals[idx][k] = req.body[k]; });
      writeJSON(fp, data);
      return res.json({ ok: true, goal: data.goals[idx] });
    }
  }
  res.status(404).json({ error: "Goal not found" });
});

// Add a single goal manually
app.post("/api/goals", (req, res) => {
  const year = req.body.year || new Date().getFullYear();
  const { category, text, description = "", orgAlignment = "", subItems = [], dueDate = "" } = req.body;
  if (!category || !text) return res.status(400).json({ error: "category and text required" });
  const file = path.join(GOALS_DIR, year + "_goals.json");
  const data = readJSON(file, { year, importedAt: new Date().toISOString(), goals: [] });
  const goal = { id: "g-" + uid(), category, text, description, orgAlignment, subItems, dueDate, linkedProjects: [],
    status: "on-track", q1Notes: "", q2Notes: "", q3Notes: "", q4Notes: "" };
  data.goals.push(goal);
  writeJSON(file, data);
  res.json({ ok: true, goal });
});

// ═══ DOCX GOALS UPLOAD ═══
app.post("/api/goals/upload-docx", upload.single("goalsFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const mammoth = require("mammoth");
    const result = await mammoth.convertToHtml({ path: req.file.path });
    const html = result.value;

    // Parse HTML into structured goals
    const goals = parseGoalsFromHtml(html);
    fs.unlinkSync(req.file.path);

    if (!goals.length) return res.status(422).json({ error: "No goals could be parsed from this document. Make sure it uses headings or bold text for categories and numbered/bulleted lists for goals." });

    const year = parseInt(req.body.year) || new Date().getFullYear();
    const file = path.join(GOALS_DIR, year + "_goals.json");
    const existing = readJSON(file, null);
    let goalsAdded = 0, goalsUpdated = 0;

    if (existing) {
      const map = new Map(existing.goals.map(g => [g.id, g]));
      goals.forEach(g => {
        const ex = map.get(g.id);
        if (ex) { ex.text = g.text; ex.category = g.category; ex.subItems = g.subItems; goalsUpdated++; }
        else { const {_fromPara,...rest}=g; map.set(g.id, { ...rest, status: "on-track", q1Notes: "", q2Notes: "", q3Notes: "", q4Notes: "" }); goalsAdded++; }
      });
      existing.goals = Array.from(map.values()).map(({_fromPara,...rest})=>rest);
      existing.importedAt = new Date().toISOString();
      writeJSON(file, existing);
    } else {
      goalsAdded = goals.length;
      writeJSON(file, { year, importedAt: new Date().toISOString(), goals: goals.map(({_fromPara,...g}) => ({ ...g, status: "on-track", q1Notes: "", q2Notes: "", q3Notes: "", q4Notes: "" })) });
    }
    res.json({ ok: true, goalsAdded, goalsUpdated, total: goalsAdded + goalsUpdated, goals });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("DOCX parse error:", e);
    res.status(500).json({ error: e.message });
  }
});

function parseGoalsFromHtml(html) {
  const goals = [];
  let currentCategory = "General";
  let gIndex = 0;

  const clean = s => s.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&nbsp;/g," ").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
    .replace(/\s+/g," ").trim();

  const skipLabel = s => /^(organization\s+alignment|supporting\s+activit|measure|success\s+criteria|alignment|due\s+date|status)\s*[:;]?\s*$/i.test(s);

  // Preprocess: replace <p> tags inside <li> with NUL separator so the outer split
  // doesn't fragment list items (mammoth always wraps <li> content in <p> tags).
  const prep = html.replace(/<li([^>]*)>((?:(?!<li|<\/li>)[\s\S])*)<\/li>/gi, (_, attrs, inner) => {
    const flat = inner.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\x00");
    return "<li" + attrs + ">" + flat + "</li>";
  });

  const chunks = prep.split(/(?=<(?:h[1-6]|p|ul|ol)\b)/i).filter(s => s.trim());

  for (const chunk of chunks) {
    // Heading → new category
    const hm = chunk.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (hm) {
      const text = clean(hm[2]);
      if (text) currentCategory = text;
      continue;
    }

    // Paragraph (only top-level; <p> inside <li> was already flattened above)
    const pm = chunk.match(/^<p[^>]*>([\s\S]*?)<\/p>/i);
    if (pm) {
      const inner = pm[1];
      const text = clean(inner);
      if (!text || text.length < 3 || /^page \d+/i.test(text) || skipLabel(text)) continue;

      // Bold-only short paragraph → treat as a category name
      const isBold = /^<(?:strong|b)[^>]*>[\s\S]*?<\/(?:strong|b)>$/i.test(inner.trim());
      if (isBold && text.split(/\s+/).length <= 8) { currentCategory = text; continue; }

      const lastGoal = goals.length ? goals[goals.length - 1] : null;
      const sameCategory = lastGoal && lastGoal.category === currentCategory;

      if (sameCategory && !lastGoal.description) {
        lastGoal.description = text;
      } else {
        gIndex++;
        goals.push({ id:"g-"+gIndex, category:currentCategory, text, description:"", orgAlignment:"", subItems:[], linkedProjects:[], _fromPara:true });
      }
      continue;
    }

    // List
    if (/^<(?:ul|ol)\b/i.test(chunk)) {
      const lastGoal = goals.length ? goals[goals.length - 1] : null;
      const sameCategory = lastGoal && lastGoal.category === currentCategory;
      // When the previous goal came from a paragraph, list items are its supporting activities
      const foldIntoSubs = !!(sameCategory && lastGoal && lastGoal._fromPara);

      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let lim;
      while ((lim = liRe.exec(chunk)) !== null) {
        const nestedMatch = lim[1].match(/<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/i);
        const mainContent = lim[1].replace(/<(?:ul|ol)[^>]*>[\s\S]*?<\/(?:ul|ol)>/gi, "");
        const parts = mainContent.split("\x00").map(p => clean(p)).filter(s => s.length > 1);
        if (!parts.length) continue;

        const liText = parts[0];
        const liDesc = parts.slice(1).join(" ");

        if (!liText || liText.length < 2 || skipLabel(liText)) continue;

        if (foldIntoSubs) {
          lastGoal.subItems.push(liText);
        } else {
          const subItems = [];
          if (nestedMatch) {
            [...nestedMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
              .forEach(n => { const t = clean(n[1].split("\x00")[0]); if (t) subItems.push(t); });
          }
          gIndex++;
          goals.push({ id:"g-"+gIndex, category:currentCategory, text:liText, description:liDesc, orgAlignment:"", subItems, linkedProjects:[] });
        }
      }
      continue;
    }
  }

  return goals;
}

// ═══ GOALS EXPORT DOCX ═══
app.post("/api/goals/export-docx", async (req, res) => {
  try {
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, BorderStyle } = docx;
    const year = req.body.year || new Date().getFullYear();
    const file = path.join(GOALS_DIR, year + "_goals.json");
    const goalsData = readJSON(file, null);
    if (!goalsData) return res.status(404).json({ error: "No goals for " + year });
    const cfg = getConfig();
    const BLUE = "0F3A85", DARK = "212121", GRAY = "888888", LGRAY = "C0C0C0", GREEN = "144B2D";
    const SL = { "on-track": "✓", "complete": "✓", "needs-attention": "△", "in-progress": "▸" };
    const SC = { "on-track": GREEN, "complete": GRAY, "needs-attention": "B8860B", "in-progress": BLUE };
    const SName = { "on-track": "On Track", "complete": "Complete", "needs-attention": "Needs Attention", "in-progress": "In Progress" };
    const appTitle = cfg.name ? cfg.name + "'s Goals — " + year : "Goals " + year;
    const c = [];

    c.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: year + " Annual Goals", font: "Times New Roman", size: 28, bold: true, color: BLUE }),
    ]}));
    if (cfg.name || cfg.team) {
      c.push(new Paragraph({ spacing: { after: 20 }, children: [
        new TextRun({ text: [cfg.name, cfg.team].filter(Boolean).join("  ·  "), font: "Arial", size: 18, color: GRAY }),
      ]}));
    }
    c.push(new Paragraph({ border: { bottom: { color: BLUE, space: 4, style: BorderStyle.SINGLE, size: 2 } }, spacing: { after: 240 } }));

    const active = goalsData.goals.filter(g => g.status !== "discontinued");
    const categories = [...new Set(active.map(g => g.category))];

    for (const cat of categories) {
      const catGoals = active.filter(g => g.category === cat);
      c.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [
        new TextRun({ text: cat.toUpperCase(), font: "Arial", size: 16, bold: true, color: BLUE, characterSpacing: 80 }),
      ]}));
      for (const g of catGoals) {
        const statusColor = SC[g.status] || GREEN;
        const statusName = SName[g.status] || g.status;
        c.push(new Paragraph({ spacing: { before: 80, after: 8 }, children: [
          new TextRun({ text: (SL[g.status] || "○") + "  ", font: "Arial", size: 16, color: statusColor }),
          new TextRun({ text: g.text, font: "Times New Roman", size: 20, bold: true, color: DARK }),
        ]}));
        const meta = [statusName, g.dueDate ? "Due: " + g.dueDate : null, g.orgAlignment ? "Alignment: " + g.orgAlignment : null].filter(Boolean).join("  ·  ");
        if (meta) c.push(new Paragraph({ spacing: { after: 8 }, indent: { left: 240 }, children: [new TextRun({ text: meta, font: "Arial", size: 14, color: GRAY })]}));
        if (g.description) c.push(new Paragraph({ spacing: { after: 8 }, indent: { left: 240 }, children: [new TextRun({ text: g.description, font: "Arial", size: 16, color: DARK })]}));
        (g.subItems || []).forEach(si => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 480 }, children: [new TextRun({ text: "•  " + si, font: "Arial", size: 14, color: DARK })]})));
        const qRows = ["q1Notes","q2Notes","q3Notes","q4Notes"].map((k,i) => g[k] ? "Q"+(i+1)+": "+g[k] : null).filter(Boolean);
        qRows.forEach(qr => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 480 }, children: [new TextRun({ text: qr, font: "Arial", size: 14, italics: true, color: GRAY })]})));
        c.push(new Paragraph({ spacing: { after: 12 } }));
      }
    }

    const doc = new Document({ sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [
        new TextRun({ text: appTitle, font: "Times New Roman", size: 16, color: LGRAY }),
        new TextRun({ text: (cfg.team ? "  ·  " + cfg.team : "") + "  ·  " + today(), font: "Arial", size: 14, color: LGRAY }),
      ]})]})},
      footers: { default: new Footer({ children: [new Paragraph({ children: [
        new TextRun({ text: "Confidential" + (cfg.org ? "  ·  " + cfg.org : "") + "          Page ", font: "Arial", size: 14, color: LGRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 14, color: LGRAY }),
      ]})]})},
      children: c,
    }]});

    const buffer = await Packer.toBuffer(doc);
    const filename = year + "_goals.docx";
    fs.writeFileSync(path.join(REPORTS_DIR, filename), buffer);
    res.json({ ok: true, filename, downloadUrl: "/api/reports/" + filename });
  } catch (e) { console.error("Goals DOCX error:", e); res.status(500).json({ error: e.message }); }
});

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
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
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

// ═══ DOCX REPORT EXPORT ═══
app.post("/api/reports/export-docx", async (req, res) => {
  try {
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            WidthType, BorderStyle, Header, Footer, PageNumber, ShadingType, TableLayoutType } = docx;
    let { type = "checkin", quarter, notes, projectIds, title,
            detail = "checkin", includeTables = false, includeTasks = false,
            dateFrom = null, dateTo = null } = req.body;
    const cfg = getConfig();
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    const yr = new Date().getFullYear();
    const goalsData = readJSON(path.join(GOALS_DIR, yr + "_goals.json"), null);
    const selected = projectIds && projectIds.length
      ? state.projects.filter(p => projectIds.includes(p.id))
      : state.projects.filter(p => !p.archived);

    if (detail === "comprehensive") { includeTables = true; includeTasks = true; }

    const inRange = (dateStr) => {
      if (!dateStr) return true;
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    };
    const rangeLabel = dateFrom || dateTo ? (dateFrom || "start") + " → " + (dateTo || "present") : "all time";

    const DARK = "333333", GRAY = "888888", LGRAY = "C0C0C0", RED = "E1251B", BLUE = "0F3A85", GREEN = "144B2D";
    const SC = { "complete": GREEN, "in-progress": BLUE, "at-risk": "B8860B", "blocked": RED, "not-started": "999999" };
    const SL = { "complete": "✓", "in-progress": "▸", "at-risk": "△", "blocked": "✕", "not-started": "○" };
    const noBorder = { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } };
    const thinBottom = { ...noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" } };

    const c = [];

    // Title block
    c.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: title || (type === "quarterly" ? "Q" + (quarter||"") + " " + yr + " Progress Report" : "Progress Report"), font: "Times New Roman", size: 28, color: RED }),
    ]}));
    c.push(new Paragraph({ spacing: { after: 20 }, children: [
      new TextRun({ text: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (dateFrom || dateTo ? "  ·  Scope: " + rangeLabel : ""), font: "Arial", size: 18, color: GRAY }),
    ]}));
    if (cfg.name || cfg.team) {
      c.push(new Paragraph({ spacing: { after: 20 }, children: [
        new TextRun({ text: [cfg.name, cfg.team].filter(Boolean).join("  ·  "), font: "Arial", size: 18, color: GRAY }),
      ]}));
    }
    c.push(new Paragraph({ border: { bottom: { color: RED, space: 4, style: BorderStyle.SINGLE, size: 2 } }, spacing: { after: 240 } }));

    // Summary snapshot
    const totalMs = selected.reduce((s,p) => s + p.milestones.length, 0);
    const compMs = selected.reduce((s,p) => s + p.milestones.filter(m => m.status === "complete").length, 0);
    const pctComplete = totalMs ? Math.round((compMs/totalMs)*100) : 0;

    c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "Overview", font: "Times New Roman", size: 22, color: BLUE })] }));
    c.push(new Paragraph({ spacing: { after: 20 }, children: [
      new TextRun({ text: selected.length + " active projects  ·  " + compMs + " of " + totalMs + " milestones complete (" + pctComplete + "%)  ·  " + (state.tasks||[]).filter(t=>t.status==="done").length + " ad-hoc tasks completed", font: "Arial", size: 18, color: DARK }),
    ]}));

    selected.forEach(p => {
      const h = getHealth(p), comp = p.milestones.filter(m=>m.status==="complete").length;
      const hKey = h === "ON TRACK" ? "complete" : h === "AT RISK" ? "at-risk" : h === "CRITICAL" ? "blocked" : "complete";
      c.push(new Paragraph({ spacing: { after: 8 }, indent: { left: 200 }, children: [
        new TextRun({ text: SL[hKey] + "  ", font: "Arial", size: 18, color: SC[hKey] }),
        new TextRun({ text: p.shortName, font: "Arial", size: 18, bold: true, color: DARK }),
        new TextRun({ text: "  " + p.name + "  —  " + comp + "/" + p.milestones.length, font: "Arial", size: 18, color: GRAY }),
      ]}));
    });
    c.push(new Paragraph({ spacing: { after: 200 } }));

    // Per-project checkin breakdown
    if (detail === "checkin") {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { after: 120 }, children: [
        new TextRun({ text: "Project Updates", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));
      for (const p of selected) {
        const compMs = p.milestones.filter(m => m.status === "complete");
        const inProgMs = p.milestones.filter(m => m.status === "in-progress" || m.status === "at-risk" || m.status === "blocked");
        const pTasks = (state.tasks||[]).filter(t => t.project === p.id && t.status === "done");
        if (!compMs.length && !inProgMs.length && !pTasks.length) continue;
        const h = getHealth(p);
        const hKey = h === "ON TRACK" ? "complete" : h === "AT RISK" ? "at-risk" : h === "CRITICAL" ? "blocked" : "complete";
        c.push(new Paragraph({ spacing: { before: 160, after: 20 }, children: [
          new TextRun({ text: p.shortName + "  ", font: "Times New Roman", size: 22, bold: true, color: BLUE }),
          new TextRun({ text: p.name, font: "Times New Roman", size: 22, color: DARK }),
          new TextRun({ text: "  ·  " + h, font: "Arial", size: 16, color: SC[hKey] }),
        ]}));
        if (inProgMs.length) {
          c.push(new Paragraph({ spacing: { after: 6 }, children: [new TextRun({ text: "ACTIVE MILESTONES", font: "Arial", size: 14, bold: true, color: LGRAY, characterSpacing: 80 })] }));
          inProgMs.forEach(m => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 200 }, children: [
            new TextRun({ text: SL[m.status] + "  ", font: "Arial", size: 16, color: SC[m.status] || DARK }),
            new TextRun({ text: m.name, font: "Arial", size: 16, color: DARK }),
            m.target ? new TextRun({ text: "  — " + m.target, font: "Arial", size: 14, color: GRAY }) : new TextRun({ text: "" }),
          ]})));
        }
        if (compMs.length) {
          c.push(new Paragraph({ spacing: { before: inProgMs.length ? 60 : 0, after: 6 }, children: [new TextRun({ text: "COMPLETED MILESTONES", font: "Arial", size: 14, bold: true, color: LGRAY, characterSpacing: 80 })] }));
          compMs.forEach(m => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 200 }, children: [
            new TextRun({ text: "✓  ", font: "Arial", size: 16, color: GREEN }),
            new TextRun({ text: m.name, font: "Arial", size: 16, color: GRAY }),
          ]})));
        }
        if (pTasks.length) {
          c.push(new Paragraph({ spacing: { before: (inProgMs.length || compMs.length) ? 60 : 0, after: 6 }, children: [new TextRun({ text: "AD-HOC TASKS COMPLETED", font: "Arial", size: 14, bold: true, color: LGRAY, characterSpacing: 80 })] }));
          pTasks.forEach(t => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 200 }, children: [
            new TextRun({ text: "✓  ", font: "Arial", size: 16, color: GREEN }),
            new TextRun({ text: t.text, font: "Arial", size: 16, color: GRAY }),
          ]})));
        }
      }
      const unassignedTasks = (state.tasks||[]).filter(t => !t.project && t.status === "done");
      if (unassignedTasks.length) {
        c.push(new Paragraph({ spacing: { before: 160, after: 20 }, children: [
          new TextRun({ text: "Other Completed Tasks", font: "Times New Roman", size: 22, color: DARK }),
        ]}));
        unassignedTasks.forEach(t => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 200 }, children: [
          new TextRun({ text: "✓  ", font: "Arial", size: 16, color: GREEN }),
          new TextRun({ text: t.text, font: "Arial", size: 16, color: GRAY }),
        ]})));
      }
      c.push(new Paragraph({ spacing: { after: 200 } }));
    }

    // Goals section
    if (detail !== "summary" && detail !== "checkin" && goalsData && goalsData.goals && goalsData.goals.length) {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { after: 160 }, children: [
        new TextRun({ text: "Progress by Goal", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));
      const categories = [...new Set(goalsData.goals.map(g => g.category))];
      for (const cat of categories) {
        const catGoals = goalsData.goals.filter(g => g.category === cat);
        c.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [
          new TextRun({ text: cat.toUpperCase(), font: "Arial", size: 16, bold: true, color: LGRAY, characterSpacing: 80 }),
        ]}));
        for (const goal of catGoals) {
          c.push(new Paragraph({ spacing: { after: 30 }, children: [
            new TextRun({ text: goal.text, font: "Times New Roman", size: 20, color: DARK }),
          ]}));
          const linked = selected.filter(p => (goal.linkedProjects || []).includes(p.id));
          if (linked.length) {
            for (const p of linked) {
              const comp = p.milestones.filter(m => m.status === "complete").length;
              c.push(new Paragraph({ spacing: { after: 12 }, indent: { left: 240 }, children: [
                new TextRun({ text: p.shortName + ": " + p.name, font: "Arial", size: 18, bold: true, color: DARK }),
                new TextRun({ text: "  ·  " + getHealth(p) + "  ·  " + comp + "/" + p.milestones.length, font: "Arial", size: 16, color: GRAY }),
              ]}));
              const inProg = p.milestones.filter(m => m.status === "in-progress" && inRange(m.target));
              const atRsk = p.milestones.filter(m => (m.status === "at-risk" || m.status === "blocked") && inRange(m.target));
              const done = p.milestones.filter(m => m.status === "complete" && inRange(m.target)).slice(-3);
              done.forEach(m => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 480 }, children: [new TextRun({ text: "✓  " + m.name, font: "Arial", size: 16, color: GRAY })] })));
              inProg.forEach(m => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 480 }, children: [new TextRun({ text: "▸  " + m.name + (m.target ? " — " + m.target : ""), font: "Arial", size: 16, color: DARK })] })));
              atRsk.forEach(m => c.push(new Paragraph({ spacing: { after: 4 }, indent: { left: 480 }, children: [new TextRun({ text: "⚠  " + m.name, font: "Arial", size: 16, color: RED })] })));
            }
          }
        }
      }
      c.push(new Paragraph({ spacing: { after: 160 } }));
    }

    // Project detail tables
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
        const hdr = new TableRow({ children: ["Milestone","Target","Status","Owner / Notes"].map(h =>
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, font: "Arial", size: 16, bold: true, color: BLUE })] })],
            shading: { type: ShadingType.CLEAR, fill: "F5F5F5" }, borders: thinBottom,
            width: { size: h === "Milestone" ? 35 : h === "Owner / Notes" ? 35 : 15, type: WidthType.PERCENTAGE } })
        )});
        const rows = filteredMs.map(m => new TableRow({ children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: m.name, font: "Arial", size: 16, color: m.status === "complete" ? GRAY : DARK })] })], borders: thinBottom }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: m.target || "—", font: "Arial", size: 16, color: GRAY })] })], borders: thinBottom }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: SL[m.status] + " " + m.status.replace(/-/g," "), font: "Arial", size: 16, color: SC[m.status] || DARK })] })], borders: thinBottom }),
          new TableCell({ children: [new Paragraph({ children: [
            m.owner ? new TextRun({ text: m.owner + "  ", font: "Arial", size: 14, bold: true, color: BLUE }) : new TextRun({ text: "" }),
            new TextRun({ text: m.notes || "", font: "Arial", size: 14, italics: true, color: GRAY }),
          ]})], borders: thinBottom }),
        ]}));
        c.push(new Table({ rows: [hdr, ...rows], width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED }));
        c.push(new Paragraph({ spacing: { after: 60 } }));
      }
    }

    // Tasks
    const allTasks = (state.tasks||[]).filter(t => inRange(t.created) || inRange(t.completed));
    const showTasks = detail === "comprehensive" ? allTasks : allTasks.filter(t => t.status === "done");
    if (includeTasks && showTasks.length) {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: "Tasks (" + showTasks.length + ")", font: "Times New Roman", size: 22, color: BLUE }),
      ]}));
      showTasks.forEach(t => {
        const proj = state.projects.find(p => p.id === t.project);
        c.push(new Paragraph({ spacing: { after: 4 }, children: [
          new TextRun({ text: (t.status === "done" ? "✓" : "○") + "  ", font: "Arial", size: 16, color: t.status === "done" ? GREEN : GRAY }),
          proj ? new TextRun({ text: "[" + proj.shortName + "]  ", font: "Arial", size: 16, bold: true, color: GRAY }) : new TextRun({ text: "" }),
          new TextRun({ text: t.text, font: "Arial", size: 16, color: DARK }),
          t.owner ? new TextRun({ text: "  (" + t.owner + ")", font: "Arial", size: 14, color: BLUE }) : new TextRun({ text: "" }),
        ]}));
      });
    }

    // Journal
    const filteredJournal = state.journal.filter(j => inRange(j.date));
    const journalToShow = detail === "comprehensive" ? filteredJournal : filteredJournal.slice(0, 8);
    if (journalToShow.length && detail !== "summary" && detail !== "checkin") {
      c.push(new Paragraph({ border: { bottom: { color: "E0E0E0", space: 2, style: BorderStyle.SINGLE, size: 1 } }, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: "Recent Activity", font: "Times New Roman", size: 22, color: BLUE }),
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

    if (notes) {
      c.push(new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text: "Notes", font: "Times New Roman", size: 20, color: BLUE })] }));
      c.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: notes, font: "Arial", size: 18, color: DARK })] }));
    }

    const appTitle = cfg.name ? cfg.name + "'s Projects" : "My Projects";
    const doc = new Document({ sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [
        new TextRun({ text: appTitle, font: "Times New Roman", size: 16, color: LGRAY }),
        new TextRun({ text: (cfg.team ? "  ·  " + cfg.team : "") + "  ·  " + today(), font: "Arial", size: 14, color: LGRAY }),
      ]})]})},
      footers: { default: new Footer({ children: [new Paragraph({ children: [
        new TextRun({ text: "Confidential" + (cfg.org ? "  ·  " + cfg.org : "") + "          Page ", font: "Arial", size: 14, color: LGRAY }),
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

// ═══ AI REPORT → DOCX ═══
function mdRuns(line, TextRun, color = "333333") {
  const parts = [];
  const regex = /\*\*(.*?)\*\*/g;
  let last = 0, m;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) parts.push(new TextRun({ text: line.slice(last, m.index), font: "Arial", size: 18, color }));
    parts.push(new TextRun({ text: m[1], font: "Arial", size: 18, bold: true, color }));
    last = regex.lastIndex;
  }
  if (last < line.length) parts.push(new TextRun({ text: line.slice(last), font: "Arial", size: 18, color }));
  return parts.length ? parts : [new TextRun({ text: line, font: "Arial", size: 18, color })];
}

app.post("/api/reports/ai-export-docx", async (req, res) => {
  try {
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            WidthType, BorderStyle, Header, Footer, PageNumber, ShadingType, TableLayoutType } = docx;
    const { text, type = "ai-report" } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const cfg = getConfig();
    const DARK = "333333", GRAY = "888888", LGRAY = "C0C0C0", RED = "E1251B", BLUE = "0F3A85";
    const noBorder = { top:{style:BorderStyle.NONE,size:0}, bottom:{style:BorderStyle.NONE,size:0}, left:{style:BorderStyle.NONE,size:0}, right:{style:BorderStyle.NONE,size:0} };
    const thinBottom = { ...noBorder, bottom:{style:BorderStyle.SINGLE,size:1,color:"E0E0E0"} };

    const c = [];
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Table block
      if (line.startsWith("|")) {
        const tLines = [];
        while (i < lines.length && lines[i].startsWith("|")) { tLines.push(lines[i]); i++; }
        const dataRows = tLines.filter(l => !/^\|[\s\-|:]+\|$/.test(l));
        if (dataRows.length > 1) {
          const rows = dataRows.map((row, ri) => {
            const cells = row.split("|").slice(1, -1);
            return new TableRow({ children: cells.map(cell => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell.trim().replace(/\*\*/g,""), font:"Arial", size:16, bold:ri===0, color:ri===0?BLUE:DARK })] })],
              borders: thinBottom,
              shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "F5F5F5" } : undefined,
            })) });
          });
          c.push(new Table({ rows, width:{size:100,type:WidthType.PERCENTAGE}, layout:TableLayoutType.FIXED }));
          c.push(new Paragraph({ spacing:{after:80} }));
        }
        continue;
      }

      if (line.startsWith("# ")) {
        c.push(new Paragraph({ spacing:{after:40}, children:[new TextRun({text:line.slice(2),font:"Times New Roman",size:28,color:RED})] }));
        i++; continue;
      }
      if (line.startsWith("## ")) {
        c.push(new Paragraph({ border:{bottom:{color:"E0E0E0",space:2,style:BorderStyle.SINGLE,size:1}}, spacing:{before:180,after:80}, children:[new TextRun({text:line.slice(3),font:"Times New Roman",size:22,color:BLUE})] }));
        i++; continue;
      }
      if (line.startsWith("### ")) {
        c.push(new Paragraph({ spacing:{before:120,after:40}, children:[new TextRun({text:line.slice(4),font:"Arial",size:18,bold:true,color:DARK})] }));
        i++; continue;
      }
      if (line.match(/^---+$/)) {
        c.push(new Paragraph({ border:{bottom:{color:"E0E0E0",space:4,style:BorderStyle.SINGLE,size:1}}, spacing:{after:80} }));
        i++; continue;
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        c.push(new Paragraph({ spacing:{after:20}, indent:{left:240}, children: mdRuns(line.slice(2), TextRun, DARK) }));
        i++; continue;
      }
      if (!line.trim()) { i++; continue; }

      // Regular paragraph with inline bold
      c.push(new Paragraph({ spacing:{after:60}, children: mdRuns(line, TextRun, DARK) }));
      i++;
    }

    const appTitle = cfg.name ? cfg.name + "'s Projects" : "My Projects";
    const doc = new Document({ sections: [{
      properties: { page:{margin:{top:1200,bottom:1000,left:1100,right:1100}} },
      headers: { default: new Header({ children:[new Paragraph({children:[
        new TextRun({text:appTitle,font:"Times New Roman",size:16,color:LGRAY}),
        new TextRun({text:(cfg.team?"  ·  "+cfg.team:"")+"  ·  "+today(),font:"Arial",size:14,color:LGRAY}),
      ]})]})},
      footers: { default: new Footer({ children:[new Paragraph({children:[
        new TextRun({text:"Confidential"+(cfg.org?"  ·  "+cfg.org:"")+"          Page ",font:"Arial",size:14,color:LGRAY}),
        new TextRun({children:[PageNumber.CURRENT],font:"Arial",size:14,color:LGRAY}),
      ]})]})},
      children: c,
    }]});

    const buffer = await Packer.toBuffer(doc);
    const filename = today() + "_" + type + ".docx";
    fs.writeFileSync(path.join(REPORTS_DIR, filename), buffer);
    res.json({ ok: true, filename, downloadUrl: "/api/reports/" + filename });
  } catch (e) { console.error("AI DOCX error:", e); res.status(500).json({ error: e.message }); }
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

app.post("/api/archive/:id/export-docx", async (req, res) => {
  try {
    const jsonFile = fs.readdirSync(ARCHIVE_DIR).find(f => f.startsWith(req.params.id) && f.endsWith(".json"));
    if (!jsonFile) return res.status(404).json({ error: "Not found" });
    const summary = readJSON(path.join(ARCHIVE_DIR, jsonFile), {});
    const cfg = getConfig();
    const docx = require("docx");
    const { Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, BorderStyle } = docx;
    const yr = new Date().getFullYear();
    const RED = "E1251B", BLUE = "0F3A85", DARK = "212121", GRAY = "888888";
    const appTitle = cfg.name ? cfg.name + "'s Projects" : "My Projects";
    const children = [];
    children.push(new Paragraph({ children: [new TextRun({ text: "Closure Report: " + summary.project.shortName + " — " + summary.project.name, font: "Times New Roman", size: 48, bold: true, color: RED })], spacing: { after: 200 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Closed: " + summary.closeDate + "  |  Completion: " + summary.statistics.completionRate + "%", font: "Arial", size: 22, color: BLUE })], spacing: { after: 300 } }));
    const doc = new Document({ sections: [{ properties: {},
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: appTitle + " — Archive", font: "Times New Roman", size: 18, bold: true, color: RED })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [
        new TextRun({ text: "Confidential" + (cfg.org ? "  ·  " + cfg.org : ""), font: "Arial", size: 16, color: GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 14, color: GRAY }),
      ] })] }) },
      children }] });
    const buffer = await Packer.toBuffer(doc);
    const filename = jsonFile.replace(".json", ".docx");
    fs.writeFileSync(path.join(ARCHIVE_DIR, filename), buffer);
    res.json({ ok: true, filename, downloadUrl: "/api/archive/" + filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ AI MEMORY ═══
function getMemory() {
  if (!fs.existsSync(MEMORY_FILE)) return "";
  try { return fs.readFileSync(MEMORY_FILE, "utf8").trim(); } catch(_) { return ""; }
}

// ═══ AI CLIENT (corporate SSO via CLI token) ═══
const AI_BASE_URL_CONST = "https://your-gateway.example.com";
const AI_MODEL_CONST = "sonnet-latest";
let _tokenCache = { value: null, expiresAt: 0 };

function getAIToken() {
  const now = Date.now();
  if (_tokenCache.value && _tokenCache.expiresAt > now + 30000) return _tokenCache.value;
  try {
    const { execSync } = require("child_process");
    const token = execSync("your-cli-tool token", { timeout: 10000, shell: true }).toString().trim();
    if (!token) throw new Error("empty token");
    _tokenCache = { value: token, expiresAt: now + 270000 }; // cache 4.5 min (TTL is 5 min)
    return token;
  } catch (e) {
    throw new Error("Could not get AI token — make sure you are signed in: " + e.message);
  }
}

app.post("/api/claude", async (req, res) => {
  try {
    const apiKey = getAIToken();
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ authToken: apiKey, baseURL: AI_BASE_URL_CONST });
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const mem = getMemory();
    const userContent = mem
      ? [
          { type: "text", text: `Project context and memory:\n\n${mem}`, cache_control: { type: "ephemeral" } },
          { type: "text", text: prompt },
        ]
      : prompt;
    const message = await client.messages.create({
      model: AI_MODEL_CONST,
      max_tokens: 2048,
      messages: [{ role: "user", content: userContent }]
    });
    res.json({ ok: true, text: message.content[0].text });
  } catch (e) {
    console.error("Claude API error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ SCAN NOTES (AI) ═══
app.post("/api/scan", (req, res, next) => getUpload().array("files", 20)(req, res, next), async (req, res) => {
  const tempFiles = (req.files || []).map(f => f.path);
  try {
    const cfg = getConfig();
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    const existing = state.projects.map(p => ({ id: p.id, name: p.name, shortName: p.shortName }));

    const textParts = [];
    const imageBlocks = [];

    for (const file of (req.files || [])) {
      const ext = path.extname(file.originalname).toLowerCase();
      const label = file.originalname;
      if (ext === ".txt") {
        textParts.push(`--- ${label} ---\n${fs.readFileSync(file.path, "utf8")}`);
      } else if (ext === ".docx") {
        const result = await require("mammoth").extractRawText({ path: file.path });
        textParts.push(`--- ${label} ---\n${result.value}`);
      } else if (ext === ".xlsx" || ext === ".xls") {
        const xlsx = require("xlsx");
        const wb = xlsx.readFile(file.path);
        let text = "";
        wb.SheetNames.forEach(sn => { text += `[Sheet: ${sn}]\n${xlsx.utils.sheet_to_csv(wb.Sheets[sn])}\n`; });
        textParts.push(`--- ${label} ---\n${text}`);
      } else if (ext === ".pptx" || ext === ".ppt") {
        const AdmZip = require("adm-zip");
        const zip = new AdmZip(file.path);
        const slides = zip.getEntries()
          .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
          .sort((a, b) => a.entryName.localeCompare(b.entryName));
        const text = slides.map(e => e.getData().toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).join("\n");
        textParts.push(`--- ${label} ---\n${text}`);
      } else if (ext === ".mht" || ext === ".mhtml") {
        const pages = parseMhtFile(file.path);
        // Limit total scan content — take first 30 pages to avoid token overflow
        const limited = pages.slice(0, 30);
        limited.forEach(p => textParts.push(`--- ${label} / ${p.filename} ---\n${p.text.slice(0, 3000)}`));
      } else if ([".jpg",".jpeg",".png",".gif",".webp"].includes(ext)) {
        const mime = {".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".gif":"image/gif",".webp":"image/webp"}[ext];
        imageBlocks.push({ type: "image", source: { type: "base64", media_type: mime, data: fs.readFileSync(file.path).toString("base64") } });
      }
    }

    const pasteText = (req.body.pasteText || "").trim();
    if (pasteText) textParts.unshift(`--- Pasted Notes ---\n${pasteText}`);

    if (!textParts.length && !imageBlocks.length) return res.status(400).json({ error: "No content to scan" });

    const projectList = existing.length
      ? existing.map(p => `  {id:"${p.id}", name:"${p.name}", shortName:"${p.shortName}"}`).join("\n")
      : "  (none yet)";

    const systemText = `You are helping ${cfg.name || "a professional"}${cfg.team ? " (" + cfg.team + ")" : ""}${cfg.org ? " at " + cfg.org : ""} manage their workload.

Analyze the content and extract actionable work items. Follow these rules strictly:

QUALITY OVER QUANTITY: Extract only the most important, distinct items. Aim for 3–8 tasks, 2–5 milestones, and 2–5 journal entries. Never extract every sentence.

CONCISENESS REQUIRED — paraphrase all items, never copy verbatim text:
  - Task text: 10–80 characters, starts with an action verb (e.g. "Draft MTS validation protocol")
  - Milestone name: 10–60 characters, a concrete deliverable (e.g. "MTS UAT sign-off complete")
  - Journal text: 1–2 sentences max
  - Project name: ≤40 characters

Classify each item as:
PROJECT — Multi-week initiative with phases and a strategic deliverable. NOT a project: anything completable in 1–2 days.
MILESTONE — A concrete deliverable or checkpoint within a project. Be generous with milestones — link to existing or plausible new projects.
TASK — Single discrete action, completable in hours to one day. Starts with a verb.
JOURNAL — Decision, risk, blocker, or important context worth remembering. Keep to 1–2 sentences.
SKIP — Other people's responsibilities, admin trivia, or anything redundant with a task/milestone.

Existing projects:
${projectList}

Return ONLY valid JSON with no markdown fencing:
{
  "projects":   [{"name":"≤40 chars","description":"≤80 chars","targetDate":"YYYY-MM-DD or null","confidence":0.9,"sourceHint":"≤12-word quote"}],
  "milestones": [{"name":"≤60 chars","projectRef":"existing project id OR new project name OR null","target":"YYYY-MM-DD or null","confidence":0.8,"sourceHint":"≤12-word quote"}],
  "tasks":      [{"text":"≤80 chars, starts with verb","projectRef":"existing project id OR new project name OR null","confidence":0.9,"sourceHint":"≤12-word quote"}],
  "journal":    [{"text":"1-2 sentences","type":"decision|risk|action|note|meeting","date":"YYYY-MM-DD","confidence":0.9}]
}
If a milestone's projectRef names a project not in the existing list, include that project in "projects" too.`;

    const mem = getMemory();
    const userContent = [];
    if (mem) {
      userContent.push({ type: "text", text: `Project context and memory:\n\n${mem}`, cache_control: { type: "ephemeral" } });
    }
    userContent.push(
      { type: "text", text: systemText + "\n\nContent to analyze:\n\n" + textParts.join("\n\n") },
      ...imageBlocks,
    );

    const apiKey = getAIToken();
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ authToken: apiKey, baseURL: AI_BASE_URL_CONST });
    const message = await client.messages.create({
      model: AI_MODEL_CONST, max_tokens: 4096,
      messages: [{ role: "user", content: userContent }],
    });

    let raw = message.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    let suggestions;
    try { suggestions = JSON.parse(raw); }
    catch(e) { return res.status(500).json({ error: "Claude returned unparseable JSON", raw: raw.slice(0,300) }); }

    suggestions.projects   = suggestions.projects   || [];
    suggestions.milestones = suggestions.milestones || [];
    suggestions.tasks      = suggestions.tasks      || [];
    suggestions.journal    = suggestions.journal    || [];

    // Auto-promote orphaned milestone projectRefs into project suggestions
    const knownNames = new Set([
      ...existing.map(p => p.name.toLowerCase()),
      ...suggestions.projects.map(p => p.name.toLowerCase()),
    ]);
    suggestions.milestones.forEach(m => {
      if (m.projectRef && !existing.find(p => p.id === m.projectRef)) {
        const lower = m.projectRef.toLowerCase();
        if (!knownNames.has(lower)) {
          suggestions.projects.push({ name: m.projectRef, description: "", targetDate: null, confidence: 0.7, sourceHint: m.sourceHint || "" });
          knownNames.add(lower);
        }
      }
    });

    [...suggestions.projects, ...suggestions.milestones, ...suggestions.tasks, ...suggestions.journal]
      .forEach(item => { item._uid = uid(); });

    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(_) {} });
    res.json({ ok: true, suggestions, fileCount: (req.files||[]).length + (pasteText ? 1 : 0) });
  } catch(e) {
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(_) {} });
    console.error("Scan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Scan a single existing note by ID
app.post("/api/scan/note/:id", async (req, res) => {
  try {
    const { notes } = readJSON(NOTES_FILE, { notes: [] });
    const note = (notes || []).find(n => n.id === req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    let text = "";
    const htmlFile = path.join(NOTES_HTML_DIR, note.id + ".html");
    if (note.richContent && fs.existsSync(htmlFile)) {
      const $ = require("cheerio").load(fs.readFileSync(htmlFile, "utf8"), { decodeEntities: true });
      text = $.text().replace(/\s+/g, " ").trim().slice(0, 12000);
    } else {
      text = (note.content || "").trim().slice(0, 12000);
    }
    if (!text) return res.status(400).json({ error: "Note has no text content to scan" });

    const cfg = getConfig();
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    const existing = state.projects.map(p => ({ id: p.id, name: p.name, shortName: p.shortName }));
    const projectList = existing.length
      ? existing.map(p => `  {id:"${p.id}", name:"${p.name}", shortName:"${p.shortName}"}`).join("\n")
      : "  (none yet)";

    const systemText = `You are helping ${cfg.name || "a professional"}${cfg.team ? " (" + cfg.team + ")" : ""}${cfg.org ? " at " + cfg.org : ""} manage their workload.

Analyze the content and extract actionable work items. Follow these rules strictly:

QUALITY OVER QUANTITY: Extract only the most important, distinct items. Aim for 3–8 tasks, 2–5 milestones, and 2–5 journal entries. Never extract every sentence.

CONCISENESS REQUIRED — paraphrase all items, never copy verbatim text:
  - Task text: 10–80 characters, starts with an action verb
  - Milestone name: 10–60 characters, a concrete deliverable
  - Journal text: 1–2 sentences max
  - Project name: ≤40 characters

Classify each item as:
PROJECT — Multi-week initiative with phases and a strategic deliverable.
MILESTONE — A concrete deliverable or checkpoint within a project.
TASK — Single discrete action, completable in hours to one day. Starts with a verb.
JOURNAL — Decision, risk, blocker, or important context worth remembering.
SKIP — Other people's responsibilities, admin trivia, or redundant items.

Existing projects:
${projectList}

Return ONLY valid JSON with no markdown fencing:
{
  "projects":   [{"name":"≤40 chars","description":"≤80 chars","targetDate":"YYYY-MM-DD or null","confidence":0.9,"sourceHint":"≤12-word quote"}],
  "milestones": [{"name":"≤60 chars","projectRef":"existing project id OR new project name OR null","target":"YYYY-MM-DD or null","confidence":0.8,"sourceHint":"≤12-word quote"}],
  "tasks":      [{"text":"≤80 chars, starts with verb","projectRef":"existing project id OR new project name OR null","confidence":0.9,"sourceHint":"≤12-word quote"}],
  "journal":    [{"text":"1-2 sentences","type":"decision|risk|action|note|meeting","date":"YYYY-MM-DD","confidence":0.9}]
}
If a milestone's projectRef names a project not in the existing list, include that project in "projects" too.`;

    const mem = getMemory();
    const userContent = [];
    if (mem) userContent.push({ type: "text", text: `Project context and memory:\n\n${mem}`, cache_control: { type: "ephemeral" } });
    userContent.push({ type: "text", text: systemText + "\n\nNote: " + (note.title || "Untitled") + "\n\n" + text });

    const apiKey = getAIToken();
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ authToken: apiKey, baseURL: AI_BASE_URL_CONST });
    const message = await client.messages.create({
      model: AI_MODEL_CONST, max_tokens: 4096,
      messages: [{ role: "user", content: userContent }],
    });

    let raw = message.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    let suggestions;
    try { suggestions = JSON.parse(raw); }
    catch(e) { return res.status(500).json({ error: "Claude returned unparseable JSON", raw: raw.slice(0,300) }); }

    suggestions.projects   = suggestions.projects   || [];
    suggestions.milestones = suggestions.milestones || [];
    suggestions.tasks      = suggestions.tasks      || [];
    suggestions.journal    = suggestions.journal    || [];

    const knownNames = new Set([
      ...existing.map(p => p.name.toLowerCase()),
      ...suggestions.projects.map(p => p.name.toLowerCase()),
    ]);
    suggestions.milestones.forEach(m => {
      if (m.projectRef && !existing.find(p => p.id === m.projectRef)) {
        const lower = m.projectRef.toLowerCase();
        if (!knownNames.has(lower)) {
          suggestions.projects.push({ name: m.projectRef, description: "", targetDate: null, confidence: 0.7, sourceHint: "" });
          knownNames.add(lower);
        }
      }
    });

    [...suggestions.projects, ...suggestions.milestones, ...suggestions.tasks, ...suggestions.journal]
      .forEach(item => { item._uid = uid(); });

    res.json({ ok: true, suggestions, noteTitle: note.title || "Note" });
  } catch(e) {
    console.error("Scan note error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/scan/apply", (req, res) => {
  try {
    const { projects = [], milestones = [], tasks = [], journal = [] } = req.body;
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    if (!state.tasks) state.tasks = [];
    if (!state.journal) state.journal = [];

    const newProjMap = {};
    for (const p of projects) {
      const id = uid();
      newProjMap[p.name.toLowerCase()] = id;
      const shortName = p.name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 4) || "PROJ";
      state.projects.push({ id, name: p.name, shortName, color: "#0F3A85", owner: "", sponsor: "",
        targetDate: p.targetDate || null, archived: false, description: p.description || "",
        dependencies: [], risks: [], milestones: [], goalRefs: [] });
    }

    const resolveRef = ref => {
      if (!ref) return null;
      if (state.projects.find(p => p.id === ref)) return ref;
      const lower = ref.toLowerCase();
      return newProjMap[lower] || (state.projects.find(p => p.name.toLowerCase() === lower) || {}).id || null;
    };

    for (const m of milestones) {
      const proj = state.projects.find(p => p.id === resolveRef(m.projectRef));
      if (proj) proj.milestones.push({ id: uid(), name: m.name, target: m.target || null, status: "not-started", notes: "" });
    }

    for (const t of tasks) {
      state.tasks.unshift({ id: uid(), text: t.text, status: "open", created: today(), completed: null,
        notes: "", tags: [], project: resolveRef(t.projectRef), owner: "", bullets: [], links: [] });
    }

    for (const j of journal) {
      state.journal.unshift({ id: uid(), date: j.date || today(), text: j.text, project: "all", type: j.type || "note" });
    }

    saveState(state);
    res.json({ ok: true, added: { projects: projects.length, milestones: milestones.length, tasks: tasks.length, journal: journal.length } });
  } catch(e) {
    console.error("Scan apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ MEMORY ═══
app.get("/api/memory", (req, res) => {
  res.json({ ok: true, content: getMemory() });
});

app.put("/api/memory", (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== "string") return res.status(400).json({ error: "content required" });
    fs.writeFileSync(MEMORY_FILE, content, "utf8");
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/memory/refresh", async (req, res) => {
  try {
    const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
    const projectSummary = state.projects.filter(p => !p.archived).map(p => {
      const ms = (p.milestones || []).map(m => `  - [${m.status}] ${m.name}${m.target ? " (target: " + m.target + ")" : ""}`).join("\n");
      return `Project: ${p.name} (${p.shortName}) — ${p.description || "no description"}\n${ms}`;
    }).join("\n\n");
    const recentJournal = (state.journal || []).slice(0, 20).map(j => `[${j.date}] ${j.type}: ${j.text}`).join("\n");
    const openTasks = (state.tasks || []).filter(t => t.status === "open").slice(0, 30).map(t => `- ${t.text}`).join("\n");
    const existing = getMemory();

    const refreshPrompt = `You are maintaining a project memory file for ${(getConfig() || {}).name || "a professional"}.

Current state summary:

ACTIVE PROJECTS:
${projectSummary || "(none)"}

RECENT JOURNAL ENTRIES:
${recentJournal || "(none)"}

OPEN TASKS:
${openTasks || "(none)"}

EXISTING MEMORY FILE:
${existing || "(empty)"}

Rewrite the memory file to be a concise, accurate reference (max 800 words). Include:
- Key projects and their current status/phase
- Important decisions, risks, or blockers from recent journal entries
- Recurring themes or patterns in the work
- Context that would help an AI assistant give better suggestions in future sessions

Write in clear, factual prose. No markdown headers needed — plain paragraphs are fine.`;

    const apiKey = getAIToken();
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ authToken: apiKey, baseURL: AI_BASE_URL_CONST });
    const message = await client.messages.create({
      model: AI_MODEL_CONST, max_tokens: 1200,
      messages: [{ role: "user", content: refreshPrompt }],
    });
    const newMemory = message.content[0].text.trim();
    fs.writeFileSync(MEMORY_FILE, newMemory, "utf8");
    res.json({ ok: true, content: newMemory });
  } catch(e) {
    console.error("Memory refresh error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ DAILY BRIEFING ═══
let _briefingStatus = { status: "idle", startedAt: null, completedAt: null, error: null };

function getBriefingData() {
  if (!fs.existsSync(BRIEFING_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(BRIEFING_FILE, "utf8")); } catch(_) { return null; }
}

app.get("/api/briefing", (req, res) => {
  res.json({ ok: true, data: getBriefingData(), status: _briefingStatus });
});

function getResolved() {
  if (!fs.existsSync(RESOLVED_FILE)) return [];
  try {
    const all = JSON.parse(fs.readFileSync(RESOLVED_FILE, "utf8"));
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    return all.filter(r => new Date(r.resolvedAt) > cutoff);
  } catch(_) { return []; }
}
function saveResolved(list) {
  fs.writeFileSync(RESOLVED_FILE, JSON.stringify(list, null, 2));
}

app.get("/api/briefing/resolved", (req, res) => {
  res.json({ ok: true, resolved: getResolved() });
});

app.post("/api/briefing/resolve", (req, res) => {
  const { from_email, subject, source, reason } = req.body;
  if (!subject) return res.status(400).json({ error: "subject required" });
  const list = getResolved();
  const existing = list.findIndex(r => r.from_email === from_email && r.subject === subject);
  const entry = { resolvedAt: new Date().toISOString(), reason: reason || "complete", from_email: from_email || "", subject, source: source || "outlook" };
  if (existing >= 0) list[existing] = entry; else list.push(entry);
  saveResolved(list);
  res.json({ ok: true });
});

app.delete("/api/briefing/resolve", (req, res) => {
  const { from_email, subject } = req.body;
  const list = getResolved().filter(r => !(r.from_email === from_email && r.subject === subject));
  saveResolved(list);
  res.json({ ok: true });
});

app.post("/api/briefing/run", (req, res) => {
  if (_briefingStatus.status === "running") {
    return res.json({ ok: false, error: "Briefing scan already in progress" });
  }
  const outputPath = BRIEFING_FILE.replace(/\\/g, "/");
  const jsonShape = `{\n  "metadata": { "generated_at": "<ISO timestamp>", "scan_window": "<e.g. last 24 hours>", "total_scanned": 0, "total_action_items": 0 },\n  "summary": { "p1": 0, "p2": 0, "p3": 0, "p4": 0 },\n  "items": [\n    { "id": "1", "priority": "P1", "category": "Email", "from_name": "Jane Smith", "subject": "Approval needed", "action_required": "Review and approve by EOD", "deadline": "2026-04-27", "deep_link": null, "source": "outlook", "body_preview": "..." }\n  ]\n}`;

  // Embed the skill instructions directly so Claude doesn't need the skill registered
  let skillBody = null;
  const cfg = getConfig();
  const skillCandidates = [
    cfg.dailyBriefingSkillPath,
    path.join(__dirname, "electron", "skills", "daily-agenda.skill"), // bundled in exe
    path.join("C:", "Dev", "packages", "claude_skills", "development", "daily-agenda.skill"), // dev fallback
  ].filter(Boolean);
  const skillPath = skillCandidates.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
  try {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(skillPath);
    const allEntries = zip.getEntries();
    // Search by suffix so directory prefix doesn't matter
    const skillEntry = allEntries.find(e => e.entryName.replace(/\\/g, "/").endsWith("/SKILL.md") || e.entryName === "SKILL.md");
    if (skillEntry) skillBody = skillEntry.getData().toString("utf8");
    // Embed all reference files inline — SKILL.md tells Claude to "Read references/X.md"
    // but in subprocess mode those files aren't accessible; embed them directly
    const refEntries = allEntries.filter(e => e.entryName.endsWith(".md") && !e.entryName.endsWith("SKILL.md") && e.entryName.replace(/\\/g, "/").includes("references/"));
    for (const ref of refEntries) {
      skillBody += `\n\n--- ${ref.name} (reference file — use this instead of reading from disk) ---\n\n${ref.getData().toString("utf8")}`;
    }
  } catch (_) {}

  let prompt;
  const resolved = getResolved();
  const resolvedBlock = resolved.length
    ? `\n\nPREVIOUSLY RESOLVED ITEMS — do NOT include these in the output JSON unless a brand-new message on the same topic arrived after the resolved date:\n${resolved.map(r=>`- From: ${r.from_email} | Subject: "${r.subject}" | Resolved: ${r.resolvedAt.slice(0,10)} (${r.reason})`).join("\n")}`
    : "";
  const noM365Fallback = `CRITICAL FALLBACK — READ FIRST: Before doing anything else, check whether you have Microsoft 365 MCP tools available (Outlook mail access, Teams message access, or similar tools named "mail", "outlook", "teams", etc.). If you do NOT have these tools available:\n1. Write this exact JSON to: ${outputPath}\n   {"metadata":{"generated_at":"${new Date().toISOString()}","scan_window":"N/A","total_scanned":0,"total_action_items":0,"total_suppressed":0,"error":"Microsoft 365 MCP tools not available. Configure M365 MCP access to enable email and Teams scanning."},"summary":{"p1":0,"p2":0,"p3":0,"p4":0},"items":[]}\n2. Output only: "Briefing written to ${outputPath}. M365 tools not available — 0 items."\n3. DO NOT discuss alternatives. DO NOT suggest scripts or Graph API. DO NOT ask questions. Just write the file and stop.\n\nOnly if M365 tools ARE available: ignore this fallback and proceed with the skill instructions below.\n\n`;
  if (skillBody) {
    prompt = `${noM365Fallback}Execute the following daily briefing skill instructions exactly as written. Write ONLY a valid JSON object (no markdown fences, no explanation text) to this exact file path: ${outputPath}\n\nRequired JSON shape:\n${jsonShape}\n\nPriority definitions: P1=urgent/action needed today, P2=action needed this week, P3=soon, P4=low/FYI.${resolvedBlock}\n\n--- SKILL INSTRUCTIONS (all reference files are embedded at the bottom — use those instead of reading from disk) ---\n\n${skillBody}`;
  } else {
    prompt = `${noM365Fallback}Scan my Microsoft 365 inbox (Outlook) and Teams messages. Identify every item requiring my action. Assign each a priority: P1=urgent/today, P2=this week, P3=soon, P4=low. When done, write ONLY valid JSON (no markdown) to: ${outputPath}\n\nRequired shape:\n${jsonShape}${resolvedBlock}`;
  }

  const os = require("os");
  const tmpPrompt = path.join(os.tmpdir(), "briefing-prompt.txt");
  try { fs.writeFileSync(tmpPrompt, prompt, "utf8"); } catch(e) {
    return res.status(500).json({ error: "Could not write prompt file: " + e.message });
  }

  _briefingStatus = { status: "running", startedAt: new Date().toISOString(), completedAt: null, error: null };

  const { spawn } = require("child_process");
  const logFile = path.join(BRIEFING_DIR, "run.log");

  // Claude Code on Windows requires git-bash — spawn it directly
  const bashCandidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
    path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);
  const bashExe = bashCandidates.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });

  if (!bashExe) {
    try { fs.unlinkSync(tmpPrompt); } catch(_) {}
    _briefingStatus = { status: "error", startedAt: _briefingStatus.startedAt, completedAt: new Date().toISOString(),
      error: "Git Bash not found. Install Git for Windows (https://git-scm.com/downloads/win) or set the CLAUDE_CODE_GIT_BASH_PATH environment variable to your bash.exe path." };
    return res.json({ ok: true, status: "running" });
  }

  // Write prompt to file and pass path as $1 — avoids Windows 32767-char command-line limit
  // Claude reads from stdin (< "$1"), so the huge prompt never appears on the command line
  // HOME must be set so claude finds ~/.claude/settings.json and MCP config
  const logStream = fs.createWriteStream(logFile, { flags: "w" });
  let proc;
  try {
    proc = spawn(bashExe, ["-c", "claude --dangerously-skip-permissions < \"$1\"", "--", tmpPrompt], {
      windowsHide: true,
      env: { ...process.env, HOME: process.env.USERPROFILE || process.env.HOME || "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch(spawnErr) {
    logStream.end();
    try { fs.unlinkSync(tmpPrompt); } catch(_) {}
    _briefingStatus = { status: "error", startedAt: _briefingStatus.startedAt, completedAt: new Date().toISOString(), error: "Failed to start briefing process: " + spawnErr.message };
    return res.json({ ok: true, status: "error" });
  }
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  proc.on("exit", (code) => {
    logStream.end();
    try { fs.unlinkSync(tmpPrompt); } catch(_) {}
    if (getBriefingData()) {
      _briefingStatus = { status: "done", startedAt: _briefingStatus.startedAt, completedAt: new Date().toISOString(), error: null };
    } else {
      let logExcerpt = "";
      try { logExcerpt = fs.readFileSync(logFile, "utf8").slice(-800); } catch(_) {}
      _briefingStatus = { status: "error", startedAt: _briefingStatus.startedAt, completedAt: new Date().toISOString(), error: `Briefing exited (code ${code}) but no data file was written. Check the daily-agenda skill and M365 MCP auth.\n\nLog:\n${logExcerpt}` };
    }
  });
  proc.on("error", (e) => {
    logStream.end();
    try { fs.unlinkSync(tmpPrompt); } catch(_) {}
    _briefingStatus = { status: "error", startedAt: _briefingStatus.startedAt, completedAt: new Date().toISOString(), error: e.message };
  });

  res.json({ ok: true, status: "running" });
});

app.post("/api/briefing/reset", (req, res) => {
  _briefingStatus = { status: "idle", startedAt: null, completedAt: null, error: null };
  res.json({ ok: true });
});

app.get("/api/briefing/log", (req, res) => {
  const logFile = path.join(BRIEFING_DIR, "run.log");
  if (!fs.existsSync(logFile)) return res.json({ ok: true, log: "" });
  try { res.json({ ok: true, log: fs.readFileSync(logFile, "utf8") }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══ TASKS ═══
app.get("/api/tasks", (req, res) => {
  const state = readJSON(STATE_FILE, { tasks: [] });
  res.json(state.tasks || []);
});
app.post("/api/tasks", (req, res) => {
  const state = readJSON(STATE_FILE, { projects: [], journal: [], tasks: [] });
  if (!state.tasks) state.tasks = [];
  const task = { id: uid(), text: req.body.text, status: "open", created: today(), completed: null,
    notes: req.body.notes || "", tags: req.body.tags || [], project: req.body.project || null,
    owner: req.body.owner || "", bullets: req.body.bullets || [], links: req.body.links || [] };
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

// ═══ NOTES ═══
// List notes — metadata only, no large HTML blobs; content is fetched per-note via GET /api/notes/:id
app.get("/api/notes", (req, res) => {
  const data = readJSON(NOTES_FILE, { notes: [] });
  const list = (data.notes || []).map(({ contentHtml, ...rest }) => ({
    ...rest,
    richContent: !!rest.richContent || fs.existsSync(path.join(NOTES_HTML_DIR, rest.id + ".html")),
  }));
  res.json(list);
});
// Full note including HTML content (lazy-loaded on demand)
app.get("/api/notes/:id", (req, res) => {
  const data = readJSON(NOTES_FILE, { notes: [] });
  const note = (data.notes || []).find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: "Not found" });
  const htmlFile = path.join(NOTES_HTML_DIR, note.id + ".html");
  const result = { ...note };
  if (fs.existsSync(htmlFile)) { result.contentHtml = fs.readFileSync(htmlFile, "utf8"); result.richContent = true; }
  res.json({ ok: true, note: result });
});
app.post("/api/notes", (req, res) => {
  const data = readJSON(NOTES_FILE, { notes: [] });
  if (!data.notes) data.notes = [];
  const id = uid();
  const note = {
    id,
    title: req.body.title || "Untitled",
    notebook: req.body.notebook || "",
    section: req.body.section || "",
    content: req.body.content || "",
    tags: req.body.tags || [],
    links: req.body.links || [],
    goalRefs: req.body.goalRefs || [],
    projectRefs: req.body.projectRefs || [],
    pinned: false,
    created: today(),
    updated: today(),
  };
  const { richContentTempId, contentHtml } = req.body;
  if (richContentTempId) {
    const tmpFile = path.join(NOTES_HTML_DIR, richContentTempId + ".html");
    if (fs.existsSync(tmpFile)) { fs.renameSync(tmpFile, path.join(NOTES_HTML_DIR, id + ".html")); note.richContent = true; }
  } else if (contentHtml) {
    fs.writeFileSync(path.join(NOTES_HTML_DIR, id + ".html"), contentHtml, "utf8");
    note.richContent = true;
  }
  data.notes.push(note);
  writeJSON(NOTES_FILE, data);
  res.json({ ok: true, note });
});
app.patch("/api/notes/:id", (req, res) => {
  const data = readJSON(NOTES_FILE, { notes: [] });
  const note = (data.notes || []).find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: "Not found" });
  const { contentHtml, richContentTempId, ...fields } = req.body;
  Object.assign(note, fields);
  note.updated = today();
  const htmlFile = path.join(NOTES_HTML_DIR, note.id + ".html");
  if (richContentTempId) {
    const tmpFile = path.join(NOTES_HTML_DIR, richContentTempId + ".html");
    if (fs.existsSync(tmpFile)) { fs.renameSync(tmpFile, htmlFile); note.richContent = true; }
  } else if (contentHtml === null || contentHtml === "") {
    if (fs.existsSync(htmlFile)) fs.unlinkSync(htmlFile);
    note.richContent = false;
  } else if (typeof contentHtml === "string" && contentHtml) {
    fs.writeFileSync(htmlFile, contentHtml, "utf8"); note.richContent = true;
  }
  writeJSON(NOTES_FILE, data);
  res.json({ ok: true, note });
});
app.delete("/api/notes/:id", (req, res) => {
  const data = readJSON(NOTES_FILE, { notes: [] });
  data.notes = (data.notes || []).filter(n => n.id !== req.params.id);
  writeJSON(NOTES_FILE, data);
  const htmlFile = path.join(NOTES_HTML_DIR, req.params.id + ".html");
  if (fs.existsSync(htmlFile)) fs.unlinkSync(htmlFile);
  res.json({ ok: true });
});
function decodeQP(str) {
  str = str.replace(/=\r?\n/g, "");
  const bytes = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === "=" && i + 2 < str.length && /[0-9A-Fa-f]{2}/.test(str.substr(i + 1, 2))) {
      bytes.push(parseInt(str.substr(i + 1, 2), 16));
      i += 3;
    } else {
      bytes.push(str.charCodeAt(i) & 0xff);
      i++;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function stripHtmlMht(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, "\n\n").trim();
}

function parseMhtFile(filePath) {
  // Read as latin1 to preserve raw bytes before QP decoding
  const raw = fs.readFileSync(filePath, "latin1");
  const boundaryMatch = raw.match(/boundary="([^"]+)"/);
  if (!boundaryMatch) return [];
  const boundary = boundaryMatch[1];
  const parts = raw.split("--" + boundary);
  const results = [];
  for (const part of parts) {
    const ctMatch = part.match(/Content-Type:\s*([^\r\n;]+)/i);
    if (!ctMatch || !ctMatch[1].toLowerCase().includes("text/html")) continue;
    const encMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
    const enc = (encMatch ? encMatch[1].trim() : "").toLowerCase();
    const bodyStart = part.indexOf("\r\n\r\n");
    if (bodyStart === -1) continue;
    let html = part.slice(bodyStart + 4);
    if (enc === "quoted-printable") html = decodeQP(html);
    // Split into OneNote pages: each page is wrapped in a div with border-width:100%
    const blocks = html.split(/<div[^>]*border-width:100%[^>]*>/i);
    if (blocks.length <= 1) {
      const text = stripHtmlMht(html);
      if (text.length > 50) results.push({ filename: "OneNote.mht-page", text });
    } else {
      blocks.slice(1).forEach((block, idx) => {
        // Page title: first p with font-size:20pt
        const titleMatch = block.match(/font-size:20\.0pt[^>]*>([^<]+)<\/p>/i);
        const title = titleMatch ? titleMatch[1].trim() : "Page " + (idx + 1);
        // Date line: first p with color:#767676
        const dateMatch = block.match(/color:#767676[^>]*>([^<\r\n]{4,30})<\/p>/i);
        const date = dateMatch ? dateMatch[1].trim() : "";
        const text = stripHtmlMht(block);
        if (text.length > 50) {
          results.push({ filename: title + (date ? " (" + date + ")" : "") + ".mht-page", text });
        }
      });
    }
    break; // Only one HTML part in a typical OneNote MHT
  }
  return results;
}

app.post("/api/notes/extract", (req, res, next) => getUpload().array("files", 20)(req, res, next), async (req, res) => {
  const uploaded = req.files || [];
  if (!uploaded.length) return res.status(400).json({ error: "No files uploaded" });
  const results = [];
  try {
    for (const file of uploaded) {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = file.originalname;
      if (ext === ".txt") {
        results.push({ filename: name, text: fs.readFileSync(file.path, "utf8") });
      } else if (ext === ".docx") {
        const r = await require("mammoth").extractRawText({ path: file.path });
        results.push({ filename: name, text: r.value });
      } else if (ext === ".mht" || ext === ".mhtml") {
        const mhtPages = parseMhtFile(file.path);
        mhtPages.forEach(p => {
          // Save HTML to a temp file — client never needs to download the large base64 blob
          let tempId = null;
          if (p.html) {
            tempId = uid();
            fs.writeFileSync(path.join(NOTES_HTML_DIR, tempId + ".html"), p.html, "utf8");
          }
          results.push({ filename: p.filename, text: p.text, tempId, sourceFile: file.originalname });
        });
      } else if (ext === ".zip") {
        const AdmZip = require("adm-zip");
        const zip = new AdmZip(file.path);
        const entries = zip.getEntries();
        // Build image map: entryPath → data URL (by full path and by bare filename)
        const imgMap = {};
        entries.filter(e => !e.isDirectory && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(e.entryName))
          .forEach(e => {
            const m = e.entryName.match(/\.(\w+)$/i);
            const mime = m ? ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",bmp:"image/bmp",webp:"image/webp",svg:"image/svg+xml"}[m[1].toLowerCase()] || "image/"+m[1].toLowerCase()) : "image/png";
            const dataUrl = `data:${mime};base64,${e.getData().toString("base64")}`;
            imgMap[e.entryName.replace(/\\/g, "/")] = dataUrl;
            imgMap[e.entryName.split(/[/\\]/).pop()] = dataUrl;
          });
        // Process HTML files
        entries
          .filter(e => !e.isDirectory && /\.html?$/i.test(e.entryName))
          .sort((a, b) => a.entryName.localeCompare(b.entryName))
          .forEach(e => {
            const normalEntry = e.entryName.replace(/\\/g, "/");
            const parts = normalEntry.split("/");
            const rawName = parts[parts.length - 1];
            const folderParts = parts.slice(0, -1);
            // Skip files inside a _files asset directory
            if (folderParts.some(p => p.endsWith("_files"))) return;
            // Skip TOC / section-index files (they have a matching _files sibling folder)
            const lc = rawName.toLowerCase();
            if (/_toc\.html?$/.test(lc) || /^toc\.html?$/.test(lc)) return;
            const stem = rawName.replace(/\.html?$/i, "");
            const hasSiblingFilesDir = entries.some(se =>
              se.isDirectory && se.entryName.replace(/\\/g, "/").startsWith(folderParts.join("/") + (folderParts.length ? "/" : "") + stem + "_files/")
            );
            if (hasSiblingFilesDir) return;
            // Derive notebook / section from folder depth
            // parts[0] = notebook, parts[1..n-1] = section path (joined with " / ")
            const notebook = folderParts.length >= 1 ? folderParts[0].replace(/_files$/, "").trim() : "";
            const section  = folderParts.length >= 2 ? folderParts.slice(1).map(p => p.replace(/_files$/, "").trim()).join(" / ") : "";
            // Embed images — resolve relative src paths against the file's directory
            let html = e.getData().toString("utf8");
            const entryDir = folderParts.join("/");
            html = html.replace(/src="([^"]+)"/gi, (match, src) => {
              const decoded = decodeURIComponent(src.replace(/\+/g, " "));
              const fullPath = (entryDir ? entryDir + "/" : "") + decoded;
              const normalized = fullPath.split("/").reduce((acc, p) => { if (p === "..") acc.pop(); else if (p && p !== ".") acc.push(p); return acc; }, []).join("/");
              const fname = decoded.split("/").pop();
              const found = imgMap[normalized] || imgMap[fullPath] || imgMap[decoded] || imgMap[fname];
              return found ? `src="${found}"` : match;
            });
            const cleanHtml = cleanMhtPageHtml(html);
            const text = stripHtmlMht(html);
            if (text.length < 30) return;
            let tempId = null;
            if (cleanHtml) {
              tempId = uid();
              fs.writeFileSync(path.join(NOTES_HTML_DIR, tempId + ".html"), cleanHtml, "utf8");
            }
            results.push({ filename: stem + ".zip-page", text, tempId, notebook, section });
          });
      } else {
        results.push({ filename: name, text: `[Unsupported file type: ${ext}]` });
      }
      fs.unlink(file.path, () => {});
    }
    res.json({ ok: true, files: results });
  } catch (e) {
    uploaded.forEach(f => fs.unlink(f.path, () => {}));
    res.status(500).json({ error: e.message });
  }
});

function getHealth(p) {
  const b = p.milestones.filter(m => m.status === "blocked").length;
  const a = p.milestones.filter(m => m.status === "at-risk").length;
  const o = p.milestones.filter(m => { if (m.status === "complete" || !m.target) return false; return (new Date(m.target) - new Date()) / 864e5 < 0; }).length;
  const c = p.milestones.filter(m => m.status === "complete").length;
  if (b || o > 1) return "CRITICAL"; if (a || o === 1) return "AT RISK";
  if (c === p.milestones.length && p.milestones.length) return "COMPLETE"; return "ON TRACK";
}

const server = app.listen(PORT, () => {
  const url = "http://localhost:" + PORT;
  const cfg = getConfig();
  const title = cfg.name ? cfg.name + "'s Projects" : "My Projects";
  console.log("\n  " + title + " — " + url);
  console.log("  Data: " + DATA + "\n");
  if (!process.env.ELECTRON_APP) {
    const { exec } = require("child_process");
    exec(process.platform === "win32" ? "start " + url : process.platform === "darwin" ? "open " + url : "xdg-open " + url, () => {});
  }
});
server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.log("  Port " + PORT + " already in use — using existing server.\n");
  } else {
    throw err;
  }
});
