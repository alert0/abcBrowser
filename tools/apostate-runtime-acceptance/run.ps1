$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$releaseTag = 'v0.5.1'
$chromiumVersion = '155.0.8059.31'
$assetUrl = 'https://github.com/heretic-tech/apostate/releases/download/v0.5.1/apostate-155.0.8059.31-windows-x64.zip'
$expectedSha256 = '8e55e44fb7f58619461e1d42a947446dcc08a2b46493c420c8e62ae27ab9c7e5'
$tempBase = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($tempBase)) { $tempBase = [System.IO.Path]::GetTempPath() }
$script:runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$script:artifactRoot = Join-Path $tempBase 'apostate-native-acceptance'
$script:workRoot = Join-Path $tempBase "apostate-native-acceptance-run-$($script:runId)"
$script:evidenceRoot = Join-Path (Join-Path $script:artifactRoot 'evidence') $script:runId
$script:logsRoot = Join-Path $script:evidenceRoot 'logs'
$script:evidencePath = Join-Path $script:evidenceRoot 'evidence.json'
$script:checks = [System.Collections.Generic.List[object]]::new()
$script:rawArguments = [System.Collections.Generic.List[object]]::new()
$script:sideBySideEvents = @()
$script:chromePath = $null
$script:runtimeRoot = $null
$script:embeddedManifestPath = Join-Path $script:evidenceRoot 'chrome-embedded.manifest'
$script:sxsTracePath = Join-Path $script:evidenceRoot 'sxstrace.etl'
$script:sxsTraceTextPath = Join-Path $script:evidenceRoot 'sxstrace.txt'
$script:httpHeadersPath = Join-Path $script:evidenceRoot 'http-headers.json'
$script:probePagePath = Join-Path $script:evidenceRoot 'runtime-probe.html'
$script:probeServerProcess = $null
$script:probeBaseUri = $null
$script:filePageUri = $null
$script:sxsTraceStarted = $false
$script:sxsTraceStatus = 'NOT_ATTEMPTED'
$script:acceptanceStartedAt = (Get-Date).AddSeconds(-1)
$assetHash = $null
$binaryVersion = $null
$hostRuntime = $null
$seedRuntime = $null
$seedRepeatRuntime = $null
$changedSeedRuntime = $null
$cpuEqualRuntime = $null
$cpuOverHostRuntime = $null
$memoryOverHostRuntime = $null
$customRuntime = $null
$partialProfileRuntime = $null
$gpuRuntime = $null
$noiseRuntime = $null
$proxyOnlyRuntime = $null
$seedReport = ''
$hostReport = ''
$gpuReport = ''
$script:archiveManifestStatus = 'UNVERIFIED'
$script:hostLogicalProcessors = $null
$script:hostPhysicalMemoryBytes = $null
$script:fatalMessage = $null
$script:archiveEntries = @()
$script:versionManifestEntries = @()
$script:archiveSource = $null

New-Item -ItemType Directory -Path $script:workRoot, $script:logsRoot -Force | Out-Null

function Save-TextArtifact {
  param([Parameter(Mandatory = $true)][string]$Path, [AllowEmptyString()][string]$Text)
  Set-Content -LiteralPath $Path -Value $Text -Encoding utf8
}

function Capture-SideBySideEvents {
  try {
    $script:sideBySideEvents = @(Get-WinEvent -FilterHashtable @{
      LogName = 'Application'
      ProviderName = 'SideBySide'
      StartTime = $script:acceptanceStartedAt
    } -MaxEvents 30 -ErrorAction SilentlyContinue | ForEach-Object {
      [ordered]@{
        timeCreatedUtc = $_.TimeCreated.ToUniversalTime().ToString('o')
        eventId = $_.Id
        level = $_.LevelDisplayName
        message = $_.Message
      }
    })
  } catch {
    $script:sideBySideEvents = @([ordered]@{ collectionError = $_.Exception.Message })
  }
  Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'side-by-side-events.json') -Text ($script:sideBySideEvents | ConvertTo-Json -Depth 6)
}

function Start-SxsTrace {
  $sxstrace = Join-Path $env:WINDIR 'System32\sxstrace.exe'
  if (-not (Test-Path -LiteralPath $sxstrace)) {
    $script:sxsTraceStatus = 'UNAVAILABLE'
    Add-Check -Name 'sxstrace diagnostics' -Status 'UNVERIFIED' -Details 'sxstrace.exe is unavailable on this runner.'
    return
  }
  try {
    $output = @(& $sxstrace Trace "-logfile:$script:sxsTracePath" -nostop 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'sxstrace-start.txt') -Text (($output -join [Environment]::NewLine) + "`nexitCode=$exitCode")
    $reportedFailure = (($output -join ' ') -match '(?i)StartTrace failed|error message is')
    if ($exitCode -eq 0 -and -not $reportedFailure -and (Test-Path -LiteralPath $script:sxsTracePath)) {
      $script:sxsTraceStarted = $true
      $script:sxsTraceStatus = 'RUNNING'
      Add-Check -Name 'sxstrace diagnostics' -Status 'INFO' -Details 'SxS activation tracing started before chrome.exe --version.'
    } else {
      $script:sxsTraceStatus = "UNAVAILABLE_EXIT_$exitCode"
      Add-Check -Name 'sxstrace diagnostics' -Status 'UNVERIFIED' -Details "Could not start sxstrace (exit $exitCode); the event log is still collected. $($output -join ' ')"
    }
  } catch {
    $script:sxsTraceStatus = 'UNAVAILABLE_EXCEPTION'
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'sxstrace-start.txt') -Text $_.Exception.ToString()
    Add-Check -Name 'sxstrace diagnostics' -Status 'UNVERIFIED' -Details "Could not start sxstrace: $($_.Exception.Message)"
  }
}

function Stop-SxsTrace {
  if (-not $script:sxsTraceStarted) { return }
  $sxstrace = Join-Path $env:WINDIR 'System32\sxstrace.exe'
  try {
    $stopOutput = @(& $sxstrace Stoptrace 2>&1 | ForEach-Object { [string]$_ })
    $stopCode = $LASTEXITCODE
    $parseOutput = @(& $sxstrace Parse "-logfile:$script:sxsTracePath" "-outfile:$script:sxsTraceTextPath" 2>&1 | ForEach-Object { [string]$_ })
    $parseCode = $LASTEXITCODE
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'sxstrace-stop-parse.txt') -Text ((@($stopOutput) + @("stopExitCode=$stopCode") + @($parseOutput) + @("parseExitCode=$parseCode")) -join [Environment]::NewLine)
    if ($parseCode -eq 0 -and (Test-Path -LiteralPath $script:sxsTraceTextPath)) {
      $script:sxsTraceStatus = 'CAPTURED'
      Add-Check -Name 'sxstrace diagnostics' -Status 'PASS' -Details 'Parsed SxS activation trace was saved as sxstrace.txt.'
    } else {
      $script:sxsTraceStatus = "PARSE_FAILED_EXIT_$parseCode"
      Add-Check -Name 'sxstrace diagnostics' -Status 'UNVERIFIED' -Details "SxS trace could not be parsed (exit $parseCode)."
    }
  } catch {
    $script:sxsTraceStatus = 'STOP_OR_PARSE_EXCEPTION'
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'sxstrace-stop-parse.txt') -Text $_.Exception.ToString()
    Add-Check -Name 'sxstrace diagnostics' -Status 'UNVERIFIED' -Details "Could not stop or parse sxstrace: $($_.Exception.Message)"
  } finally {
    $script:sxsTraceStarted = $false
  }
}

function Add-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL', 'BLOCKED', 'UNVERIFIED', 'INFO')][string]$Status,
    [Parameter(Mandatory = $true)][string]$Details
  )
  $script:checks.Add([pscustomobject]@{ name = $Name; status = $Status; details = $Details })
  Write-Host "$Status $Name - $Details"
}

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected
  )
  if ($Actual -ne $Expected) {
    Add-Check -Name $Name -Status 'FAIL' -Details "Expected [$Expected], received [$Actual]"
    throw "$Name failed: expected [$Expected], received [$Actual]"
  }
  Add-Check -Name $Name -Status 'PASS' -Details "Observed [$Actual]"
}

