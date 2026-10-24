param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Installer integration runs only on a Windows GitHub runner.' }
$metadata = Get-Content package.json -Raw | ConvertFrom-Json
$guid = 'cff115b9-d86e-58de-afc6-4752a9c78ba4'
$registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
if (Test-Path $registry) { throw 'Unexpected existing application on the runner.' }
$oldName = 'WorkBuddy-Switch-1.4.0-windows-x64-setup.exe'
$base = 'https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v1.4.0'
$manifestFile = Join-Path $env:RUNNER_TEMP 'workbuddy-old-SHA256SUMS.txt'
Invoke-WebRequest "$base/SHA256SUMS.txt" -OutFile $manifestFile
$manifest = Get-Content $manifestFile -Raw -Encoding UTF8
$line = ($manifest -split "`n") | Where-Object { $_.Trim().EndsWith($oldName) } | Select-Object -First 1
if (!$line) { throw 'Missing old-installer checksum.' }
$expected = ($line.Trim() -split '\s+')[0]
$old = Join-Path $env:RUNNER_TEMP $oldName
Invoke-WebRequest "$base/$oldName" -OutFile $old
if ((Get-FileHash $old -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Old-installer checksum mismatch.' }
$fixtureRoot = Join-Path $env:APPDATA 'WorkBuddy Switch'
New-Item $fixtureRoot -ItemType Directory -Force | Out-Null
$sentinel = Join-Path $fixtureRoot 'installer-upgrade-fixture.json'
$original = '{"account":"isolated-upgrade-fixture","settings":"preserve"}'
[IO.File]::WriteAllText($sentinel,$original)
$process = Start-Process -FilePath $old -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Old install failed: $($process.ExitCode)" }
$before = Get-ItemProperty $registry
$installRegistry = "HKCU:\Software\$guid"
$location = (Get-ItemProperty $installRegistry).InstallLocation
if (!$location -or $before.DisplayVersion -ne '1.4.0') { throw 'Old installation identity is missing.' }
$process = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Upgrade failed: $($process.ExitCode)" }
$after = Get-ItemProperty $registry
if ((Get-ItemProperty $installRegistry).InstallLocation -ne $location -or $after.DisplayVersion -ne $metadata.version) { throw 'Upgrade changed the installed location or did not update the version.' }
if ([IO.File]::ReadAllText($sentinel) -ne $original) { throw 'Upgrade changed user data.' }
$entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'WorkBuddy Switch' })
if ($entries.Count -ne 1) { throw 'Duplicate uninstall entries remain.' }
Write-Output 'PASS: native Windows installer upgrades verified 1.4.0 in place, preserves user data and leaves one uninstall entry.'
