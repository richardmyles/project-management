// Upserts a completed milestone into the "My Projects (App)" self-tracking
// project (id "mypj") from a published GitHub release, so every release push
// automatically captures its context as a milestone.
//
// Usage: node scripts/sync-release-milestone.js v1.0.16
// (run this AFTER the release workflow's GitHub Actions build has finished
// and the release + its assets are confirmed present)
//
// Prefers the running app's own HTTP API (http://localhost:PORT) so the
// write goes through the live in-memory state and its own history/autosave
// machinery. Falls back to a direct state.json read-modify-write only when
// the app isn't running — writing to state.json while the app IS running
// gets silently reverted by its autosave loop within seconds.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PORT = process.env.PORT || 3201;
const API_BASE = `http://localhost:${PORT}`;
const PROJECT_ID = "mypj";
const REPO = "richardmyles/project-management";

// Only used in the file-fallback path. Matches Electron's app.getPath("userData").
const APP_NAME = require(path.join(__dirname, "..", "package.json")).name;
const ROOT = process.env.APP_DATA_PATH || path.join(process.env.APPDATA, APP_NAME);
const DATA = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA, "state.json");
const HISTORY_DIR = path.join(DATA, ".history");

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function extractBullets(body) {
  return body
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^[-*]\s+/.test(l))
    .map(l => l.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function firstLineSummary(body) {
  const line = body.split(/\r?\n/).map(l => l.trim()).find(l => l && !/^[-*#]/.test(l));
  if (!line) return "";
  const sentence = line.match(/^.*?[.!?](?=\s|$)/);
  return (sentence ? sentence[0] : line).slice(0, 120);
}

// Section headings like "## Fixes" or "## What's New in v1.1.0" describe the
// release body's shape, not its content — skip those and keep looking for a
// heading that actually says something (e.g. "### Rich-Text Notes Editor").
const GENERIC_HEADINGS = new Set([
  "fixes", "bug fixes", "changes", "what changed", "what's new",
  "under the hood", "improvements", "features",
]);

function extractHeading(body) {
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.trim().match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim().replace(/^v?\d+\.\d+\.\d+\s*[—-]\s*/i, "").trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+in\s+v?\d+\.\d+\.\d+.*$/, "").trim();
    if (GENERIC_HEADINGS.has(key)) continue;
    return text;
  }
  return null;
}

function extractBoldLead(body) {
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+\*\*(.+?)\*\*/);
    if (m) return m[1].replace(/\.$/, "");
  }
  return null;
}

function buildMilestone(release, tag) {
  const releaseDate = release.published_at.split("T")[0];
  const body = release.body || "";
  const bullets = extractBullets(body);
  const versionNum = tag.replace(/^v/, "");
  const releaseNameMeaningful = release.name && release.name !== tag && release.name !== versionNum ? release.name : null;
  const summary = extractHeading(body) || extractBoldLead(body) || firstLineSummary(body) || releaseNameMeaningful || "Release";
  const releaseUrl = release.html_url || `https://github.com/${REPO}/releases/tag/${tag}`;
  return {
    id: uid(),
    name: `${tag} — ${summary}`,
    target: releaseDate,
    status: "complete",
    notes: summary,
    owner: "",
    bullets,
    links: [{ label: "Release Notes", url: releaseUrl }],
  };
}

function upsert(milestones, milestone) {
  const releaseUrl = milestone.links[0].url;
  const idx = milestones.findIndex(m => m.links?.some(l => l.url === releaseUrl));
  if (idx >= 0) {
    milestones[idx] = { ...milestones[idx], ...milestone, id: milestones[idx].id };
    return { milestones, action: "Updated existing" };
  }
  milestones.push(milestone);
  return { milestones, action: "Added new" };
}

async function viaApi(milestone) {
  const stateRes = await fetch(`${API_BASE}/api/state`);
  if (!stateRes.ok) throw new Error(`GET /api/state failed: ${stateRes.status}`);
  const state = await stateRes.json();
  const project = state.projects.find(p => p.id === PROJECT_ID);
  if (!project) throw new Error(`Project "${PROJECT_ID}" not found in live state — has the self-tracker been seeded?`);

  const { milestones, action } = upsert([...project.milestones], milestone);
  const patchRes = await fetch(`${API_BASE}/api/project/${PROJECT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ milestones }),
  });
  if (!patchRes.ok) throw new Error(`PATCH /api/project/${PROJECT_ID} failed: ${patchRes.status}`);
  console.log(`${action} milestone for ${milestone.name.split(" — ")[0]} via live app API.`);
}

function viaFile(milestone) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const project = state.projects.find(p => p.id === PROJECT_ID);
  if (!project) {
    console.error(`Project "${PROJECT_ID}" not found in state.json — has the self-tracker been seeded?`);
    process.exit(1);
  }

  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  const next = files.length ? parseInt(files[files.length - 1]) + 1 : 1;
  fs.writeFileSync(path.join(HISTORY_DIR, String(next).padStart(6, "0") + ".json"), fs.readFileSync(STATE_FILE, "utf8"), "utf8");
  const MAX_HISTORY = 30;
  const all = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  while (all.length > MAX_HISTORY) fs.unlinkSync(path.join(HISTORY_DIR, all.shift()));

  const { milestones, action } = upsert(project.milestones, milestone);
  project.milestones = milestones;
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  console.log(`${action} milestone for ${milestone.name.split(" — ")[0]} directly in state.json (app was not running).`);
}

async function main() {
  const tag = process.argv[2];
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    console.error("Usage: node scripts/sync-release-milestone.js vX.Y.Z");
    process.exit(1);
  }

  let release;
  try {
    const raw = execFileSync("gh", ["api", `repos/${REPO}/releases/tags/${tag}`], { encoding: "utf8" });
    release = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not fetch release ${tag} from ${REPO} — has it finished publishing?`);
    console.error(err.message);
    process.exit(1);
  }

  const milestone = buildMilestone(release, tag);

  try {
    await viaApi(milestone);
  } catch (apiErr) {
    console.log(`Live app API unreachable (${apiErr.message}) — falling back to direct state.json write.`);
    viaFile(milestone);
  }
}

main();
