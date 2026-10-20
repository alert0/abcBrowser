param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DevArgs
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $ProjectRoot

function Find-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    return $null
}

$NodePath = Find-CommandPath 'node'
if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (!(Test-Path -LiteralPath $NodePath)) {
    throw 'Node.js was not found. Install Node.js 24+ or add node.exe to PATH.'
}

$NodeDirectory = Split-Path -Parent $NodePath
if (-not (($env:Path -split ';') -contains $NodeDirectory)) {
    $env:Path = "$NodeDirectory;$env:Path"
}

$ElectronVitePath = Join-Path $ProjectRoot 'node_modules\electron-vite\bin\electron-vite.js'
$ElectronInstallPath = Join-Path $ProjectRoot 'node_modules\electron\install.js'
$ElectronBinaryPath = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'

function Install-ProjectDependencies {
    Write-Host 'Project dependencies were not found. Installing...' -ForegroundColor Yellow

    $NpmPath = Find-CommandPath 'npm'
    if (![string]::IsNullOrWhiteSpace($NpmPath)) {
        & $NpmPath ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE"
        }
        return
    }

    $PnpmPath = Find-CommandPath 'pnpm'
    if ([string]::IsNullOrWhiteSpace($PnpmPath)) {
        $PnpmPath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
    }

    if (!(Test-Path -LiteralPath $PnpmPath)) {
        throw 'Neither npm nor pnpm was found. Install Node.js or run npm ci first.'
    }

    & $PnpmPath install --lockfile=false
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed with exit code $LASTEXITCODE"
    }
}

if (!(Test-Path -LiteralPath $ElectronVitePath)) {
    Install-ProjectDependencies
}

if (!(Test-Path -LiteralPath $ElectronVitePath)) {
    throw "Dependencies were installed but this file is still missing: $ElectronVitePath"
}

if (!(Test-Path -LiteralPath $ElectronBinaryPath)) {
    if (!(Test-Path -LiteralPath $ElectronInstallPath)) {
        Install-ProjectDependencies
    }

    if (!(Test-Path -LiteralPath $ElectronInstallPath)) {
        throw "Electron install script is missing: $ElectronInstallPath"
    }

    Write-Host 'Electron runtime is missing. Downloading it...' -ForegroundColor Yellow
    $OriginalElectronMirror = $env:ELECTRON_MIRROR
    if ([string]::IsNullOrWhiteSpace($OriginalElectronMirror)) {
        $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    }

    & $NodePath $ElectronInstallPath
    $ElectronInstallExitCode = $LASTEXITCODE

    if ([string]::IsNullOrWhiteSpace($OriginalElectronMirror)) {
        Remove-Item Env:ELECTRON_MIRROR -ErrorAction SilentlyContinue
    }
    else {
        $env:ELECTRON_MIRROR = $OriginalElectronMirror
    }

    if ($ElectronInstallExitCode -ne 0) {
        throw "Electron runtime download failed with exit code $ElectronInstallExitCode"
    }
}

if (!(Test-Path -LiteralPath $ElectronBinaryPath)) {
    throw "Electron runtime is still missing: $ElectronBinaryPath"
}

Write-Host 'Starting abcBrowser in development mode...' -ForegroundColor Cyan
& $NodePath $ElectronVitePath dev @DevArgs
exit $LASTEXITCODE

