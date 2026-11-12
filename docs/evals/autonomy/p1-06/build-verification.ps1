$workspaceRoot = [IO.Path]::GetFullPath((Get-Location).Path)
$distRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'dist'))
$recordDir = 'docs/evals/autonomy/p1-06'
$buildResults = @(); $cleanupRecords = @()
$harnesses = @(Get-ChildItem -LiteralPath (Join-Path $workspaceRoot 'harness') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.ts') } | ForEach-Object { $_.Name })
foreach ($harnessName in $harnesses) {
  $generatedTarget = [IO.Path]::GetFullPath((Join-Path $distRoot $harnessName))
  if ([IO.Path]::GetDirectoryName($generatedTarget) -ne $distRoot -or [IO.Path]::GetDirectoryName($distRoot) -ne $workspaceRoot -or $harnessName -notmatch '^[a-z0-9-]+$') { throw 'Generated target outside workspace/dist' }
  foreach ($cleanupAttempt in 1..8) {
    if (-not (Test-Path -LiteralPath $generatedTarget)) { break }
    if ((Get-Item -LiteralPath $generatedTarget -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked generated target' }
    $linkedEntries = @(Get-ChildItem -LiteralPath $generatedTarget -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($linkedEntries.Count) { throw 'Linked generated content' }
    try { Remove-Item -LiteralPath $generatedTarget -Recurse -Force -ErrorAction Stop; $cleanupRecords += [PSCustomObject]@{harness=$harnessName;attempt=$cleanupAttempt;success=$true;target=$generatedTarget} }
    catch { $cleanupRecords += [PSCustomObject]@{harness=$harnessName;attempt=$cleanupAttempt;success=$false;target=$generatedTarget;error=$_.Exception.Message}; Start-Sleep -Milliseconds 500 }
    ConvertTo-Json -InputObject @($cleanupRecords) -Depth 6 | Set-Content -LiteralPath "$recordDir/cleanup-results.json" -Encoding utf8
  }
  if (Test-Path -LiteralPath $generatedTarget) { throw "Generated directory remains locked: $harnessName" }
  $startedAt = [DateTime]::UtcNow.ToString('o')
  $logPath = "$recordDir/build-$harnessName.log"
  node node_modules/tsx/dist/cli.mjs scripts/build.ts --harness $harnessName *> $logPath
  $buildExit = $LASTEXITCODE
  $buildResults += [PSCustomObject]@{harness=$harnessName;command=@('node','node_modules/tsx/dist/cli.mjs','scripts/build.ts','--harness',$harnessName);exit_code=$buildExit;started_at=$startedAt;finished_at=[DateTime]::UtcNow.ToString('o');verified_target=$generatedTarget;native_powershell_cleanup=$true;log=$logPath}
  ConvertTo-Json -InputObject @($buildResults) -Depth 8 | Set-Content -LiteralPath "$recordDir/build-results.json" -Encoding utf8
  Write-Output "$harnessName build: $buildExit"
  if ($buildExit -ne 0) { throw "Failed to build $harnessName" }
}
