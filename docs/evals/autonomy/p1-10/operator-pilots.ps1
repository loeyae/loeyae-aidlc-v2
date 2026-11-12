param([switch]$RetryUnstarted)
$ErrorActionPreference = 'Stop'
try {
    $pilotReview = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'integration-audit-2026-11-10/review-status.json') -Raw | ConvertFrom-Json
    if ($pilotReview.schema -ne 'aidlc.integration-review/v1' -or $pilotReview.scope -ne 'P1-10 real pilot execution' -or $pilotReview.decision -ne 'GO' -or $pilotReview.optimization_complete -ne $true -or $pilotReview.real_trials_permitted -ne $true) { throw 'review is not GO' }
} catch {
    Write-Output '{"kind":"pilot-entry-check","integration_review":{"decision":"HOLD","reason":"review-not-go","execution_authorized":false},"ready_for_actual_terminal_review":false,"execution_authorized":false,"business_verified":false}'
    exit 2
}
# This early stop is only a convenience. The Node bootstrap validates the full
# source-bound Go package before reading any pilot state or claiming/H5/service.
$Host.UI.RawUI.WindowTitle = 'AI-DLC P1-10 H5: orders-r10 + publish-r14'
if ($RetryUnstarted) { $Host.UI.RawUI.WindowTitle = 'AI-DLC P1-10 retry: publish-r14 H5; orders-r10 retained' }
$pilotRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
Push-Location -LiteralPath $pilotRepository
try {
    $pilotNode = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'orders-r10/baseline-oracle.json') -Raw | ConvertFrom-Json).argv[0]
    $pilotArguments = @('node_modules/tsx/dist/cli.mjs','docs/evals/autonomy/p1-10/operator-pilots.ts')
    if ($RetryUnstarted) { $pilotArguments += '--retry-unstarted' }
    & $pilotNode @pilotArguments
    if ($LASTEXITCODE -ne 0) { throw "P1-10 stopped with exit code $LASTEXITCODE; preserve the raw attempts and inspect their results." }
} finally {
    Pop-Location
}
