param([string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin')
$ErrorActionPreference = 'Stop'
# Fixed localhost port and synthetic databases only. No .env connection is used.
$repo = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('drivemaster-launch-' + [guid]::NewGuid().ToString('N'))
$dataDir = Join-Path $testRoot 'data'
$started = $false
$previousUrl = $env:DATABASE_URL
$previousLaunchUrl = $env:LAUNCH_TEST_DATABASE_URL
function Assert-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." } }
New-Item -ItemType Directory -Path $testRoot | Out-Null
Push-Location $repo
try {
  & (Join-Path $PgBin 'initdb.exe') -D $dataDir -U sms_test -A trust --encoding=UTF8 --locale=C
  Assert-Exit 'Initialize isolated cluster'
  & (Join-Path $PgBin 'pg_ctl.exe') -D $dataDir -l (Join-Path $testRoot 'server.log') -o '-p 55438 -h 127.0.0.1' -w start
  Assert-Exit 'Start isolated cluster'
  $started = $true
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55438 -U sms_test sync_test
  Assert-Exit 'Create synthetic database'
  $env:DATABASE_URL = 'postgresql://sms_test@127.0.0.1:55438/sync_test?schema=public'
  $env:LAUNCH_TEST_DATABASE_URL = $env:DATABASE_URL
  npm exec --workspace=apps/api -- prisma migrate deploy
  Assert-Exit 'Deploy migrations'
  node apps/api/scripts/launch-validation.mjs benchmark | Set-Content -Encoding UTF8 (Join-Path $testRoot 'benchmark.json')
  Assert-Exit 'Snapshot benchmark'
  node apps/api/scripts/launch-validation.mjs fingerprint | Set-Content -Encoding UTF8 (Join-Path $testRoot 'before.json')
  Assert-Exit 'Source fingerprint'
  $backup = Join-Path $testRoot 'synthetic.dump'
  & (Join-Path $PgBin 'pg_dump.exe') -h 127.0.0.1 -p 55438 -U sms_test -d sync_test -Fc -f $backup
  Assert-Exit 'Backup'
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55438 -U sms_test sync_restore_test
  Assert-Exit 'Create restore database'
  & (Join-Path $PgBin 'pg_restore.exe') -h 127.0.0.1 -p 55438 -U sms_test -d sync_restore_test --exit-on-error $backup
  Assert-Exit 'Restore backup'
  $env:LAUNCH_TEST_DATABASE_URL = 'postgresql://sms_test@127.0.0.1:55438/sync_restore_test?schema=public'
  node apps/api/scripts/launch-validation.mjs verify-restore
  Assert-Exit 'Restored readiness and payment trigger'
  node apps/api/scripts/launch-validation.mjs fingerprint | Set-Content -Encoding UTF8 (Join-Path $testRoot 'after.json')
  Assert-Exit 'Restored fingerprint'
  if ((Get-Content (Join-Path $testRoot 'before.json') -Raw) -ne (Get-Content (Join-Path $testRoot 'after.json') -Raw)) {
    throw 'Restored data or sequence fingerprints differ.'
  }
  Write-Output 'PASS: all table rows and sequence states match after restore.'
  Get-Content (Join-Path $testRoot 'benchmark.json')
  Write-Output "Synthetic validation artifacts: $testRoot"
} finally {
  if ($started) { & (Join-Path $PgBin 'pg_ctl.exe') -D $dataDir -m fast -w stop }
  $env:DATABASE_URL = $previousUrl
  $env:LAUNCH_TEST_DATABASE_URL = $previousLaunchUrl
  Pop-Location
}
