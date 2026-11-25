param(
    [Parameter(Mandatory)][string]$Application,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [string]$WixDirectory = 'C:\Codex\tools\WiX-3.14.1-CCU'
)
$ErrorActionPreference = 'Stop'
$Application = (Resolve-Path -LiteralPath $Application).Path
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
[void][IO.Directory]::CreateDirectory($BuildDirectory)
$scratch = [IO.Directory]::CreateDirectory((Join-Path $BuildDirectory 'temp')).FullName
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
$programs = [Environment]::GetFolderPath('ProgramFilesX86')
$studio = & "$programs\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vc = Get-ChildItem "$studio\VC\Tools\MSVC" -Directory | Sort-Object {[Version]$_.Name} -Descending |
    Where-Object { Test-Path "$($_.FullName)\bin\Hostx64\x64\cl.exe" } | Select-Object -First 1
$kits = "$programs\Windows Kits\10"
$sdk = Get-ChildItem "$kits\Include" -Directory | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' |
    Sort-Object {[Version]$_.Name} -Descending | Where-Object { Test-Path "$kits\Lib\$($_.Name)\um\x64\msi.lib" } | Select-Object -First 1
if (!$vc -or !$sdk) { throw 'MSVC x64 and Windows SDK are required' }
function Run([string]$exe, [string[]]$parameters) {
    & $exe @parameters
    if ($LASTEXITCODE -ne 0) { throw "$exe failed, exit $LASTEXITCODE" }
}
try {
    $env:TEMP = $scratch
    $env:TMP = $scratch
    if ((Get-FileHash "$PSScriptRoot\msi119.tsv").Hash -ne 'B82F41034B0D1F12BDCB4C5B8F480396B86E3C60C4695D4755D42B483B1AD126') { throw 'Manifest pin mismatch' }
    Run 'node.exe' @("$PSScriptRoot\harvest.mjs", $Application, $BuildDirectory)
    & "$PSScriptRoot\Build-DialogResources.ps1" -BuildDirectory $BuildDirectory
    $flags = @('/nologo','/std:c++20','/EHsc','/O2','/MT','/LD','/utf-8',"/I$BuildDirectory","/I$($vc.FullName)\include")
    $flags += @('um','shared','ucrt','winrt') | ForEach-Object { "/I$($sdk.FullName)\$_" }
    $flags += @("/Fo:$BuildDirectory\NativePreflight.obj","/Fe:$BuildDirectory\Preflight.CA.dll","$PSScriptRoot\NativePreflight.cpp",
        '/link',"/LIBPATH:$($vc.FullName)\lib\x64","/LIBPATH:$kits\Lib\$($sdk.Name)\um\x64","/LIBPATH:$kits\Lib\$($sdk.Name)\ucrt\x64",
        "/IMPLIB:$BuildDirectory\Preflight.lib",'msi.lib','shell32.lib','ole32.lib','uuid.lib','advapi32.lib','bcrypt.lib')
    Run "$($vc.FullName)\bin\Hostx64\x64\cl.exe" $flags
    Run "$WixDirectory\candle.exe" @('-nologo','-arch','x64',"-dMsiSources=$PSScriptRoot","-dBuildDir=$BuildDirectory",
        "-dAppDir=$Application","-I$BuildDirectory",'-out',"$BuildDirectory\","$PSScriptRoot\Product.wxs","$PSScriptRoot\SetupUI.wxs","$BuildDirectory\Payload.wxs")
    $msi = Join-Path $BuildDirectory 'Sarevocs-CCU-Planer-Setup-0.3.119-Alpha.msi'
    # ICE uses the host Windows Installer service. The offline sandbox is the installation test.
    Run "$WixDirectory\light.exe" @('-nologo','-sval','-ct','1','-cultures:de-de','-ext',"$WixDirectory\WixUIExtension.dll",'-out',$msi,
        "$BuildDirectory\Product.wixobj","$BuildDirectory\SetupUI.wixobj","$BuildDirectory\Payload.wixobj")
    Get-FileHash -LiteralPath $msi
} finally {
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
}