function Assert-Match {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Pattern
  )
  if ($Text -notmatch $Pattern) {
    Add-Check -Name $Name -Status 'FAIL' -Details "Output did not match [$Pattern]"
    throw "$Name failed: output did not match [$Pattern]"
  }
  Add-Check -Name $Name -Status 'PASS' -Details "Output matched [$Pattern]"
}

function Get-MtExecutable {
  $command = Get-Command 'mt.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (-not (Test-Path -LiteralPath $kitsRoot)) { return $null }
  foreach ($versionDirectory in (Get-ChildItem -LiteralPath $kitsRoot -Directory | Sort-Object Name -Descending)) {
    $candidate = Join-Path $versionDirectory.FullName 'x64\mt.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-VersionedSxsManifest {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Version)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try {
    $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $escapedVersion = [regex]::Escape($Version)
    $quote = '["'']'
    $identity = '(?is)<assemblyIdentity\b(?=[^>]*\bname\s*=\s*' + $quote + $escapedVersion + $quote + ')(?=[^>]*\bversion\s*=\s*' + $quote + $escapedVersion + $quote + ')[^>]*>'
    $chromeElf = '(?is)<file\b(?=[^>]*\bname\s*=\s*["'']chrome_elf\.dll["''])[^>]*\/?\s*>'
    return [regex]::IsMatch($text, $identity) -and [regex]::IsMatch($text, $chromeElf)
  } catch {
    return $false
  }
}

function ConvertTo-ExplainRecord {
  param([Parameter(Mandatory = $true)][string]$Text)
  $lines = $Text -split "`r?`n"
  $firstLine = $lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
  $fields = [ordered]@{}
  $warnings = [System.Collections.Generic.List[string]]::new()
  $limitations = [System.Collections.Generic.List[string]]::new()
  $readingLimitations = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*limitations\s*:?\s*$') { $readingLimitations = $true; continue }
    if ($line -match '^\s*!\s*(?<message>.+?)\s*$') {
      $warnings.Add($Matches.message)
      continue
    }
    if ($readingLimitations -and $line -match '^\s*(?:[-*]\s*)?(?<message>\S.*)$') {
      $limitations.Add($Matches.message.Trim())
      continue
    }
    if ($line -match '^\s{2,}(?<key>[A-Za-z][A-Za-z0-9 _/-]*?)\s{2,}(?<value>\S.*?)\s*$') {
      $fields[$Matches.key.Trim().ToLowerInvariant()] = $Matches.value.Trim()
    }
  }
  return [ordered]@{
    title = ([string]$firstLine).Trim()
    fields = $fields
    warnings = @($warnings)
    limitations = @($limitations)
    rawText = $Text
  }
}

function Assert-ExplainField {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][string]$Field,
    [Parameter(Mandatory = $true)][string]$Expected
  )
  if (-not $Record.fields.Contains($Field)) {
    Add-Check -Name $Name -Status 'UNVERIFIED' -Details "Explain output did not contain the documented '$Field' field."
    return
  }
  Assert-Equal -Name $Name -Actual $Record.fields[$Field] -Expected $Expected
}

function Save-EnvironmentSnapshot {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $computer = Get-CimInstance -ClassName Win32_ComputerSystem
  $processors = @(Get-CimInstance -ClassName Win32_Processor)
  $videoAdapters = @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
    [ordered]@{ name = $_.Name; adapterCompatibility = $_.AdapterCompatibility; driverVersion = $_.DriverVersion }
  })
  $script:hostLogicalProcessors = [int](($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)
  $script:hostPhysicalMemoryBytes = [int64]$computer.TotalPhysicalMemory
  [ordered]@{
    capturedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    osCaption = $os.Caption
    osVersion = $os.Version
    osBuildNumber = $os.BuildNumber
    architecture = $os.OSArchitecture
    processorName = (($processors | ForEach-Object Name | Sort-Object -Unique) -join '; ')
    gpuAdapters = $videoAdapters
    logicalProcessors = $script:hostLogicalProcessors
    totalPhysicalMemoryBytes = $script:hostPhysicalMemoryBytes
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    githubRunnerImage = $env:ImageOS
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'environment.json') -Encoding utf8
}

function Get-CheckStatus {
  param([Parameter(Mandatory = $true)][string]$Name)
  $check = $script:checks | Where-Object { $_.name -eq $Name } | Select-Object -Last 1
  if ($check) { return $check.status }
  return 'UNVERIFIED'
}

function Start-ProbeHttpServer {
  $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) {
    Add-Check -Name 'local HTTP probe server' -Status 'UNVERIFIED' -Details 'node.exe is unavailable; browser probes will use file:// and HTTP headers cannot be verified.'
    return
  }
  $serverScript = Join-Path $PSScriptRoot 'probe-server.mjs'
  $stdoutPath = Join-Path $script:logsRoot 'probe-server.stdout.txt'
  $stderrPath = Join-Path $script:logsRoot 'probe-server.stderr.txt'
  $arguments = @($serverScript, $script:probePagePath, $script:httpHeadersPath)
  $quotedArguments = foreach ($argument in $arguments) { '"' + $argument.Replace('"', '\"') + '"' }
  try {
    $script:probeServerProcess = Start-Process -FilePath $node.Source -ArgumentList ($quotedArguments -join ' ') -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      if (Test-Path -LiteralPath $stdoutPath) {
        $output = Get-Content -LiteralPath $stdoutPath -Raw
        if (-not [string]::IsNullOrWhiteSpace($output)) {
          $match = [regex]::Match($output, 'APOSTATE_PROBE_SERVER:(\{[^\r\n]+\})')
          if ($match.Success) {
            $server = $match.Groups[1].Value | ConvertFrom-Json
            $script:probeBaseUri = "http://$($server.host):$($server.port)/probe.html"
            Add-Check -Name 'local HTTP probe server' -Status 'PASS' -Details 'Started an isolated loopback-only header probe.'
            return
          }
        }
      }
      if ($script:probeServerProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    $serverError = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
    Add-Check -Name 'local HTTP probe server' -Status 'UNVERIFIED' -Details "Loopback server did not report a listening port. $serverError"
    if ($script:probeServerProcess -and -not $script:probeServerProcess.HasExited) {
      Stop-Process -Id $script:probeServerProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $script:probeServerProcess = $null
  } catch {
    Add-Check -Name 'local HTTP probe server' -Status 'UNVERIFIED' -Details "Could not start loopback probe: $($_.Exception.Message)"
  }
}

function Invoke-Apostate {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$TimeoutSeconds = 45
  )
  $stdoutPath = Join-Path $script:logsRoot "$Label.stdout.txt"
  $stderrPath = Join-Path $script:logsRoot "$Label.stderr.txt"
  $argumentEvidence = @($Arguments | ForEach-Object {
    if ($_ -like '--user-data-dir=*') { '--user-data-dir=<redacted-temporary-profile>' }
    elseif ($_ -like '--apostate-profile=*') { '--apostate-profile=<redacted-profile-payload>' }
    else { $_ }
  })
  $script:rawArguments.Add([ordered]@{ label = $Label; arguments = $argumentEvidence })
  Save-TextArtifact -Path (Join-Path $script:logsRoot "$Label.arguments.json") -Text ($argumentEvidence | ConvertTo-Json -Depth 4)
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

  $quotedArguments = foreach ($argument in $Arguments) {
    if ($argument -match '[\s"]') {
      '"' + $argument.Replace('"', '\"') + '"'
    } else {
      $argument
    }
  }
  $argumentLine = $quotedArguments -join ' '
  try {
    $process = Start-Process -FilePath $script:chromePath -ArgumentList $argumentLine -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  } catch {
    $startMessage = $_.Exception.Message
    Capture-SideBySideEvents
    $manifestFiles = @()
    try {
      $manifestFiles = @(Get-ChildItem -LiteralPath (Split-Path -Parent $script:chromePath) -Filter '*.manifest' -File -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
      })
    } catch {}
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot "$Label.start-error.txt") -Text $startMessage
    $manifestFiles | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'adjacent-manifests.json') -Encoding utf8
    $eventText = @($script:sideBySideEvents | ForEach-Object { $_.message }) -join ' || '
    $details = "Start error: $startMessage; SideBySide events: $eventText; adjacent manifests: $($manifestFiles.name -join ', ')"
    Add-Check -Name "$Label startup diagnostics" -Status 'FAIL' -Details $details
    throw "$Label could not start. $details"
  }

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    throw "$Label timed out after $TimeoutSeconds seconds"
  }
  $process.WaitForExit()

  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
  return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = [string]$stdout; Stderr = [string]$stderr }
}

