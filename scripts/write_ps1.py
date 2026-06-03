import os

path = r'C:\Users\L075876\OneDrive - Eli Lilly and Company\Documents\richards-projects\scripts\export-onenote.ps1'

script = r"""param(
    [string]$OutputFolder = (Join-Path $env:USERPROFILE "Desktop\OneNote-Export"),
    [string]$Account      = "Richard @ Eli Lilly and Company",
    [switch]$DebugXml
)

Set-StrictMode -Version Latest

function Sanitize([string]$s) {
    $invalid = [System.IO.Path]::GetInvalidFileNameChars() -join ""
    $s = [regex]::Replace($s, "[" + [regex]::Escape($invalid) + "]", "-")
    return $s.Trim()
}

# Strip the one: namespace prefix so plain XPath works without a namespace manager
function Strip-NS([string]$xml) {
    $xml = $xml -replace 'xmlns[^=]*="[^"]*"', ''
    $xml = $xml -replace '<one:', '<'
    $xml = $xml -replace '</one:', '</'
    return $xml
}

$script:okCount   = 0
$script:failCount = 0
$script:skipCount = 0

function Export-Sections($node, [string]$nbName, $onenote, [string]$OutputFolder) {
    foreach ($section in $node.SelectNodes("Section")) {
        $secName = $section.GetAttribute("name")
        $secId   = $section.GetAttribute("ID")
        $locked  = $section.GetAttribute("locked")
        if ($locked -eq "true") {
            Write-Host "    SKIP (locked): $secName" -ForegroundColor DarkYellow
            $script:skipCount++
            continue
        }
        $fileName = "$(Sanitize $nbName) - $(Sanitize $secName).mht"
        $filePath = Join-Path $OutputFolder $fileName
        Write-Host "    $fileName" -ForegroundColor Gray -NoNewline
        try {
            $onenote.Publish($secId, $filePath, 2, "")
            Write-Host "  OK" -ForegroundColor Green
            $script:okCount++
        } catch {
            Write-Host "  FAILED: $_" -ForegroundColor Red
            $script:failCount++
        }
    }
    foreach ($sg in $node.SelectNodes("SectionGroup")) {
        if ($sg.GetAttribute("name") -eq "OneNote_RecycleBin") { continue }
        Export-Sections $sg $nbName $onenote $OutputFolder
    }
}

if (!(Test-Path $OutputFolder)) { New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null }

Write-Host ""
Write-Host "  OneNote Bulk MHT Export" -ForegroundColor Cyan
Write-Host "  Account : $Account" -ForegroundColor Gray
Write-Host "  Output  : $OutputFolder" -ForegroundColor Gray
Write-Host ""
Write-Host "  Connecting to OneNote..." -ForegroundColor Cyan

try {
    $onenote = New-Object -ComObject OneNote.Application
} catch {
    Write-Host "  ERROR: Could not connect to OneNote." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Get top-level notebook hierarchy
[string]$rawXml = ""
$onenote.GetHierarchy("", 3, [ref]$rawXml)
if ($DebugXml) { $rawXml | Out-File (Join-Path $OutputFolder "debug-root.xml") -Encoding utf8; Write-Host "  Saved debug-root.xml" -ForegroundColor Magenta }

$nbDoc      = [xml](Strip-NS $rawXml)
$allNbNodes = @($nbDoc.SelectNodes("//Notebook"))
$targetNbs  = [System.Collections.ArrayList]@()

if ($Account -ne "") {
    $container = $allNbNodes | Where-Object { $_.GetAttribute("name") -eq $Account } | Select-Object -First 1

    if ($container) {
        $cid = $container.GetAttribute("ID")
        # Use hsChildren (2) to get individual notebooks inside the account
        [string]$childRaw = ""
        $onenote.GetHierarchy($cid, 2, [ref]$childRaw)
        if ($DebugXml) { $childRaw | Out-File (Join-Path $OutputFolder "debug-children.xml") -Encoding utf8; Write-Host "  Saved debug-children.xml" -ForegroundColor Magenta }

        $childDoc = [xml](Strip-NS $childRaw)
        $childNbs = @($childDoc.SelectNodes("//Notebook") | Where-Object { $_.GetAttribute("name") -ne $Account })

        if ($childNbs.Count -gt 0) {
            Write-Host "  Found $($childNbs.Count) notebooks under account." -ForegroundColor Gray
            foreach ($cn in $childNbs) {
                [void]$targetNbs.Add([pscustomobject]@{ Name=$cn.GetAttribute("name"); Id=$cn.GetAttribute("ID") })
            }
        } else {
            Write-Host "  No child notebooks found - exporting account sections directly." -ForegroundColor Yellow
            [void]$targetNbs.Add([pscustomobject]@{ Name=$Account; Id=$cid })
        }
    } else {
        Write-Host "  Account container not found - exporting all notebooks." -ForegroundColor Yellow
        $allNbNodes | Where-Object { $_.SelectNodes("Notebook").Count -eq 0 } | ForEach-Object {
            [void]$targetNbs.Add([pscustomobject]@{ Name=$_.GetAttribute("name"); Id=$_.GetAttribute("ID") })
        }
    }
} else {
    $allNbNodes | Where-Object { $_.SelectNodes("Notebook").Count -eq 0 } | ForEach-Object {
        [void]$targetNbs.Add([pscustomobject]@{ Name=$_.GetAttribute("name"); Id=$_.GetAttribute("ID") })
    }
}

if ($targetNbs.Count -eq 0) {
    Write-Host "  No notebooks found." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 0
}

Write-Host "  $($targetNbs.Count) notebook(s) queued." -ForegroundColor Cyan
Write-Host "  Large sections may take 10-30 seconds each." -ForegroundColor DarkGray
Write-Host ""

foreach ($nb in $targetNbs) {
    Write-Host "  Notebook: $($nb.Name)" -ForegroundColor Yellow
    [string]$secRaw = ""
    try {
        $onenote.GetHierarchy($nb.Id, 4, [ref]$secRaw)
    } catch {
        Write-Host "    ERROR: $_" -ForegroundColor Red; Write-Host ""; continue
    }
    if ($DebugXml) { $secRaw | Out-File (Join-Path $OutputFolder "debug-$(Sanitize $nb.Name).xml") -Encoding utf8 }

    $secDoc   = [xml](Strip-NS $secRaw)
    $rootNode = $secDoc.SelectNodes("//Notebook") | Select-Object -First 1
    if (!$rootNode) {
        $rootNode = $secDoc.SelectNodes("//SectionGroup") |
            Where-Object { $_.GetAttribute("name") -ne "OneNote_RecycleBin" } | Select-Object -First 1
    }
    if ($rootNode) {
        Export-Sections $rootNode $nb.Name $onenote $OutputFolder
    } else {
        Write-Host "    (no sections found)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

Write-Host "  -----------------------------------" -ForegroundColor DarkGray
Write-Host "  Exported : $script:okCount" -ForegroundColor Green
if ($script:skipCount -gt 0) { Write-Host "  Skipped  : $script:skipCount (locked)" -ForegroundColor Yellow }
if ($script:failCount -gt 0) { Write-Host "  Failed   : $script:failCount" -ForegroundColor Red }
Write-Host ""
Write-Host "  Files saved to: $OutputFolder" -ForegroundColor Cyan
Write-Host "  Next: drag all files into the Import Notes view." -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
"""

with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(script)

data = open(path, 'rb').read()
bad = [b for b in data if b > 127]
print(f"Written. Size: {len(data)} bytes. Non-ASCII: {len(bad)}. First bytes: {data[:6].hex()}")
