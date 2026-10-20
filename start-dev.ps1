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

$ElectronVitePath = Join-Path $ProjectRoot 'node_modules\electron-vite\bin\electron-vite.js'
if (!(Test-Path -LiteralPath $ElectronVitePath)) {
    Write-Host 'Project dependencies were not found. Installing...' -ForegroundColor Yellow

    $NpmPath = Find-CommandPath 'npm'
    if (![string]::IsNullOrWhiteSpace($NpmPath)) {
        & $NpmPath ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE"
        }
    }
    else {
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
}

if (!(Test-Path -LiteralPath $ElectronVitePath)) {
    throw "Dependencies were installed but this file is still missing: $ElectronVitePath"
}

Write-Host 'Starting abcBrowser in development mode...' -ForegroundColor Cyan
& $NodePath $ElectronVitePath dev @DevArgs
exit $LASTEXITCODE

