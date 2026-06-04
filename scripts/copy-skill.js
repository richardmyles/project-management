const fs = require("fs");
const path = require("path");

// Source path for the daily-agenda skill file.
// Set DAILY_AGENDA_SKILL_PATH env var to point to your local copy, or place the
// file at electron/skills/daily-agenda.skill manually before building.
const src = process.env.DAILY_AGENDA_SKILL_PATH || "";
const destDir = path.join(__dirname, "..", "electron", "skills");
const dest = path.join(destDir, "daily-agenda.skill");

fs.mkdirSync(destDir, { recursive: true });

if (src && fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  const size = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  Skill bundled: electron/skills/daily-agenda.skill (${size} KB)`);
} else if (fs.existsSync(dest)) {
  console.log(`  Skill already present (DAILY_AGENDA_SKILL_PATH not set — using existing copy)`);
} else {
  console.warn(`  WARNING: daily-agenda.skill not found. Set DAILY_AGENDA_SKILL_PATH or place the file at electron/skills/daily-agenda.skill. Briefing feature will use fallback prompt.`);
}
