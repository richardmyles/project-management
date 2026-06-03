#!/usr/bin/env node
/**
 * Import goals into the Command Post.
 *
 * Usage:
 *   node scripts/import-goals.js <goals.json> [--year 2026]
 *
 * The JSON file should have the structure:
 * {
 *   "year": 2026,
 *   "goals": [
 *     {
 *       "id": "unique-id",
 *       "category": "Deliver Results – Safety",
 *       "text": "Goal description",
 *       "subItems": ["sub-item 1", "sub-item 2"]
 *     }
 *   ]
 * }
 *
 * For .docx goal files, use Claude Code to parse the document into this
 * JSON format first. Goals docs are not structured identically every time,
 * so Claude Code's judgment is better than rigid parsing.
 *
 * This script performs a NON-DESTRUCTIVE merge:
 * - New goals are added
 * - Existing goals get text updated but preserve status & quarterly notes
 * - Removed goals are flagged "discontinued", never deleted
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const args = process.argv.slice(2);
if (!args.length || args[0] === "--help") {
  console.log(`
  Usage: node scripts/import-goals.js <goals.json> [--year YYYY]

  Imports goals into the Command Post via the API.
  The server must be running (npm start).

  Options:
    --year YYYY    Override the year (default: read from file or current year)
    --dry-run      Show what would change without writing
  `);
  process.exit(0);
}

const filePath = args[0];
const yearFlag = args.indexOf("--year") >= 0 ? parseInt(args[args.indexOf("--year") + 1]) : null;
const dryRun = args.includes("--dry-run");

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (e) {
  console.error(`Failed to parse JSON: ${e.message}`);
  process.exit(1);
}

const year = yearFlag || data.year || new Date().getFullYear();
const goals = data.goals || [];

if (!goals.length) {
  console.error("No goals found in file.");
  process.exit(1);
}

console.log(`\nImporting ${goals.length} goals for year ${year}...`);
goals.forEach((g, i) => {
  console.log(`  ${i + 1}. [${g.category || "Uncategorized"}] ${g.text?.slice(0, 80)}...`);
});

if (dryRun) {
  console.log("\n--dry-run: No changes written.");
  process.exit(0);
}

// POST to API
const payload = JSON.stringify({ year, goals, sourceFile: path.basename(filePath) });
const req = http.request({
  hostname: "localhost",
  port: 3200,
  path: "/api/goals/import",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
}, res => {
  let body = "";
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    try {
      const result = JSON.parse(body);
      if (result.ok) {
        console.log(`\n✓ ${result.merged ? "Merged" : "Created"} — ${result.goalCount} goals total.`);
      } else {
        console.error("\nAPI error:", body);
      }
    } catch (e) {
      console.error("\nFailed to parse response:", body);
    }
  });
});

req.on("error", e => {
  console.error(`\nConnection failed — is the server running? (npm start)\n  ${e.message}`);
  process.exit(1);
});

req.write(payload);
req.end();
