$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$releaseTag = 'v0.5.1'
$chromiumVersion = '155.0.8059.31'
$assetUrl = 'https://github.com/heretic-tech/apostate/releases/download/v0.5.1/apostate-155.0.8059.31-windows-x64.zip'
$expectedSha256 = '8e55e44fb7f58619461e1d42a947446dcc08a2b46493c420c8e62ae27ab9c7e5'
$tempBase = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($tempBase)) { $tempBase = [System.IO.Path]::GetTempPath() }
$script:workRoot = Join-Path $tempBase 'apostate-native-acceptance'
$script:evidencePath = Join-Path $script:workRoot 'evidence.json'
$script:checks = [System.Collections.Generic.List[object]]::new()
$script:chromePath = $null
$assetHash = $null
$binaryVersion = $null
$hostRuntime = $null
$seedRuntime = $null
$customRuntime = $null
$gpuRuntime = $null

New-Item -ItemType Directory -Path $script:workRoot -Force | Out-Null

function Add-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL', 'BLOCKED', 'INFO')][string]$Status,
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

function Invoke-Apostate {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$TimeoutSeconds = 45
  )
  $stdoutPath = Join-Path $script:workRoot "$Label.stdout.txt"
  $stderrPath = Join-Path $script:workRoot "$Label.stderr.txt"
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
    $sideBySideEvents = @()
    try {
      $sideBySideEvents = @(Get-WinEvent -FilterHashtable @{
        LogName = 'Application'
        ProviderName = 'SideBySide'
        StartTime = (Get-Date).AddMinutes(-5)
      } -MaxEvents 5 -ErrorAction SilentlyContinue | ForEach-Object { $_.Message })
    } catch {}
    $manifestFiles = @()
    try {
      $manifestFiles = @(Get-ChildItem -LiteralPath (Split-Path -Parent $script:chromePath) -Filter '*.manifest' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    } catch {}
    $details = "Start error: $startMessage; SideBySide events: $($sideBySideEvents -join ' || '); adjacent manifests: $($manifestFiles -join ', ')"
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
  $result = Invoke-Apostate -Label $Label -Arguments $Arguments -TimeoutSeconds 45
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
  $archive = Join-Path $script:workRoot 'apostate-v0.5.1-windows-x64.zip'
  $extractRoot = Join-Path $script:workRoot 'runtime'
  Invoke-WebRequest -Uri $assetUrl -OutFile $archive
  $assetHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Equal -Name 'official release SHA-256' -Actual $assetHash -Expected $expectedSha256

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
  Add-Check -Name 'runtime layout' -Status 'PASS' -Details "Found complete runtime at $script:chromePath"

  $versionResult = Invoke-Apostate -Label 'version' -Arguments @('--version')
  $versionText = $versionResult.Stdout + [Environment]::NewLine + $versionResult.Stderr
  if ($versionResult.ExitCode -ne 0) { throw "chrome.exe --version failed: $versionText" }
  Assert-Match -Name 'Chromium build version' -Text $versionText -Pattern '155\.0\.8059\.31'
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
  Assert-Match -Name 'seed explain report' -Text $seedReport -Pattern 'apostate fingerprint composition'
  Assert-Match -Name 'seed explain version' -Text $seedReport -Pattern '155\.0\.8059\.31'

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
  Assert-Match -Name 'explicit GPU family anchor' -Text $gpuReport -Pattern 'windows-d3d11-intel-79dfeb5b4f99'
  Assert-Match -Name 'explicit GPU renderer' -Text $gpuReport -Pattern 'UHD Graphics 630'

  $hostExplain = Invoke-Apostate -Label 'host-explain' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-explain-profile')",
    '--fingerprint=host',
    '--fingerprint-explain'
  )
  $hostReport = $hostExplain.Stdout + [Environment]::NewLine + $hostExplain.Stderr
  if ($hostExplain.ExitCode -ne 0) { throw "Host --fingerprint-explain failed: $hostReport" }
  Assert-Match -Name 'host mode explain report' -Text $hostReport -Pattern '(?im)^\s*composition\s+disabled\b'

  $hostConflict = Invoke-Apostate -Label 'host-conflict' -Arguments @(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-conflict-profile')",
    '--fingerprint=host',
    '--fingerprint-platform=windows',
    '--fingerprint-explain'
  )
  if ($hostConflict.ExitCode -eq 0) {
    throw 'Apostate unexpectedly accepted --fingerprint-platform together with --fingerprint=host'
  }
  Add-Check -Name 'host mode rejects per-field platform override' -Status 'PASS' -Details "Rejected conflicting flags with exit code $($hostConflict.ExitCode)"

  $pagePath = Join-Path $script:workRoot 'runtime-probe.html'
  $html = @'
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Apostate runtime probe</title></head>
<body>
<script>
(() => {
  let webgl = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      webgl = {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      };
    }
  } catch (_) {}
  let canvasReadbackLength = 0;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#0f766e";
      context.fillRect(0, 0, 16, 16);
      canvasReadbackLength = canvas.toDataURL().length;
    }
  } catch (_) {}
  const payload = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      devicePixelRatio: window.devicePixelRatio,
      colorDepth: screen.colorDepth
    },
    webgl,
    canvasReadbackLength
  };
  document.body.textContent = "APOSTATE_RESULT:" + JSON.stringify(payload);
})();
</script>
</body>
</html>
'@
  Set-Content -LiteralPath $pagePath -Value $html -Encoding utf8
  $pageUri = ([System.Uri]::new($pagePath)).AbsoluteUri
  $commonArgs = @('--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--window-size=1000,680', '--dump-dom')

  $hostRuntime = Read-RuntimeFromDom -Label 'host-runtime' -Arguments (@(
    "--user-data-dir=$(Join-Path $script:workRoot 'host-runtime-profile')",
    '--fingerprint=host'
  ) + $commonArgs + @($pageUri))
  Assert-Equal -Name 'host runtime platform' -Actual $hostRuntime.platform -Expected 'Win32'
  Assert-Match -Name 'host runtime browser version' -Text $hostRuntime.userAgent -Pattern 'Chrome/155\.0\.0\.0'

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
  Assert-Equal -Name 'seed timezone' -Actual $seedRuntime.timezone -Expected 'Europe/London'
  Assert-Equal -Name 'seed screen.width' -Actual $seedRuntime.screen.width -Expected 1024
  Assert-Equal -Name 'seed screen.height' -Actual $seedRuntime.screen.height -Expected 768
  if ($seedRuntime.canvasReadbackLength -gt 0) {
    Add-Check -Name 'seed Canvas readback' -Status 'PASS' -Details "data URL length $($seedRuntime.canvasReadbackLength)"
  } else {
    throw 'Seed mode did not return a Canvas 2D readback'
  }
  if ($seedRuntime.webgl -and -not [string]::IsNullOrWhiteSpace([string]$seedRuntime.webgl.renderer)) {
    Add-Check -Name 'seed WebGL readback' -Status 'PASS' -Details ([string]$seedRuntime.webgl.renderer)
  } else {
    Add-Check -Name 'seed WebGL readback' -Status 'BLOCKED' -Details 'Headless hosted runner exposed no WebGL renderer; headed GPU validation remains required.'
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
    Assert-Match -Name 'GPU anchor WebGL renderer' -Text ([string]$gpuRuntime.webgl.renderer) -Pattern 'UHD Graphics 630'
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

  Add-Check -Name 'runtime acceptance summary' -Status 'PASS' -Details 'Official binary, host mode, seed mode, schema-validated custom profile and JavaScript readback checks completed.'
} catch {
  Add-Check -Name 'fatal acceptance failure' -Status 'FAIL' -Details $_.Exception.Message
  throw
} finally {
  $evidence = [ordered]@{
    release = $releaseTag
    chromiumVersionExpected = $chromiumVersion
    chromiumVersionObserved = $binaryVersion
    assetUrl = $assetUrl
    expectedSha256 = $expectedSha256
    observedSha256 = $assetHash
    executable = $script:chromePath
    checks = @($script:checks)
    reports = [ordered]@{ seedExplain = $seedReport; hostExplain = $hostReport; gpuExplain = $gpuReport }
    runtime = [ordered]@{ host = $hostRuntime; seed = $seedRuntime; gpu = $gpuRuntime; customProfile = $customRuntime }
  }
  $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $script:evidencePath -Encoding utf8
}
