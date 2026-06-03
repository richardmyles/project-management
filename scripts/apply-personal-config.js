#!/usr/bin/env node
/**
 * apply-personal-config.js
 *
 * Patches the public GitHub source files with Richard's personal overrides.
 * Run automatically via the post-merge git hook, or manually: node scripts/apply-personal-config.js
 *
 * What this does:
 *   server.js        — prepends dotenv.config() if missing
 *   electron/main.js — port from env, dev data root, app-builder-lib tray icon, personal branding
 *   public/index.html — UI placeholder text, SSO label, pharma AI prompt
 *   package.json     — personal name/description/author/appId, adds dotenv dep, removes electron-updater
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let errors = 0;
let patches = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, "utf8");
}

function patch(rel, description, fn) {
  const original = read(rel);
  const patched = fn(original);
  if (patched === original) {
    console.log(`  ✓ ${rel} — ${description} (already applied)`);
    return;
  }
  if (patched === null) {
    console.error(`  ✗ ${rel} — ${description} FAILED (pattern not found)`);
    errors++;
    return;
  }
  write(rel, patched);
  console.log(`  ✓ ${rel} — ${description}`);
  patches++;
}

function replace(content, from, to) {
  if (content.includes(to)) return content;  // already patched
  if (!content.includes(from)) return null;  // pattern not found — upstream may have changed
  return content.replace(from, to);
}

console.log("\n=== Applying personal config overrides ===\n");

// ─── server.js ─────────────────────────────────────────────────────────────

patch("server.js", "prepend dotenv.config()", content => {
  if (content.startsWith('require("dotenv").config();')) return content;
  const marker = 'const express = require("express");';
  return replace(content, marker, `require("dotenv").config();\n${marker}`);
});

// ─── electron/main.js ──────────────────────────────────────────────────────

patch("electron/main.js", "port from env", content =>
  replace(content, "const PORT = 3201;", "const PORT = process.env.PORT || 3200;")
);

patch("electron/main.js", "dev data root uses project dir", content =>
  replace(
    content,
    `    // Use userData for distributable — portable exe extracts to a temp dir
    const dataRoot = app.getPath("userData");`,
    `    // In dev (npm run electron), use the project directory so data/ is the live folder.
    // In packaged builds, use userData so data survives app updates.
    const dataRoot = app.isPackaged
      ? app.getPath("userData")
      : path.join(__dirname, "..");`
  )
);

patch("electron/main.js", "tray icon from app-builder-lib", content => {
  const from = `function createTray() {
  const iconPath = path.join(__dirname, "icon.ico");
  console.log(\`[icon] trying tray icon: \${iconPath}\`);
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  if (icon.isEmpty()) console.warn("[icon] tray icon is empty - check icon.ico");
  else console.log("[icon] tray icon loaded OK");
  tray = new Tray(icon);`;
  const to = `function createTray() {
  const iconPath = path.join(
    __dirname, "..", "node_modules", "app-builder-lib",
    "templates", "icons", "electron-linux", "32x32.png"
  );
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);`;
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

  // Ensure dotenv is a dependency
  pkg.dependencies = pkg.dependencies || {};
  if (!pkg.dependencies.dotenv) pkg.dependencies.dotenv = "^16.4.5";

  // Remove electron-updater (not needed in personal copy)
  delete pkg.dependencies["electron-updater"];

  // Personal electron-builder branding
  if (pkg.build) {
    pkg.build.appId = "com.richards.projects";
    pkg.build.productName = "Richard's Projects";
    delete pkg.build.publish;
    if (pkg.build.nsis) pkg.build.nsis.shortcutName = "Richard's Projects";
    if (pkg.build.portable) pkg.build.portable.artifactName = "RichardsProjects-portable.exe";
  }

  const patched = JSON.stringify(pkg, null, 2) + "\n";
  return patched === content ? content : patched;
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log();
if (errors > 0) {
  console.error(`Done with ${errors} error(s). Some patches did not apply — the public source may have changed.`);
  console.error("Check the patterns above and update this script if needed.");
  process.exit(1);
} else {
  console.log(`Done. ${patches} patch(es) applied.\n`);
}