function Read-RuntimeFromDom {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $runtimeUri = if ($script:probeBaseUri) {
    "$($script:probeBaseUri)?case=$([uri]::EscapeDataString($Label))"
  } else {
    $script:filePageUri
  }
  $runtimeArguments = @()
  if ($Arguments.Count -gt 1) { $runtimeArguments = @($Arguments[0..($Arguments.Count - 2)]) }
  $runtimeArguments += $runtimeUri
  $result = Invoke-Apostate -Label $Label -Arguments $runtimeArguments -TimeoutSeconds 45
  $combined = $result.Stdout + [Environment]::NewLine + $result.Stderr
  if ($result.ExitCode -ne 0) {
    throw "$Label exited with code $($result.ExitCode): $combined"
  }
  $match = [regex]::Match($combined, 'APOSTATE_RESULT:([^<\r\n]+)')
  if (-not $match.Success) {
    throw "$Label did not emit the runtime JSON marker. Output: $combined"
  }
  return ($match.Groups[1].Value | ConvertFrom-Json)
}

try {
  Save-EnvironmentSnapshot
  $archive = Join-Path $script:workRoot 'apostate-v0.5.1-windows-x64.zip'
  $extractRoot = Join-Path $script:workRoot 'runtime'
  if (-not [string]::IsNullOrWhiteSpace($env:APOSTATE_ACCEPTANCE_ARCHIVE)) {
    if (-not (Test-Path -LiteralPath $env:APOSTATE_ACCEPTANCE_ARCHIVE -PathType Leaf)) {
      throw 'APOSTATE_ACCEPTANCE_ARCHIVE does not name an existing ZIP file.'
    }
    Copy-Item -LiteralPath $env:APOSTATE_ACCEPTANCE_ARCHIVE -Destination $archive
    $script:archiveSource = 'caller-supplied file; pinned SHA-256 still enforced'
  } else {
    Invoke-WebRequest -Uri $assetUrl -OutFile $archive
    $script:archiveSource = 'pinned GitHub release URL'
  }
  $assetHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Equal -Name 'official release SHA-256' -Actual $assetHash -Expected $expectedSha256

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $script:archiveEntries = @($zip.Entries | ForEach-Object { [ordered]@{ path = $_.FullName; size = $_.Length } })
    $script:archiveEntries | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'archive-entries.json') -Encoding utf8
    $script:versionManifestEntries = @($zip.Entries | Where-Object { [IO.Path]::GetFileName($_.FullName) -ieq "$chromiumVersion.manifest" } | ForEach-Object FullName)
  } finally {
    $zip.Dispose()
  }
  if ($script:versionManifestEntries.Count -eq 1) {
    $script:archiveManifestStatus = 'PRESENT'
    Add-Check -Name 'release ZIP versioned SxS manifest entry' -Status 'PASS' -Details $script:versionManifestEntries[0]
  } else {
    $script:archiveManifestStatus = 'MISSING'
    Add-Check -Name 'release ZIP versioned SxS manifest entry' -Status 'FAIL' -Details "Expected exactly one $chromiumVersion.manifest; found $($script:versionManifestEntries.Count)."
  }

  Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
  Remove-Item -LiteralPath $archive -Force
  $executables = @(Get-ChildItem -LiteralPath $extractRoot -Filter 'chrome.exe' -File -Recurse | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'chrome.dll')) -and
    (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'resources.pak')) -and
    (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'icudtl.dat'))
  })
  if ($executables.Count -ne 1) {
    throw "Expected one complete Apostate chrome.exe runtime; found $($executables.Count)"
  }
  $script:chromePath = $executables[0].FullName
  $script:runtimeRoot = $executables[0].DirectoryName
  Add-Check -Name 'runtime layout' -Status 'PASS' -Details "Found complete runtime at $script:chromePath"

  $adjacentManifestPath = Join-Path $script:runtimeRoot "$chromiumVersion.manifest"
  if (Test-VersionedSxsManifest -Path $adjacentManifestPath -Version $chromiumVersion) {
    Add-Check -Name 'release runtime SxS manifest identity' -Status 'PASS' -Details "Manifest identity $chromiumVersion maps to chrome_elf.dll."
  } elseif (Test-Path -LiteralPath $adjacentManifestPath -PathType Leaf) {
    Add-Check -Name 'release runtime SxS manifest identity' -Status 'FAIL' -Details "$chromiumVersion.manifest does not declare the matching assembly identity and chrome_elf.dll mapping."
  } else {
    Add-Check -Name 'release runtime SxS manifest identity' -Status 'FAIL' -Details "Official ZIP omitted required external assembly manifest $chromiumVersion.manifest; no replacement is generated by this test."
  }

  $mt = Get-MtExecutable
  if ($mt) {
    $mtOutput = @(& $mt -nologo "-inputresource:$script:chromePath;#1" "-out:$script:embeddedManifestPath" 2>&1 | ForEach-Object { [string]$_ })
    $mtExitCode = $LASTEXITCODE
    Save-TextArtifact -Path (Join-Path $script:evidenceRoot 'mt-manifest-extraction.txt') -Text ((@($mtOutput) + @("exitCode=$mtExitCode")) -join [Environment]::NewLine)
    if ($mtExitCode -eq 0 -and (Test-Path -LiteralPath $script:embeddedManifestPath)) {
      $embeddedText = Get-Content -LiteralPath $script:embeddedManifestPath -Raw
      $embeddedPattern = '(?is)<assemblyIdentity\b(?=[^>]*\bname\s*=\s*["'']' + [regex]::Escape($chromiumVersion) + '["''])(?=[^>]*\bversion\s*=\s*["'']' + [regex]::Escape($chromiumVersion) + '["''])[^>]*>'
      if ([regex]::IsMatch($embeddedText, $embeddedPattern)) {
        Add-Check -Name 'chrome.exe embedded SxS dependency' -Status 'PASS' -Details "Embedded manifest requests assembly $chromiumVersion."
      } else {
        Add-Check -Name 'chrome.exe embedded SxS dependency' -Status 'UNVERIFIED' -Details 'Could not find the pinned assembly identity in the extracted embedded manifest.'
      }
    } else {
      Add-Check -Name 'chrome.exe embedded SxS dependency' -Status 'UNVERIFIED' -Details "mt.exe could not extract the embedded manifest (exit $mtExitCode)."
    }
  } else {
    Add-Check -Name 'chrome.exe embedded SxS dependency' -Status 'UNVERIFIED' -Details 'Windows SDK mt.exe is unavailable; embedded manifest was not inspected.'
  }

  Start-SxsTrace
  try {
    $versionResult = Invoke-Apostate -Label 'version' -Arguments @(
      "--user-data-dir=$(Join-Path $script:workRoot 'version-profile')",
      '--no-first-run',
      '--no-default-browser-check',
      '--version'
    )
  } finally {
    Stop-SxsTrace
    Capture-SideBySideEvents
  }
  $versionText = $versionResult.Stdout + [Environment]::NewLine + $versionResult.Stderr
  if ($versionResult.ExitCode -ne 0) { throw "chrome.exe --version failed: $versionText" }
  if ($versionText -notmatch [regex]::Escape($chromiumVersion)) {
    Add-Check -Name 'Chromium build version' -Status 'FAIL' -Details "chrome.exe --version did not report $chromiumVersion."
    throw "chrome.exe --version did not report the pinned Chromium version. Output: $versionText"
  }
  Add-Check -Name 'Chromium build version' -Status 'PASS' -Details "chrome.exe --version reported $chromiumVersion."
  $binaryVersion = $versionText.Trim()

  $seedExplain = Invoke-Apostate -Label 'seed-explain' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'seed-explain-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London',
    '--fingerprint-explain'
  )
  $seedReport = $seedExplain.Stdout + [Environment]::NewLine + $seedExplain.Stderr
  if ($seedExplain.ExitCode -ne 0) { throw "Seed --fingerprint-explain failed: $seedReport" }
  $seedExplainRecord = ConvertTo-ExplainRecord -Text $seedReport
  $seedExplainRecord | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'seed-explain.json') -Encoding utf8
  Assert-Equal -Name 'seed explain title' -Actual $seedExplainRecord.title -Expected 'apostate fingerprint composition'
  Assert-ExplainField -Name 'seed explain Chromium version' -Record $seedExplainRecord -Field 'chromium' -Expected $chromiumVersion
  Assert-ExplainField -Name 'seed explain composition seed' -Record $seedExplainRecord -Field 'seed' -Expected '42'
  if ($seedExplainRecord.warnings.Count -gt 0) {
    Add-Check -Name 'seed explain warnings captured' -Status 'INFO' -Details ($seedExplainRecord.warnings -join ' | ')
  }
  if ($seedExplainRecord.limitations.Count -gt 0) {
    Add-Check -Name 'seed explain limitations captured' -Status 'INFO' -Details ($seedExplainRecord.limitations -join ' | ')
  } else {
    Add-Check -Name 'seed explain limitations captured' -Status 'UNVERIFIED' -Details 'Explain output had no parseable limitations section; this is recorded separately from runtime behavior.'
  }

  $gpuExplain = Invoke-Apostate -Label 'gpu-anchor-explain' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'gpu-anchor-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-anchor=windows-d3d11-intel-79dfeb5b4f99',
    '--fingerprint-gpu-renderer=ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    '--fingerprint-explain'
  )
  $gpuReport = $gpuExplain.Stdout + [Environment]::NewLine + $gpuExplain.Stderr
  if ($gpuExplain.ExitCode -ne 0) { throw "Explicit GPU family/renderer acceptance failed: $gpuReport" }
  $gpuExplainRecord = ConvertTo-ExplainRecord -Text $gpuReport
  $gpuExplainRecord | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'gpu-anchor-explain.json') -Encoding utf8
  Assert-Equal -Name 'GPU explain title' -Actual $gpuExplainRecord.title -Expected 'apostate fingerprint composition'
  Assert-ExplainField -Name 'GPU explain Chromium version' -Record $gpuExplainRecord -Field 'chromium' -Expected $chromiumVersion
  $anchorField = @($gpuExplainRecord.fields.Keys | Where-Object { $_ -match 'anchor' } | Select-Object -First 1)
  if ($anchorField.Count -eq 0) {
    Add-Check -Name 'explicit GPU family anchor in Explain' -Status 'UNVERIFIED' -Details 'No structured Explain row identifying the selected GPU anchor was present.'
  } else {
    Assert-Equal -Name 'explicit GPU family anchor in Explain' -Actual $gpuExplainRecord.fields[$anchorField[0]] -Expected 'windows-d3d11-intel-79dfeb5b4f99'
  }
  $rendererField = @($gpuExplainRecord.fields.Keys | Where-Object { $_ -match 'renderer' } | Select-Object -First 1)
  if ($rendererField.Count -eq 0) {
    Add-Check -Name 'explicit GPU renderer in Explain' -Status 'UNVERIFIED' -Details 'No structured Explain row identifying the selected renderer was present.'
  } else {
    Assert-Match -Name 'explicit GPU renderer in Explain' -Text $gpuExplainRecord.fields[$rendererField[0]] -Pattern 'UHD Graphics 630'
  }

  $hostExplain = Invoke-Apostate -Label 'host-explain' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-explain-profile')",
    '--fingerprint=host',
    '--fingerprint-explain'
  )
  $hostReport = $hostExplain.Stdout + [Environment]::NewLine + $hostExplain.Stderr
  if ($hostExplain.ExitCode -ne 0) { throw "Host --fingerprint-explain failed: $hostReport" }
  $hostExplainRecord = ConvertTo-ExplainRecord -Text $hostReport
  $hostExplainRecord | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'host-explain.json') -Encoding utf8
  Assert-Equal -Name 'host explain title' -Actual $hostExplainRecord.title -Expected 'apostate fingerprint composition'
  Assert-ExplainField -Name 'host explain Chromium version' -Record $hostExplainRecord -Field 'chromium' -Expected $chromiumVersion
  Assert-ExplainField -Name 'host explain platform' -Record $hostExplainRecord -Field 'host platform' -Expected 'windows'
  if ($hostExplainRecord.fields.Contains('composition')) {
    Assert-Equal -Name 'host mode composition state' -Actual $hostExplainRecord.fields['composition'] -Expected 'disabled'
  } else {
    Add-Check -Name 'host mode composition state' -Status 'UNVERIFIED' -Details 'Host Explain output did not expose a structured composition state.'
  }

  $hostConflict = Invoke-Apostate -Label 'host-conflict' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-conflict-profile')",
    '--fingerprint=host',
    '--fingerprint-platform=windows',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=800',
    '--fingerprint-screen-height=600',
    '--fingerprint-anchor=windows-d3d11-intel-79dfeb5b4f99',
    '--fingerprint-gpu-renderer=ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    '--fingerprint-noise',
    '--fingerprint-explain'
  )
  if ($hostConflict.ExitCode -eq 0) {
    throw 'Apostate unexpectedly accepted a combined Host plus per-field override set'
  }
  Add-Check -Name 'host mode rejects combined per-field overrides' -Status 'PASS' -Details "Rejected platform/locale/timezone/CPU/memory/screen/GPU/noise overrides together with Host mode (exit $($hostConflict.ExitCode))."

  $conflictingProfileJson = ConvertTo-Json -InputObject @{ cpu = @{ logical_cores = 2 } } -Compress
  $conflictingProfileBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($conflictingProfileJson))
  # Authored device profiles take precedence and log ignored switches. Explain
  # need not exit in this mode; test precedence through the API probe below.

  $pagePath = $script:probePagePath
  $html = @'
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Apostate runtime probe</title></head>
<body>
<script>
 (async () => {
  let webgl = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gl.clearColor(0.06, 0.45, 0.4, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixelSample = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelSample);
      webgl = {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        pixelSample: Array.from(pixelSample)
      };
    }
  } catch (_) {}
  let canvasReadback = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#0f766e";
      context.fillRect(0, 0, 16, 16);
      context.fillStyle = "#e57321";
      context.beginPath();
      context.moveTo(0.3, 0.7);
      context.lineTo(15.2, 8.4);
      context.lineTo(2.6, 15.1);
      context.fill();
      canvasReadback = {
        dataUrl: canvas.toDataURL(),
        pixelSample: Array.from(context.getImageData(0, 0, 4, 2).data)
      };
    }
  } catch (_) {}
  let userAgentData = null;
  try {
    if (navigator.userAgentData) {
      userAgentData = await navigator.userAgentData.getHighEntropyValues([
        "architecture", "bitness", "fullVersionList", "model", "platform", "platformVersion", "wow64"
      ]);
      userAgentData.brands = navigator.userAgentData.brands;
      userAgentData.mobile = navigator.userAgentData.mobile;
    }
  } catch (_) {}
  let webrtc = { available: typeof RTCPeerConnection !== "undefined", candidates: [], error: null };
  try {
    if (webrtc.available) {
      const peer = new RTCPeerConnection({ iceServers: [] });
      peer.createDataChannel("acceptance");
      peer.onicecandidate = event => {
        if (!event.candidate) return;
        const candidate = event.candidate;
        const raw = candidate.candidate || "";
        const typeMatch = raw.match(/ typ ([a-z]+)/i);
        const protocolMatch = raw.match(/^candidate:\S+ \d+ (\S+)/i);
        webrtc.candidates.push({
          type: candidate.type || (typeMatch ? typeMatch[1].toLowerCase() : null),
          protocol: candidate.protocol || (protocolMatch ? protocolMatch[1].toLowerCase() : null)
        });
      };
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise(resolve => setTimeout(resolve, 1200));
      peer.close();
    }
  } catch (error) {
    webrtc.error = String(error);
  }
  let httpRequestHeaders = null;
  try {
    const caseId = new URL(location.href).searchParams.get("case") || "default";
    const response = await fetch(`/headers?case=${encodeURIComponent(caseId)}`, { cache: "no-store" });
    httpRequestHeaders = await response.json();
  } catch (_) {}
  const payload = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    userAgentData,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    maxTouchPoints: navigator.maxTouchPoints,
    webdriver: navigator.webdriver,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      availLeft: screen.availLeft,
      availTop: screen.availTop,
      devicePixelRatio: window.devicePixelRatio,
      colorDepth: screen.colorDepth
    },
    webgl,
    canvasReadback,
    canvasReadbackLength: canvasReadback ? canvasReadback.dataUrl.length : 0,
    webrtc,
    httpRequestHeaders
  };
  document.body.textContent = "APOSTATE_RESULT:" + JSON.stringify(payload);
})();
</script>
</body>
</html>
'@
  Set-Content -LiteralPath $pagePath -Value $html -Encoding utf8
  $script:filePageUri = ([System.Uri]::new($pagePath)).AbsoluteUri
  Start-ProbeHttpServer
  $pageUri = if ($script:probeBaseUri) { $script:probeBaseUri } else { $script:filePageUri }
  $commonArgs = @('--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--window-size=1000,680', '--virtual-time-budget=5000', '--dump-dom')

  $hostRuntime = Read-RuntimeFromDom -Label 'host-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-runtime-profile')",
    '--fingerprint=host'
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'host runtime platform' -Actual $hostRuntime.platform -Expected 'Win32'
  Assert-Match -Name 'host runtime browser version' -Text $hostRuntime.userAgent -Pattern 'Chrome/155\.0\.0\.0'
  Assert-Equal -Name 'host runtime hardwareConcurrency' -Actual $hostRuntime.hardwareConcurrency -Expected $script:hostLogicalProcessors
  if ([double]$hostRuntime.deviceMemory -le ($script:hostPhysicalMemoryBytes / 1GB)) {
    Add-Check -Name 'host runtime deviceMemory within physical memory' -Status 'PASS' -Details "Observed $($hostRuntime.deviceMemory) GiB against $([Math]::Floor($script:hostPhysicalMemoryBytes / 1GB)) GiB installed."
  } else {
    Add-Check -Name 'host runtime deviceMemory within physical memory' -Status 'FAIL' -Details "Observed $($hostRuntime.deviceMemory) GiB, above physical memory."
  }

  $seedRuntime = Read-RuntimeFromDom -Label 'seed-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'seed-runtime-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=1024',
    '--fingerprint-screen-height=768',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London'
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'seed navigator.platform' -Actual $seedRuntime.platform -Expected 'Win32'
  Assert-Equal -Name 'seed navigator.hardwareConcurrency' -Actual $seedRuntime.hardwareConcurrency -Expected 2
  Assert-Equal -Name 'seed navigator.deviceMemory' -Actual $seedRuntime.deviceMemory -Expected 2
  Assert-Equal -Name 'seed navigator.language' -Actual $seedRuntime.language -Expected 'en-GB'
  if ($seedRuntime.languages -and $seedRuntime.languages[0] -eq 'en-GB') {
    Add-Check -Name 'seed navigator.languages' -Status 'PASS' -Details ($seedRuntime.languages -join ', ')
  } else {
    Add-Check -Name 'seed navigator.languages' -Status 'FAIL' -Details "Expected en-GB as the primary language; observed [$($seedRuntime.languages -join ', ')]."
  }
  Assert-Equal -Name 'seed timezone' -Actual $seedRuntime.timezone -Expected 'Europe/London'
  Assert-Equal -Name 'seed screen.width' -Actual $seedRuntime.screen.width -Expected 1024
  Assert-Equal -Name 'seed screen.height' -Actual $seedRuntime.screen.height -Expected 768
  if ($seedRuntime.userAgentData -and $seedRuntime.userAgentData.platform -eq 'Windows') {
    Add-Check -Name 'seed User-Agent Client Hints platform' -Status 'PASS' -Details ([string]$seedRuntime.userAgentData.platform)
  } else {
    Add-Check -Name 'seed User-Agent Client Hints platform' -Status 'UNVERIFIED' -Details 'navigator.userAgentData high-entropy platform was unavailable.'
  }
  if ($seedRuntime.userAgentData -and $seedRuntime.userAgentData.fullVersionList) {
    $fullVersions = @($seedRuntime.userAgentData.fullVersionList | ForEach-Object { [string]$_.version })
    if ($fullVersions -contains $chromiumVersion) {
      Add-Check -Name 'seed Client Hints full browser version' -Status 'PASS' -Details ($fullVersions -join ', ')
    } else {
      Add-Check -Name 'seed Client Hints full browser version' -Status 'FAIL' -Details "Expected $chromiumVersion in fullVersionList; observed $($fullVersions -join ', ')."
    }
  } else {
    Add-Check -Name 'seed Client Hints full browser version' -Status 'UNVERIFIED' -Details 'fullVersionList was not exposed by navigator.userAgentData.'
  }
  if ($seedRuntime.canvasReadbackLength -gt 0 -and $seedRuntime.canvasReadback.pixelSample.Count -gt 0) {
    Add-Check -Name 'seed Canvas 2D render and pixel readback' -Status 'PASS' -Details "data URL length $($seedRuntime.canvasReadbackLength); sample $($seedRuntime.canvasReadback.pixelSample -join ',')."
  } else {
    throw 'Seed mode did not return Canvas 2D data URL and pixel readback'
  }
  if ($seedRuntime.webgl -and -not [string]::IsNullOrWhiteSpace([string]$seedRuntime.webgl.renderer)) {
    Add-Check -Name 'seed WebGL readback' -Status 'PASS' -Details ([string]$seedRuntime.webgl.renderer)
  } else {
    Add-Check -Name 'seed WebGL readback' -Status 'BLOCKED' -Details 'Headless hosted runner exposed no WebGL renderer; headed GPU validation remains required.'
  }
  if ($seedRuntime.webrtc -and $seedRuntime.webrtc.available) {
    $candidateTypes = @($seedRuntime.webrtc.candidates | ForEach-Object { $_.type } | Where-Object { $_ } | Sort-Object -Unique)
    Add-Check -Name 'seed WebRTC ICE candidates observed' -Status 'INFO' -Details "Candidate types: $($candidateTypes -join ', '); count $(@($seedRuntime.webrtc.candidates).Count). Candidate addresses are intentionally omitted from CI output."
    Add-Check -Name 'seed WebRTC external leak path' -Status 'UNVERIFIED' -Details 'No controlled STUN/TURN endpoint was used; local host candidates alone cannot prove the absence of a public UDP leak.'
  } else {
    Add-Check -Name 'seed WebRTC ICE candidates observed' -Status 'BLOCKED' -Details 'RTCPeerConnection was unavailable in the hosted headless runtime.'
  }

  $proxyOnlyRuntime = Read-RuntimeFromDom -Label 'proxy-only-webrtc-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'proxy-only-webrtc-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-webrtc-udp=block'
  ) + $commonArgs + @($pageUri))
  if ($proxyOnlyRuntime.webrtc -and $proxyOnlyRuntime.webrtc.available) {
    $proxyOnlyCandidateTypes = @($proxyOnlyRuntime.webrtc.candidates | ForEach-Object { $_.type } | Where-Object { $_ } | Sort-Object -Unique)
    Add-Check -Name 'proxy_only WebRTC candidate sample captured' -Status 'INFO' -Details "Candidate types under UDP block: $($proxyOnlyCandidateTypes -join ', '); count $(@($proxyOnlyRuntime.webrtc.candidates).Count)."
    Add-Check -Name 'proxy_only WebRTC external leak path' -Status 'UNVERIFIED' -Details 'A no-STUN local candidate sample cannot prove no public UDP path; a controlled STUN/TURN endpoint is required.'
  } else {
    Add-Check -Name 'proxy_only WebRTC candidate sample captured' -Status 'BLOCKED' -Details 'RTCPeerConnection was unavailable for the UDP-block run.'
  }

  $seedRepeatRuntime = Read-RuntimeFromDom -Label 'seed-repeat-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'seed-repeat-runtime-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=1024',
    '--fingerprint-screen-height=768',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London'
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'same-seed navigator.platform determinism' -Actual $seedRepeatRuntime.platform -Expected $seedRuntime.platform
  Assert-Equal -Name 'same-seed User-Agent determinism' -Actual $seedRepeatRuntime.userAgent -Expected $seedRuntime.userAgent
  Assert-Equal -Name 'same-seed CPU determinism' -Actual $seedRepeatRuntime.hardwareConcurrency -Expected $seedRuntime.hardwareConcurrency
  Assert-Equal -Name 'same-seed memory determinism' -Actual $seedRepeatRuntime.deviceMemory -Expected $seedRuntime.deviceMemory
  Assert-Equal -Name 'same-seed screen determinism' -Actual "$($seedRepeatRuntime.screen.width)x$($seedRepeatRuntime.screen.height)" -Expected "$($seedRuntime.screen.width)x$($seedRuntime.screen.height)"
  Assert-Equal -Name 'same-seed locale/timezone determinism' -Actual "$($seedRepeatRuntime.language)/$($seedRepeatRuntime.timezone)" -Expected "$($seedRuntime.language)/$($seedRuntime.timezone)"

  $changedSeedRuntime = Read-RuntimeFromDom -Label 'changed-seed-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'changed-seed-runtime-profile')",
    '--fingerprint=43',
    '--fingerprint-platform=windows',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=1024',
    '--fingerprint-screen-height=768',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London'
  ) + $commonArgs + @($pageUri))
  $seedDelta = [ordered]@{
    seed42 = [ordered]@{ platform = $seedRuntime.platform; hardwareConcurrency = $seedRuntime.hardwareConcurrency; deviceMemory = $seedRuntime.deviceMemory; webgl = $seedRuntime.webgl }
    seed43 = [ordered]@{ platform = $changedSeedRuntime.platform; hardwareConcurrency = $changedSeedRuntime.hardwareConcurrency; deviceMemory = $changedSeedRuntime.deviceMemory; webgl = $changedSeedRuntime.webgl }
  }
  $seedDelta | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:evidenceRoot 'seed-determinism.json') -Encoding utf8
  Add-Check -Name 'changed seed runtime comparison captured' -Status 'INFO' -Details 'Seed 43 launched successfully; values are retained alongside seed 42 without assuming host/GPU-dependent surfaces must differ.'

  $cpuEqualRuntime = Read-RuntimeFromDom -Label 'cpu-equal-host-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'cpu-equal-host-profile')",
    '--fingerprint=42',
    "--fingerprint-hardware-concurrency=$script:hostLogicalProcessors"
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'CPU request equal to host' -Actual $cpuEqualRuntime.hardwareConcurrency -Expected $script:hostLogicalProcessors

  $cpuOverHostResult = Invoke-Apostate -Label 'cpu-over-host-runtime' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'cpu-over-host-profile')",
    '--fingerprint=42',
    "--fingerprint-hardware-concurrency=$($script:hostLogicalProcessors + 4)",
    '--fingerprint-explain'
  )
  Assert-Equal -Name 'raw CPU above host is refused' -Actual $cpuOverHostResult.ExitCode -Expected 1

  $invalidCpu = Invoke-Apostate -Label 'cpu-invalid-zero' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'cpu-invalid-profile')",
    '--fingerprint=42',
    '--fingerprint-hardware-concurrency=0',
    '--fingerprint-explain'
  )
  if ($invalidCpu.ExitCode -eq 0) {
    Add-Check -Name 'CPU invalid zero rejected' -Status 'FAIL' -Details 'Apostate accepted --fingerprint-hardware-concurrency=0.'
  } else {
    Add-Check -Name 'CPU invalid zero rejected' -Status 'PASS' -Details "Rejected zero with exit code $($invalidCpu.ExitCode)."
  }

  $memoryRequestGb = [Math]::Ceiling($script:hostPhysicalMemoryBytes / 1GB) + 8
  $memoryOverHostResult = Invoke-Apostate -Label 'memory-over-host-runtime' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'memory-over-host-profile')",
    '--fingerprint=42',
    "--fingerprint-device-memory=$memoryRequestGb",
    '--fingerprint-explain'
  )
  Assert-Equal -Name 'raw memory above host is refused' -Actual $memoryOverHostResult.ExitCode -Expected 1

  $acceptLanguageHeader = [string]$seedRuntime.httpRequestHeaders.acceptLanguage
  if ($acceptLanguageHeader -match '^en-GB(?:,|$)') {
    Add-Check -Name 'HTTP Accept-Language request header' -Status 'PASS' -Details "Observed [$acceptLanguageHeader] from the actual loopback HTTP request."
  } elseif (-not [string]::IsNullOrWhiteSpace($acceptLanguageHeader)) {
    Add-Check -Name 'HTTP Accept-Language request header' -Status 'FAIL' -Details "Expected en-GB as the primary language; observed [$acceptLanguageHeader]."
  } else {
    Add-Check -Name 'HTTP Accept-Language request header' -Status 'UNVERIFIED' -Details 'No Accept-Language header was returned by the local probe server.'
  }

  $noiseRuntime = Read-RuntimeFromDom -Label 'seed-noise-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'seed-noise-runtime-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=1024',
    '--fingerprint-screen-height=768',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London',
    '--fingerprint-noise'
  ) + $commonArgs + @($pageUri))
  $canvasNoiseChanged = $false
  if ($noiseRuntime.canvasReadback -and $seedRuntime.canvasReadback) {
    $canvasNoiseChanged = $noiseRuntime.canvasReadback.dataUrl -ne $seedRuntime.canvasReadback.dataUrl
    $pixelDifferences = @(Compare-Object -ReferenceObject $seedRuntime.canvasReadback.pixelSample -DifferenceObject $noiseRuntime.canvasReadback.pixelSample)
    $canvasNoiseChanged = $canvasNoiseChanged -or ($pixelDifferences.Count -gt 0)
  }
  if ($canvasNoiseChanged) {
    Add-Check -Name 'Canvas noise changes readback' -Status 'PASS' -Details 'Same seed and render input produced different Canvas output with --fingerprint-noise enabled.'
  } elseif ($noiseRuntime.canvasReadback) {
    Add-Check -Name 'Canvas noise changes readback' -Status 'FAIL' -Details 'The tested Canvas readback was unchanged when --fingerprint-noise was enabled.'
  } else {
    Add-Check -Name 'Canvas noise changes readback' -Status 'UNVERIFIED' -Details 'Noise-enabled run returned no Canvas readback.'
  }
  if ($seedRuntime.webgl.pixelSample -and $noiseRuntime.webgl.pixelSample) {
    $webglNoiseChanged = (ConvertTo-Json -InputObject $seedRuntime.webgl.pixelSample -Compress) -ne (ConvertTo-Json -InputObject $noiseRuntime.webgl.pixelSample -Compress)
    if ($webglNoiseChanged) {
      Add-Check -Name 'WebGL noise changes readPixels' -Status 'PASS' -Details 'The same WebGL clear/readPixels operation returned different bytes with noise enabled.'
    } else {
      Add-Check -Name 'WebGL noise changes readPixels' -Status 'UNVERIFIED' -Details 'The simple clear/readPixels sample was unchanged; this does not prove all WebGL readback surfaces are unaffected.'
    }
  } else {
    Add-Check -Name 'WebGL noise changes readPixels' -Status 'BLOCKED' -Details 'A WebGL framebuffer readback was unavailable in one or both headless runs.'
  }

  $gpuRuntime = Read-RuntimeFromDom -Label 'gpu-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'gpu-runtime-profile')",
    '--fingerprint=42',
    '--fingerprint-platform=windows',
    '--fingerprint-hardware-concurrency=2',
    '--fingerprint-device-memory=2',
    '--fingerprint-screen-width=1024',
    '--fingerprint-screen-height=768',
    '--fingerprint-locale=en-GB',
    '--fingerprint-timezone=Europe/London',
    '--fingerprint-anchor=windows-d3d11-intel-79dfeb5b4f99',
    '--fingerprint-gpu-renderer=ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  ) + $commonArgs + @($pageUri))
  if ($gpuRuntime.webgl -and -not [string]::IsNullOrWhiteSpace([string]$gpuRuntime.webgl.renderer)) {
    Assert-Equal -Name 'GPU anchor WebGL renderer' -Actual ([string]$gpuRuntime.webgl.renderer) -Expected 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)'
    Add-Check -Name 'GPU anchor WebGL vendor' -Status 'INFO' -Details ([string]$gpuRuntime.webgl.vendor)
  } else {
    Add-Check -Name 'GPU anchor WebGL renderer' -Status 'BLOCKED' -Details 'Headless hosted runner exposed no WebGL renderer; headed GPU validation remains required.'
  }

  $profile = [ordered]@{
    cpu = @{ logical_cores = 2 }
    memory = @{ total_bytes = 2147483648 }
    screen = @{
      width = 1024
      height = 768
      avail_width = 1024
      avail_height = 720
      device_pixel_ratio = 1
      color_depth = 24
    }
    locale = @{ application = 'en-GB'; timezone = 'Europe/London' }
  }
  $profileJson = ConvertTo-Json -InputObject $profile -Depth 10 -Compress
  $profileBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($profileJson))
  $customRuntime = Read-RuntimeFromDom -Label 'custom-profile-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'custom-profile-runtime')",
    "--apostate-profile=$profileBase64"
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'custom profile navigator.hardwareConcurrency' -Actual $customRuntime.hardwareConcurrency -Expected 2
  Assert-Equal -Name 'custom profile navigator.deviceMemory' -Actual $customRuntime.deviceMemory -Expected 2
  Assert-Equal -Name 'custom profile navigator.language' -Actual $customRuntime.language -Expected 'en-GB'
  Assert-Equal -Name 'custom profile timezone' -Actual $customRuntime.timezone -Expected 'Europe/London'
  Assert-Equal -Name 'custom profile screen.width' -Actual $customRuntime.screen.width -Expected 1024
  Assert-Equal -Name 'custom profile screen.height' -Actual $customRuntime.screen.height -Expected 768
  Assert-Equal -Name 'custom profile screen.availWidth' -Actual $customRuntime.screen.availWidth -Expected 1024
  Assert-Equal -Name 'custom profile screen.availHeight' -Actual $customRuntime.screen.availHeight -Expected 720
  Assert-Equal -Name 'custom profile devicePixelRatio' -Actual $customRuntime.screen.devicePixelRatio -Expected 1
  Assert-Equal -Name 'custom profile inherits host platform' -Actual $customRuntime.platform -Expected $hostRuntime.platform
  Assert-Equal -Name 'custom profile inherits host User-Agent' -Actual $customRuntime.userAgent -Expected $hostRuntime.userAgent

  if ($customRuntime.canvasReadbackLength -gt 0) {
    Add-Check -Name 'custom profile Canvas readback' -Status 'PASS' -Details "data URL length $($customRuntime.canvasReadbackLength)"
  } else {
    throw 'Custom Profile mode did not return a Canvas 2D readback'
  }
  if ($customRuntime.webgl -and -not [string]::IsNullOrWhiteSpace([string]$customRuntime.webgl.renderer)) {
    Add-Check -Name 'custom profile WebGL readback' -Status 'PASS' -Details ([string]$customRuntime.webgl.renderer)
  } else {
    Add-Check -Name 'custom profile WebGL readback' -Status 'BLOCKED' -Details 'Headless hosted runner exposed no WebGL renderer; headed GPU validation remains required.'
  }

  $partialProfileJson = ConvertTo-Json -InputObject @{ cpu = @{ logical_cores = 2 } } -Compress
  $partialProfileBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($partialProfileJson))
  $partialProfileRuntime = Read-RuntimeFromDom -Label 'partial-profile-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'partial-profile-runtime-profile')",
    "--apostate-profile=$partialProfileBase64"
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'partial profile explicit CPU' -Actual $partialProfileRuntime.hardwareConcurrency -Expected 2
  $customProfileConflict = Read-RuntimeFromDom -Label 'custom-profile-conflict' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'custom-profile-conflict-profile')",
    "--apostate-profile=$conflictingProfileBase64",
    '--fingerprint=42',
    '--fingerprint-platform=macos',
    '--fingerprint-hardware-concurrency=1'
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'custom profile takes precedence over seed CPU' -Actual $customProfileConflict.hardwareConcurrency -Expected 2
  Assert-Equal -Name 'custom profile ignores seed platform' -Actual $customProfileConflict.platform -Expected $hostRuntime.platform
  Assert-Equal -Name 'partial profile inherits host memory' -Actual $partialProfileRuntime.deviceMemory -Expected $hostRuntime.deviceMemory
  Assert-Equal -Name 'partial profile inherits host platform' -Actual $partialProfileRuntime.platform -Expected $hostRuntime.platform
  Assert-Equal -Name 'partial profile inherits host User-Agent' -Actual $partialProfileRuntime.userAgent -Expected $hostRuntime.userAgent
  Assert-Equal -Name 'partial profile inherits host screen' -Actual "$($partialProfileRuntime.screen.width)x$($partialProfileRuntime.screen.height)" -Expected "$($hostRuntime.screen.width)x$($hostRuntime.screen.height)"
  Assert-Equal -Name 'partial profile inherits host locale/timezone' -Actual "$($partialProfileRuntime.language)/$($partialProfileRuntime.timezone)" -Expected "$($hostRuntime.language)/$($hostRuntime.timezone)"
  if ($partialProfileRuntime.webgl -and $hostRuntime.webgl) {
    Assert-Equal -Name 'partial profile inherits host WebGL renderer' -Actual $partialProfileRuntime.webgl.renderer -Expected $hostRuntime.webgl.renderer
  } else {
    Add-Check -Name 'partial profile inherits host WebGL renderer' -Status 'BLOCKED' -Details 'The hosted headless runtime did not expose WebGL in both runs.'
  }

  $failedChecks = @($script:checks | Where-Object { $_.status -eq 'FAIL' })
  if ($failedChecks.Count -gt 0) {
    throw "Acceptance has $($failedChecks.Count) failed check(s): $(($failedChecks | ForEach-Object name) -join ', ')"
  }
  Add-Check -Name 'runtime acceptance summary' -Status 'PASS' -Details 'Official binary and runtime checks completed; any BLOCKED or UNVERIFIED surfaces remain explicitly listed.'
} catch {
  $script:fatalMessage = $_.Exception.Message
  Add-Check -Name 'fatal acceptance failure' -Status 'FAIL' -Details $_.Exception.Message
  throw
} finally {
  Stop-SxsTrace
  if ($script:probeServerProcess -and -not $script:probeServerProcess.HasExited) {
    Stop-Process -Id $script:probeServerProcess.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $script:probeServerProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
  }
  if ($script:sideBySideEvents.Count -eq 0) { Capture-SideBySideEvents }
  if ($null -eq $hostRuntime) {
    $notReached = @(
      @{ name = 'runtime Host/Seed/Custom Profile fingerprintExplain'; details = 'The real binary did not reach fingerprint-explain checks.' },
      @{ name = 'runtime CPU boundary and deterministic seed matrix'; details = 'Host/equal/over-host CPU and repeated/changed seed API checks did not run.' },
      @{ name = 'runtime memory clamp and bucket behavior'; details = 'Browser API evidence for configured versus effective device memory was not produced.' },
      @{ name = 'runtime screen, locale, timezone and HTTP headers'; details = 'Browser API and HTTP request evidence was not produced.' },
      @{ name = 'runtime GPU, WebGL, Canvas and noise'; details = 'The real runtime did not reach GPU or pixel-readback checks.' },
      @{ name = 'runtime WebRTC network path'; details = 'ICE candidate and controlled UDP path checks did not run.' }
    )
    foreach ($item in $notReached) {
      if (-not ($script:checks | Where-Object { $_.name -eq $item.name })) {
        Add-Check -Name $item.name -Status 'UNVERIFIED' -Details $item.details
      }
    }
  }
  $measurement = [ordered]@{
    host = [ordered]@{
      requestedValue = '--fingerprint=host'
      effectiveValue = $hostRuntime
      constraint = 'Host mode must expose the actual host values and must not apply seed or field overrides.'
      status = Get-CheckStatus -Name 'host runtime platform'
      evidence = 'runtime.host; logs/host-runtime.*'
    }
    seed = [ordered]@{
      requestedValue = '--fingerprint=42 with Windows/en-GB/Europe-London and explicit CPU, memory, and screen values'
      effectiveValue = $seedRuntime
      constraint = 'Apostate composition is constrained by the real host CPU/memory and documented Chromium bucketing.'
      status = Get-CheckStatus -Name 'seed navigator.language'
      evidence = 'runtime.seed; seed-explain.json; logs/seed-runtime.*'
    }
    cpu = [ordered]@{
      requestedValue = [ordered]@{ belowHost = 2; equalHost = $script:hostLogicalProcessors; aboveHost = if ($null -ne $script:hostLogicalProcessors) { $script:hostLogicalProcessors + 4 } else { $null } }
      effectiveValue = [ordered]@{ belowHost = $seedRuntime.hardwareConcurrency; equalHost = $cpuEqualRuntime.hardwareConcurrency; aboveHost = $cpuOverHostRuntime.hardwareConcurrency }
      constraint = 'Raw switches above host logical processors are refused; application clamp is tested separately by local.mjs; zero is rejected.'
      status = Get-CheckStatus -Name 'raw CPU above host is refused'
      evidence = 'runtime.seed, runtime.cpuEqualHost, runtime.cpuOverHost, seed-determinism.json'
    }
    deviceMemory = [ordered]@{
      requestedValue = [ordered]@{ configured = 2; aboveHost = if ($null -ne $script:hostPhysicalMemoryBytes) { [Math]::Ceiling($script:hostPhysicalMemoryBytes / 1GB) + 8 } else { $null } }
      effectiveValue = [ordered]@{ configured = $seedRuntime.deviceMemory; aboveHost = $memoryOverHostRuntime.deviceMemory }
      constraint = 'Application host cap and Chromium API bucket are distinct; report the page-observed value, not just the switch.'
      status = Get-CheckStatus -Name 'raw memory above host is refused'
      evidence = 'runtime.seed.deviceMemory; runtime.memoryOverHost.deviceMemory'
    }
    customProfile = [ordered]@{
      requestedValue = 'v3 profile: CPU=2, memory=2 GiB, 1024x768, en-GB, Europe/London'
      effectiveValue = $customRuntime
      constraint = 'Only authored fields are set; omitted platform and User-Agent inherit the host. Explain does not report authored profiles.'
      status = Get-CheckStatus -Name 'custom profile navigator.hardwareConcurrency'
      evidence = 'runtime.customProfile; logs/custom-profile-runtime.*'
    }
    partialProfileInheritance = [ordered]@{
      requestedValue = 'v3 profile with CPU=2 only'
      effectiveValue = $partialProfileRuntime
      constraint = 'CPU is explicit; memory, platform, User-Agent, screen, locale, timezone and GPU inherit host values.'
      status = Get-CheckStatus -Name 'partial profile inherits host screen'
      evidence = 'runtime.partialProfile; logs/partial-profile-runtime.*'
    }
    gpu = [ordered]@{
      requestedValue = 'windows-d3d11-intel-79dfeb5b4f99 and the explicit UHD Graphics 630 renderer'
      effectiveValue = $gpuRuntime.webgl
      constraint = 'The selected anchor and renderer must be confirmed by page WebGL, not merely by launch arguments.'
      status = Get-CheckStatus -Name 'GPU anchor WebGL renderer'
      evidence = 'runtime.gpu.webgl; gpu-anchor-explain.json; logs/gpu-runtime.*'
    }
    canvasNoise = [ordered]@{
      requestedValue = 'Noise disabled by default; enabled with --fingerprint-noise for the comparison run'
      effectiveValue = [ordered]@{ baseline = $seedRuntime.canvasReadback; noiseEnabled = $noiseRuntime.canvasReadback }
      constraint = 'Normal Canvas rendering and noise-induced readback changes are separate checks.'
      status = Get-CheckStatus -Name 'Canvas noise changes readback'
      evidence = 'runtime.seed.canvasReadback and runtime.noise.canvasReadback'
    }
    webglNoise = [ordered]@{
      requestedValue = '--fingerprint-noise disabled versus enabled'
      effectiveValue = [ordered]@{ baseline = $seedRuntime.webgl.pixelSample; noiseEnabled = $noiseRuntime.webgl.pixelSample }
      constraint = 'A matching clear/readPixels sample is compared; unchanged sample is not generalized to all WebGL surfaces.'
      status = Get-CheckStatus -Name 'WebGL noise changes readPixels'
      evidence = 'runtime.seed.webgl.pixelSample; runtime.noise.webgl.pixelSample'
    }
    acceptLanguage = [ordered]@{
      requestedValue = 'en-GB'
      effectiveValue = $seedRuntime.httpRequestHeaders
      constraint = 'Must be read from an actual HTTP request; navigator.language alone is not proof.'
      status = Get-CheckStatus -Name 'HTTP Accept-Language request header'
      evidence = 'runtime.seed.httpRequestHeaders; http-headers.json'
    }
    webRTC = [ordered]@{
      requestedValue = [ordered]@{ default = 'kernel default'; proxyOnly = '--fingerprint-webrtc-udp=block' }
      effectiveValue = [ordered]@{ default = $seedRuntime.webrtc; proxyOnly = $proxyOnlyRuntime.webrtc }
      constraint = 'A local ICE candidate sample cannot establish the absence of a public UDP leak without a controlled STUN/TURN path.'
      status = Get-CheckStatus -Name 'proxy_only WebRTC external leak path'
      evidence = 'runtime.seed.webrtc; runtime.proxyOnly.webrtc; candidate addresses omitted'
    }
  }
  $sourceCommit = $env:GITHUB_SHA
  $sourceBranch = $env:GITHUB_REF_NAME
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  if ([string]::IsNullOrWhiteSpace($sourceCommit)) {
    $sourceCommit = (& git -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
    $sourceBranch = (& git -C $repoRoot branch --show-current 2>$null | Select-Object -First 1)
  }
  $sourceChanges = @(& git -C $repoRoot status --porcelain 2>$null)
  $acceptanceScriptHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'run.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()
  $probeServerHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'probe-server.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
  $evidenceIndex = @(
    Get-ChildItem -LiteralPath $script:evidenceRoot -File -Recurse |
      ForEach-Object { [IO.Path]::GetRelativePath($script:evidenceRoot, $_.FullName).Replace('\', '/') }
  ) + @('evidence.json')
  $evidence = [ordered]@{
    schemaVersion = 2
    runId = $script:runId
    startedAtUtc = $script:acceptanceStartedAt.ToUniversalTime().ToString('o')
    completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    sourceCommit = ([string]$sourceCommit).Trim()
    sourceBranch = ([string]$sourceBranch).Trim()
    sourceWorktreeDirty = ($sourceChanges.Count -gt 0)
    sourceChangedPaths = @($sourceChanges | ForEach-Object { ([string]$_).Substring(3).Trim() })
    acceptanceScriptSha256 = $acceptanceScriptHash
    probeServerSha256 = $probeServerHash
    release = $releaseTag
    chromiumVersionExpected = $chromiumVersion
    chromiumVersionObserved = $binaryVersion
    assetUrl = $assetUrl
    archiveSource = $script:archiveSource
    expectedSha256 = $expectedSha256
    observedSha256 = $assetHash
    executable = $script:chromePath
    runtimeRoot = $script:runtimeRoot
    archive = [ordered]@{
      versionManifestStatus = $script:archiveManifestStatus
      versionManifestEntries = @($script:versionManifestEntries)
      entries = @($script:archiveEntries)
    }
    sxsDiagnostics = [ordered]@{
      embeddedManifestPath = if (Test-Path -LiteralPath $script:embeddedManifestPath) { 'chrome-embedded.manifest' } else { $null }
      traceStatus = $script:sxsTraceStatus
      tracePath = if (Test-Path -LiteralPath $script:sxsTracePath) { 'sxstrace.etl' } else { $null }
      parsedTracePath = if (Test-Path -LiteralPath $script:sxsTraceTextPath) { 'sxstrace.txt' } else { $null }
      sideBySideEvents = @($script:sideBySideEvents)
    }
    probeServer = [ordered]@{
      script = 'probe-server.mjs'
      httpHeadersPath = if (Test-Path -LiteralPath $script:httpHeadersPath) { 'http-headers.json' } else { $null }
      state = if ($script:probeServerProcess) { if ($script:probeServerProcess.HasExited) { 'STOPPED' } else { 'RUNNING' } } else { 'NOT_STARTED' }
    }
    arguments = @($script:rawArguments)
    fatalMessage = $script:fatalMessage
    measurement = $measurement
    checks = @($script:checks)
    reports = [ordered]@{ seedExplain = $seedReport; hostExplain = $hostReport; gpuExplain = $gpuReport }
    runtime = [ordered]@{
      host = $hostRuntime
      seed = $seedRuntime
      seedRepeat = $seedRepeatRuntime
      changedSeed = $changedSeedRuntime
      cpuEqualHost = $cpuEqualRuntime
      cpuOverHost = $cpuOverHostRuntime
      memoryOverHost = $memoryOverHostRuntime
      noise = $noiseRuntime
      proxyOnlyWebrtc = $proxyOnlyRuntime
      gpu = $gpuRuntime
      customProfile = $customRuntime
      partialProfile = $partialProfileRuntime
    }
    evidenceIndex = $evidenceIndex
  }
  $evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $script:evidencePath -Encoding utf8
}
