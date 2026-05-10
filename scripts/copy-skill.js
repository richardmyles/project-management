const fs = require("fs");
const path = require("path");

const src = path.join("C:", "Dev", "packages", "claude_skills", "development", "daily-agenda.skill");
const destDir = path.join(__dirname, "..", "electron", "skills");
const dest = path.join(destDir, "daily-agenda.skill");

fs.mkdirSync(destDir, { recursive: true });

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  const size = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  Skill bundled: electron/skills/daily-agenda.skill (${size} KB)`);
} else if (fs.existsSync(dest)) {
  console.log(`  Skill already present (source not found at ${src} — using existing copy)`);
} else {
  console.warn(`  WARNING: daily-agenda.skill not found at ${src} and no existing copy. Briefing feature will use fallback prompt.`);
}
