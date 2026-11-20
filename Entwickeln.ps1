param([ValidateSet('Installieren','Pruefen','Paketieren','Installer')][string]$Aktion = 'Pruefen')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$oldTemp = $env:TEMP; $oldTmp = $env:TMP; $oldCache = $env:ELECTRON_CACHE; $oldElectronCache = $env:electron_config_cache
try {
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    $env:TEMP = Join-Path $PSScriptRoot 'work\temp\tooling'; $env:TMP = $env:TEMP
    $env:ELECTRON_CACHE = Join-Path $PSScriptRoot 'work\cache\electron'; $env:electron_config_cache = $env:ELECTRON_CACHE
    New-Item -ItemType Directory -Force -Path $env:TEMP,$env:ELECTRON_CACHE | Out-Null
    function Invoke-NodeStep([string[]]$Arguments) {
        & $nodeExecutable @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Entwicklungsschritt fehlgeschlagen: $($Arguments[0])" }
    }
    if ($Aktion -eq 'Installieren') {
        $npmCli = Join-Path (Split-Path -Parent $nodeExecutable) 'node_modules\npm\bin\npm-cli.js'
        if (!(Test-Path -LiteralPath $npmCli)) { throw 'npm neben der vorhandenen Node-Installation nicht gefunden.' }
        Invoke-NodeStep -Arguments @($npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', (Join-Path $PSScriptRoot 'work\cache\npm'))
        Invoke-NodeStep -Arguments @('node_modules/esbuild/install.js')
        Invoke-NodeStep -Arguments @('node_modules/electron/install.js')
    } else {
        Invoke-NodeStep -Arguments @('node_modules/typescript/bin/tsc', '--noEmit')
        Invoke-NodeStep -Arguments @('--import', 'tsx', '--test', 'tests/*.test.ts')
        Invoke-NodeStep -Arguments @('scripts/notices.mjs')
        Invoke-NodeStep -Arguments @('scripts/build.mjs')
        if ($Aktion -eq 'Paketieren') { Invoke-NodeStep -Arguments @('scripts/package.mjs') }
        if ($Aktion -eq 'Installer') { Invoke-NodeStep -Arguments @('scripts/installer.mjs') }
    }
} finally {
    $env:TEMP=$oldTemp; $env:TMP=$oldTmp; $env:ELECTRON_CACHE=$oldCache; $env:electron_config_cache=$oldElectronCache
    Pop-Location
}
