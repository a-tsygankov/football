#requires -Version 5.1
<#
.SYNOPSIS
  Log into the right Cloudflare account, discover the IDs this repo needs, and
  set the GitHub Actions + Worker secrets that deploys depend on.

.DESCRIPTION
  Written after a production outage where `wrangler d1 migrations apply` failed
  with "[code: 7403] The given account is not valid or is not authorized to
  access this service". Two separate causes wear that same error:

    * CLOUDFLARE_ACCOUNT_ID naming an account that does not own the database
    * an API token carrying Workers permissions but not D1

  Deploying a Worker needs neither of those to be right, so a half-configured
  setup passes every other step and only dies at the migration. This script
  therefore *verifies* rather than assumes: before storing an API token it runs
  the exact D1 query call that migrations use, against the exact database id
  from wrangler.toml.

  It also clears CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from its own
  process first. An inherited token silently overrides `wrangler login`, which
  is what made a correct interactive login keep failing.

.PARAMETER Login
  Force a fresh `wrangler logout` + `wrangler login`. Use when the current
  session is on the wrong Cloudflare account.

.PARAMETER GitHub
  Set the GitHub Actions secrets (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).

.PARAMETER Cloudflare
  Set the Worker secrets (SESSION_SECRET, and optionally GEMINI_API_KEY and
  SQUAD_SYNC_ADMIN_SECRET).

.PARAMETER All
  Both of the above.

.PARAMETER DryRun
  Print what would happen; change nothing.

.PARAMETER Repo
  owner/name. Auto-detected from `git remote get-url origin` when omitted.

.EXAMPLE
  ./scripts/setup-secrets.ps1 -Login -All

.EXAMPLE
  ./scripts/setup-secrets.ps1 -GitHub -DryRun
#>
[CmdletBinding()]
param(
  [switch]$Login,
  [switch]$GitHub,
  [switch]$Cloudflare,
  [switch]$All,
  [switch]$DryRun,
  [string]$Repo,
  [string]$DatabaseName = 'fc26'
)

$ErrorActionPreference = 'Stop'

if ($All) { $GitHub = $true; $Cloudflare = $true }
if (-not $GitHub -and -not $Cloudflare -and -not $Login) {
  Write-Host 'Nothing selected. Use -All (or -GitHub / -Cloudflare / -Login).' -ForegroundColor Yellow
  Write-Host 'Run `Get-Help ./scripts/setup-secrets.ps1 -Detailed` for options.'
  exit 1
}

# Repo root regardless of where this was invoked from.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $RepoRoot 'worker'
$WranglerToml = Join-Path $WorkerDir 'wrangler.toml'

function Write-Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   !   $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "       $msg" -ForegroundColor DarkGray }

