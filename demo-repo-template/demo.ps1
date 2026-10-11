<#
One command per demo step, for PowerShell (5.1 or 7):

  .\demo.ps1 up              launch your agent (Claude Code or Codex) connected to the server
  .\demo.ps1 up "<prompt>"   same, headless: run one prompt and exit (for rehearsals)
  .\demo.ps1 reset           put this clone AND the server back at the demo's starting state
  .\demo.ps1 status          who the server thinks you are, server health, is this clone clean

Everything comes from .env next to this script (copy .env.example): your token and the
server URLs. Nothing else to set, no config file to edit. Git Bash users: demo.sh.
#>
param(
  [Parameter(Position = 0)] [string] $Command = "",
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "demo: $msg" -ForegroundColor Red; exit 1 }

# --- load .env ---
if (-not (Test-Path .env)) { Fail "no .env here. Copy .env.example to .env and paste your token into it." }
Get-Content .env | ForEach-Object {
  $line = ($_ -split '#', 2)[0].Trim()
  if ($line -match '^([^=]+)=(.*)$') {
    $v = $matches[2].Trim()
    if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
    Set-Item -Path ("env:" + $matches[1].Trim()) -Value $v
  }
}
if (-not $env:TEAM_MCP_URL) { Fail "TEAM_MCP_URL missing from .env" }
if (-not $env:TEAM_EVENTS_URL) { Fail "TEAM_EVENTS_URL missing from .env" }
$Base = $env:TEAM_EVENTS_URL -replace '/events$', ''
$Token = if ($env:CLAUDE_TEAM_TOKEN) { $env:CLAUDE_TEAM_TOKEN } else { $env:CODEX_TEAM_TOKEN }
if (-not $Token) { Fail "no CLAUDE_TEAM_TOKEN or CODEX_TEAM_TOKEN in .env" }

function Api($Method, $Path, $Tok) {
  try {
    return Invoke-RestMethod -Method $Method -Uri "$Base$Path" -Headers @{ Authorization = "Bearer $Tok" } -ContentType "application/json" -TimeoutSec 15
  } catch { return $null }
}

switch ($Command) {
  "up" {
    $agent = ""
    if ($env:CLAUDE_TEAM_TOKEN) { $agent = "claude" }
    if ($env:CODEX_TEAM_TOKEN -and -not $agent) { $agent = "codex" }
    if ($Rest.Count -gt 0 -and $Rest[0] -in @("claude", "codex")) { $agent = $Rest[0]; $Rest = $Rest[1..($Rest.Count - 1)] }
    if ($agent -eq "codex" -and -not $env:CODEX_TEAM_TOKEN) { Fail "CODEX_TEAM_TOKEN not in .env" }
    if ($agent -eq "claude" -and -not $env:CLAUDE_TEAM_TOKEN) { Fail "CLAUDE_TEAM_TOKEN not in .env" }
    if ($agent -eq "codex") { $Token = $env:CODEX_TEAM_TOKEN }
    $who = Api GET "/api/whoami" $Token
    if (-not $who) { Fail "the server at $Base rejected this token (or is unreachable). Check .env, then: .\demo.ps1 status" }
    if ($agent -eq "codex") {
      # Codex's MCP url is a literal in .codex/config.toml; point it at the server for this clone.
      # hooks/report_edit.py ignores .codex/ so this edit never shows up as an "edit" event.
      $toml = Get-Content .codex/config.toml -Raw
      $toml = $toml -replace '(?m)^url = .*$', ('url = "' + $env:TEAM_MCP_URL + '"')
      [IO.File]::WriteAllText((Join-Path $PSScriptRoot ".codex/config.toml"), $toml)
    }
    Write-Host "demo: $agent as '$($who.name)' -> $Base"
    $prompt = ($Rest -join " ")
    if ($prompt) {
      if ($agent -eq "claude") {
        & claude -p $prompt --output-format text --allowedTools "Read,Edit,Write,Glob,Grep,mcp__team-coordinator__declare_intent,mcp__team-coordinator__check_conflicts,mcp__team-coordinator__get_spec,mcp__team-coordinator__propose_spec_change"
      } else {
        # Empty stdin: `codex exec` otherwise waits to "read additional input from stdin"
        # whenever stdin is not a terminal (CI, a script, another tool) and never starts.
        $null | & codex exec $prompt --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox
      }
      exit $LASTEXITCODE
    }
    & $agent
    exit $LASTEXITCODE
  }
  "reset" {
    git reset -q --hard demo-seed; git clean -fdq
    Write-Host "demo: clone reset to demo-seed"
    $r = Api POST "/api/reset" $Token
    if (-not $r) { Fail "server reset failed. Check .env, then: .\demo.ps1 status" }
    Write-Host "demo: server reset by $($r.by): contracts restored, events cleared, alice/bob claims in place"
  }
  "status" {
    $who = Api GET "/api/whoami" $Token
    Write-Host "server:   $Base"
    Write-Host ("you are:  " + $(if ($who) { $who.name } else { "UNKNOWN (token rejected or server unreachable)" }))
    try { $h = Invoke-RestMethod "$Base/health" -TimeoutSec 10; Write-Host ("health:   " + ($h | ConvertTo-Json -Compress)) } catch { Write-Host "health:   unreachable" }
    $dirty = @(git status --porcelain -- . ":!.codex/config.toml").Count  # the launcher rewrites config.toml; not a demo edit
    Write-Host ("clone:    " + $(if ($dirty -eq 0) { "clean" } else { "$dirty changed file(s) since demo-seed -- .\demo.ps1 reset to clear" }))
  }
  default {
    Write-Host "usage: .\demo.ps1 up [claude|codex] [""<prompt>""] | reset | status"
    exit 1
  }
}
