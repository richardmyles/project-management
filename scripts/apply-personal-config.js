#!/usr/bin/env node
/**
 * apply-personal-config.js
 *
 * Patches the public GitHub source files with Richard's personal overrides.
 * Run automatically via the post-merge git hook, or manually: node scripts/apply-personal-config.js
 *
 * Design principle: critical runtime behaviour (PORT, data path) is driven by .env
 * variables, not by source patches. That way upstream changes to electron/main.js
 * or server.js can never silently break the personal copy — the env vars win
 * regardless of what strings surround them in the source.
 *
 * Remaining patches (branding, UI text, icon) are cosmetic and non-critical:
 * if they fail the app still runs correctly.
 *
 * What this does:
 *   .env             — validates required personal vars are present
 *   server.js        — prepends dotenv.config() if missing
 *   electron/main.js — tray icon, personal branding (PORT + data root now via .env)
 *   public/index.html — UI placeholder text, SSO label, pharma AI prompt
 *   package.json     — personal name/description/author/appId, adds dotenv dep, removes electron-updater
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let errors = 0;
let warnings = 0;
let patches = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, "utf8");
}

function patch(rel, description, fn, { critical = false } = {}) {
  const original = read(rel);
  const patched = fn(original);
  if (patched === original) {
    console.log(`  ✓ ${rel} — ${description} (already applied)`);
    return;
  }
  if (patched === null) {
    const tag = critical ? "✗ CRITICAL" : "⚠ WARN";
    const msg = `  ${tag}: ${rel} — ${description} FAILED (pattern not found — upstream may have changed)`;
    if (critical) { console.error(msg); errors++; }
    else           { console.warn(msg);  warnings++; }
    return;
  }
  write(rel, patched);
  console.log(`  ✓ ${rel} — ${description}`);
  patches++;
}

function replace(content, from, to) {
  if (content.includes(to)) return content;   // already patched
  if (!content.includes(from)) return null;   // pattern not found
  return content.replace(from, to);
}

console.log("\n=== Applying personal config overrides ===\n");

// ─── .env validation (critical) ────────────────────────────────────────────
// These vars control runtime behaviour. If missing the app will misbehave.

console.log("  Checking .env...");
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  console.error("  ✗ CRITICAL: .env not found — personal configuration missing!");
  console.error("    Create .env with: AI_BASE_URL, AI_TOKEN_CMD, AI_MODEL, PORT=3200, ELECTRON_DATA_ROOT=local");
  errors++;
} else {
  const envContent = fs.readFileSync(envPath, "utf8");
  const required = [
    ["ELECTRON_DATA_ROOT", "Controls where Electron reads/writes data. Must be 'local' for personal copy."],
    ["PORT",               "HTTP port for the Express server. Should be 3200 for personal copy."],
    ["AI_TOKEN_CMD",       "Corporate SSO token command for AI features."],
    ["AI_BASE_URL",        "Corporate AI gateway URL."],
  ];
  for (const [key, purpose] of required) {
    if (envContent.includes(`${key}=`)) {
      console.log(`  ✓ .env — ${key} is set`);
    } else {
      console.error(`  ✗ CRITICAL: .env — ${key} is missing (${purpose})`);
      errors++;
    }
  }
}

// ─── server.js (critical) ──────────────────────────────────────────────────

patch("server.js", "prepend dotenv.config()", content => {
  if (content.startsWith('require("dotenv").config();')) return content;
  const marker = 'const express = require("express");';
  return replace(content, marker, `require("dotenv").config();\n${marker}`);
}, { critical: true });

// ─── electron/main.js ──────────────────────────────────────────────────────
// PORT and ELECTRON_DATA_ROOT are handled by .env — no source patches needed.
// Remaining patches are cosmetic (branding, icon).

patch("electron/main.js", "tray icon from app-builder-lib", content => {
  if (content.includes("app-builder-lib") && content.includes("32x32.png")) return content;
  // Try the original upstream pattern
  const from = 'const iconPath = path.join(__dirname, "icon.ico");';
  const to = 'const iconPath = path.join(\n    __dirname, "..", "node_modules", "app-builder-lib",\n    "templates", "icons", "electron-linux", "32x32.png"\n  );';
  return replace(content, from, to);
});

patch("electron/main.js", "tray tooltip personal branding", content =>
  replace(content, 'tray.setToolTip("My Projects");', 'tray.setToolTip("Richard\'s Projects");')
);

patch("electron/main.js", "window title personal branding", content =>
  replace(content, '    title: "My Projects",', '    title: "Richard\'s Projects",')
);

patch("electron/main.js", "window icon from app-builder-lib", content =>
  replace(
    content,
    '    icon: path.join(__dirname, "icon.ico"),',
    '    icon: path.join(__dirname, "..", "node_modules", "app-builder-lib", "templates", "icons", "electron-linux", "256x256.png"),'
  )
);

// ─── public/index.html ─────────────────────────────────────────────────────

patch("public/index.html", "org alignment placeholder", content =>
  replace(
    content,
    'placeholder="e.g. Business Unit Build Out, Corporate Safety..."',
    'placeholder="e.g. Business Unit Build Out, Corporate Safety..."'
  )
);

patch("public/index.html", "corporate SSO label in settings", content =>
  replace(
    content,
    "✓ AI features enabled",
    "✓ AI connected via corporate SSO (your-cli-tool)"
  )
);

patch("public/index.html", "section placeholder", content =>
  replace(
    content,
    'placeholder="e.g. Work Projects"',
    'placeholder="e.g. Work Projects"'
  )
);

patch("public/index.html", "role placeholder", content =>
  replace(
    content,
    "inp('pe-role',pe.role,'e.g. Sr. Engineer, Product Team')",
    "inp('pe-role',pe.role,'e.g. Sr. Engineer, Product Team')"
  )
);

patch("public/index.html", "pharma AI risk prompt", content =>
  replace(
    content,
    "You are a project risk analyst reviewing a project portfolio.\\n\\n",
    "You are a project risk analyst reviewing a project portfolio for a pharma/manufacturing science team.\\n\\n"
  )
);

// ─── package.json ──────────────────────────────────────────────────────────

patch("package.json", "personal name/description/author/appId/branding", content => {
  let pkg;
  try { pkg = JSON.parse(content); } catch { return null; }

  pkg.name = "richards-projects";
  pkg.description = "Richard's Projects — Manufacturing Sciences project management, goals tracking, and progress reporting";
  pkg.author = "Richard — Manufacturing Sciences";

  pkg.dependencies = pkg.dependencies || {};
  if (!pkg.dependencies.dotenv) pkg.dependencies.dotenv = "^16.4.5";
  delete pkg.dependencies["electron-updater"];

  if (pkg.build) {
    pkg.build.appId = "com.richards.projects";
    pkg.build.productName = "Richard's Projects";
    delete pkg.build.publish;
    if (pkg.build.nsis) pkg.build.nsis.shortcutName = "Richard's Projects";
    if (pkg.build.portable) pkg.build.portable.artifactName = "RichardsProjects-portable.exe";
  }

  const patched = JSON.stringify(pkg, null, 2) + "\n";
  return patched === content ? content : patched;
}, { critical: true });

// ─── Summary ───────────────────────────────────────────────────────────────

console.log();
if (errors > 0) {
  console.error(`\n⛔  ${errors} CRITICAL error(s) — personal copy may be broken. Fix before running the app.`);
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n⚠  ${warnings} cosmetic patch(es) failed (branding/icons only — app will still work correctly).`);
  console.warn("   Update the patch patterns in this script if the upstream source changed.");
  process.exit(0);
} else {
  console.log(`✅  Done. ${patches} patch(es) applied.\n`);
}
