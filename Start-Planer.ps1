# PowerShell 7. Arbeitsordner ist der Projektordner dieser Datei.
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    & $nodeExecutable scripts/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen.' }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe') $PSScriptRoot
} finally { Pop-Location }