function Fail($msg) {
  Write-Host "`nFAILED: $msg" -ForegroundColor Red
  exit 1
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Reads a secret without echoing it and without it landing in history.
function Read-Secret($prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function New-RandomSecret {
  # 32 bytes of CSPRNG output, base64. Plenty for HMAC session signing.
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

# ── Preflight ────────────────────────────────────────────────────────────
Write-Step 'Checking prerequisites'
if (-not (Test-Command 'npx')) { Fail 'npx not found. Install Node.js 20+.' }
Write-Ok 'npx'

if ($GitHub) {
  if (-not (Test-Command 'gh')) {
    Fail 'GitHub CLI (gh) not found. Install from https://cli.github.com/ then run `gh auth login`.'
  }
  & gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'gh is installed but not authenticated. Run `gh auth login` first.' }
  Write-Ok 'gh (authenticated)'
}

if (-not $Repo) {
  if (-not (Test-Command 'git')) { Fail 'git not found and -Repo not supplied.' }
  $origin = (& git -C $RepoRoot remote get-url origin 2>$null)
  if ($origin -match 'github\.com[:/]([^/]+)/(.+?)(\.git)?$') {
    $Repo = "$($Matches[1])/$($Matches[2])"
  }
}
if ($GitHub -and -not $Repo) { Fail 'Could not detect the GitHub repo. Pass -Repo owner/name.' }
if ($Repo) { Write-Ok "repo: $Repo" }

# THE TRAP: an inherited API token silently outranks `wrangler login`, so a
# correct interactive login can keep hitting 7403. Clear both for this process
# only — the parent shell and any machine-level setting are left untouched.
foreach ($v in 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID') {
  if (Test-Path "env:$v") {
    Write-Warn2 "$v is set in this environment - ignoring it for this run."
    Write-Info  'It overrides `wrangler login`. If it is set machine-wide and wrong,'
    Write-Info  'clear it in System Properties > Environment Variables too.'
    Remove-Item "env:$v"
  }
}

# ── Cloudflare login ─────────────────────────────────────────────────────
if ($Login) {
  Write-Step 'Signing in to Cloudflare'
  Write-Info 'A browser will open. Pick the account that owns this project.'
  Write-Info 'If it reuses an existing session, sign out of Cloudflare first or use a private window.'
  if ($DryRun) {
    Write-Warn2 'DryRun: skipping logout/login.'
  } else {
    & npx wrangler logout 2>&1 | Out-Null
    & npx wrangler login
    if ($LASTEXITCODE -ne 0) { Fail 'wrangler login failed.' }
  }
}

Write-Step 'Identifying the Cloudflare account'
$whoami = (& npx wrangler whoami 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { Fail "wrangler whoami failed. Run this script with -Login.`n$whoami" }

# @(...) forces an array: with one account, Select-Object -Unique returns a
# bare string, and indexing a string yields a single character rather than the
# id.
$accountIds = @(
  [regex]::Matches($whoami, '\b[0-9a-f]{32}\b') |
    ForEach-Object { $_.Value } | Select-Object -Unique
)
if (-not $accountIds) { Fail "Could not read an account id from wrangler whoami.`n$whoami" }

if ($accountIds.Count -gt 1) {
  Write-Warn2 "This login can see $($accountIds.Count) accounts:"
  for ($i = 0; $i -lt $accountIds.Count; $i++) { Write-Host "     [$i] $($accountIds[$i])" }
  $pick = Read-Host 'Which one owns this project? (index)'
  $AccountId = $accountIds[[int]$pick]
} else {
  $AccountId = $accountIds[0]
}
Write-Ok "account: $AccountId"
$env:CLOUDFLARE_ACCOUNT_ID = $AccountId   # scope subsequent wrangler calls

# ── Discover the D1 database ─────────────────────────────────────────────
Write-Step "Locating D1 database '$DatabaseName'"
$DatabaseId = $null
$listRaw = (& npx wrangler d1 list --json 2>&1 | Out-String)
try {
  $list = $listRaw | ConvertFrom-Json
  $match = $list | Where-Object { $_.name -eq $DatabaseName }
  if ($match) { $DatabaseId = $match.uuid }
} catch {
  # Older wrangler builds print a table rather than JSON.
  if ($listRaw -match "$DatabaseName\D+([0-9a-f-]{36})") { $DatabaseId = $Matches[1] }
}

if (-not $DatabaseId) {
  Write-Warn2 "'$DatabaseName' is not visible to this account."
  Write-Info  'That usually means you are logged into the wrong Cloudflare account.'
  Write-Info  'Re-run with -Login and choose the account that owns production.'
  Fail 'Cannot continue without the database.'
}
Write-Ok "database: $DatabaseId"

# Cross-check against the committed binding. A mismatch means the Worker would
# bind one database while migrations target another.
if (Test-Path $WranglerToml) {
  $tomlText = Get-Content $WranglerToml -Raw
  if ($tomlText -match 'database_id\s*=\s*"([^"]+)"') {
    $declared = $Matches[1]
    if ($declared -ne $DatabaseId) {
      Write-Warn2 "wrangler.toml declares database_id = $declared"
      Write-Warn2 "but '$DatabaseName' in this account is $DatabaseId"
      Write-Info  'Fix wrangler.toml (or switch accounts) before deploying.'
    } else {
      Write-Ok 'wrangler.toml database_id matches'
    }
  }
}

# ── GitHub Actions secrets ───────────────────────────────────────────────
if ($GitHub) {
  Write-Step 'GitHub Actions secrets'
  Write-Info 'CI cannot use your OAuth login, so it needs an API token.'
  Write-Info 'Create one at: https://dash.cloudflare.com/profile/api-tokens'
  Write-Info 'Required permissions (all Account-scoped):'
  Write-Info '  * Workers Scripts : Edit'
  Write-Info '  * D1              : Edit        <-- the one that was missing'
  Write-Info '  * Account Settings: Read'
  Write-Info 'Scope it to the account above, not "All accounts".'

  $token = Read-Secret 'Paste the Cloudflare API token (input hidden)'
  if (-not $token) { Fail 'No token entered.' }

  # Verify before storing. This is the whole point of the script: a token that
  # can deploy Workers but not touch D1 looks fine until the migration step.
  Write-Info 'Verifying the token...'
  $headers = @{ Authorization = "Bearer $token" }

  try {
    $verify = Invoke-RestMethod -Method Get -Headers $headers `
      -Uri 'https://api.cloudflare.com/client/v4/user/tokens/verify'
    if (-not $verify.success) { Fail 'Cloudflare rejected the token.' }
    Write-Ok 'token is valid'
  } catch {
    Fail "Token verification failed: $($_.Exception.Message)"
  }

  # Exactly the call `wrangler d1 migrations apply` makes. SELECT 1 touches no
  # data but exercises the same account + D1 permission that failed in CI.
  try {
    $body = @{ sql = 'SELECT 1' } | ConvertTo-Json
    $probe = Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' `
      -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/d1/database/$DatabaseId/query" `
      -Body $body
    if (-not $probe.success) { Fail 'D1 query probe returned success=false.' }
    Write-Ok 'token can reach D1 (migrations will work)'
  } catch {
    Write-Warn2 'The token cannot query D1 - this is the 7403 that broke deploys.'
    Write-Info  'Add Account > D1 > Edit to the token and make sure it is scoped'
    Write-Info  "to account $AccountId, then re-run."
    Fail "D1 probe failed: $($_.Exception.Message)"
  }

  $secrets = @{
    'CLOUDFLARE_API_TOKEN'  = $token
    'CLOUDFLARE_ACCOUNT_ID' = $AccountId
  }
  foreach ($name in $secrets.Keys) {
    if ($DryRun) {
      Write-Warn2 "DryRun: would set GitHub secret $name"
    } else {
      # Piped on stdin so the value never appears in a command line.
      $secrets[$name] | & gh secret set $name --repo $Repo
      if ($LASTEXITCODE -ne 0) { Fail "Failed to set GitHub secret $name" }
      Write-Ok "set $name"
    }
  }

  Write-Info 'Optional: VITE_API_BASE is a repo *variable* (not a secret) used by the'
  Write-Info "web build. Set it with: gh variable set VITE_API_BASE --repo $Repo"
}

# ── Worker secrets ───────────────────────────────────────────────────────
if ($Cloudflare) {
  Write-Step 'Worker secrets'

  # SESSION_SECRET currently also exists as a plaintext [vars] entry in
  # wrangler.toml, which is committed to a public repo. A Worker secret of the
  # same name takes precedence, so setting one here is what makes session
  # signing actually secret. Remove the [vars] line afterwards so nobody
  # mistakes the placeholder for the real thing.
  Write-Info 'SESSION_SECRET signs room session cookies.'
  $useGenerated = Read-Host 'Generate a strong random SESSION_SECRET? [Y/n]'
  if ($useGenerated -match '^(n|no)$') {
    $sessionSecret = Read-Secret 'Paste SESSION_SECRET (input hidden)'
  } else {
    $sessionSecret = New-RandomSecret
    Write-Ok 'generated a 32-byte random secret'
  }

  $workerSecrets = @{ 'SESSION_SECRET' = $sessionSecret }

  $gemini = Read-Secret 'GEMINI_API_KEY for TV-photo analysis (blank to skip)'
  if ($gemini) { $workerSecrets['GEMINI_API_KEY'] = $gemini }

  $adminAns = Read-Host 'Generate SQUAD_SYNC_ADMIN_SECRET (guards the internal squad-sync route)? [y/N]'
  if ($adminAns -match '^(y|yes)$') {
    $workerSecrets['SQUAD_SYNC_ADMIN_SECRET'] = New-RandomSecret
    Write-Ok 'generated SQUAD_SYNC_ADMIN_SECRET'
  }

  # A Worker secret cannot share a name with a [vars] binding — Cloudflare
  # rejects it with "Binding name '<X>' already in use [code: 10053]" rather
  # than letting the secret win. Catch that here instead of failing mid-run
  # with a raw wrangler error, since the fix is a specific ordered sequence.
  $tomlVars = ''
  if (Test-Path $WranglerToml) { $tomlVars = Get-Content $WranglerToml -Raw }

  foreach ($name in @($workerSecrets.Keys)) {
    if ($tomlVars -match "(?m)^\s*$name\s*=") {
      Write-Warn2 "$name is still declared in wrangler.toml [vars] - skipping."
      Write-Info  'Cloudflare will not accept a secret whose name collides with a var.'
      Write-Info  'Remove the line, redeploy so the binding disappears, then set it:'
      Write-Info  "  1. delete `"$name`" from worker/wrangler.toml [vars]"
      Write-Info  '  2. cd worker; npx wrangler deploy'
      Write-Info  "  3. npx wrangler secret put $name"
      continue
    }

    if ($DryRun) {
      Write-Warn2 "DryRun: would set Worker secret $name"
      continue
    }
    Push-Location $WorkerDir
    try {
      $workerSecrets[$name] | & npx wrangler secret put $name
      if ($LASTEXITCODE -ne 0) { Fail "Failed to set Worker secret $name" }
      Write-Ok "set $name"
    } finally { Pop-Location }
  }

  if ($workerSecrets.ContainsKey('SESSION_SECRET')) {
    Write-Warn2 'Rotating SESSION_SECRET invalidates every existing room session.'
    Write-Info  'Everyone will have to rejoin their room once the new value is live.'
  }
}

# ── Summary ──────────────────────────────────────────────────────────────
Write-Step 'Done'
Write-Host "  Account : $AccountId"
Write-Host "  Database: $DatabaseId ($DatabaseName)"
if ($Repo) { Write-Host "  Repo    : $Repo" }
if ($DryRun) { Write-Warn2 'DryRun - nothing was changed.' }
Write-Host ''
Write-Host 'Next: re-run the deploy and confirm "Apply D1 migrations" succeeds.' -ForegroundColor Cyan
if ($Repo) {
  Write-Host "  gh workflow run 'Deploy FC26 TeamPicker' --repo $Repo" -ForegroundColor DarkGray
}
