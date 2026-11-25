param(
    [Parameter(Mandatory)][string]$Baseline118,
    [Parameter(Mandatory)][string]$Baseline118Patched,
    [Parameter(Mandatory)][string]$Baseline119,
    [Parameter(Mandatory)][string]$Target118,
    [Parameter(Mandatory)][string]$Target119,
    [Parameter(Mandatory)][string]$FreshMsi,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [string]$WixDirectory = 'C:\Codex\tools\WiX-3.14.1-CCU'
)
$ErrorActionPreference = 'Stop'
function RunWix([string]$name, [string[]]$arguments) {
    & (Join-Path $WixDirectory "$name.exe") @arguments
    if($LASTEXITCODE -ne 0){throw "WiX $name failed, exit $LASTEXITCODE"}
}
function Baseline([string]$pdb,[string]$expected) {
    $pdb=(Resolve-Path -LiteralPath $pdb).Path
    if((Get-FileHash -LiteralPath ([IO.Path]::ChangeExtension($pdb,'.msi'))).Hash -ine $expected){
        throw 'The companion MSI is not the published baseline.'
    }
    return $pdb
}
$Baseline118=Baseline $Baseline118 '4340f47ea61f005fd1a7d4ff6c956078e47bb5fb6160ea722bb81090058af06c'
$Baseline118Patched=Baseline $Baseline118Patched '2d5443291fefadb8566a7cd03824d027c6e12d04264325aba1a39abc9286c52d'
$Baseline119=Baseline $Baseline119 '9fed3352a05adb8f1bda50521c4e52e4afafa84bb9caec008c91663e2021c32b'
$Target118=(Resolve-Path -LiteralPath $Target118).Path
$Target119=(Resolve-Path -LiteralPath $Target119).Path
$FreshMsi=(Resolve-Path -LiteralPath $FreshMsi).Path
$dir=[IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($BuildDirectory)).FullName
$scratch=[IO.Directory]::CreateDirectory((Join-Path $dir 'temp')).FullName
$oldTemp=$env:TEMP
$oldTmp=$env:TMP
try {
    $env:TEMP=$scratch
    $env:TMP=$scratch
    $a=Join-Path $dir '118-to-120.wixmst'
    $patched=Join-Path $dir '118-patched-to-120.wixmst'
    $b=Join-Path $dir '119-to-120.wixmst'
    RunWix 'torch' @('-nologo','-p','-xi',$Baseline118,$Target118,'-out',$a)
    # A minor upgrade keeps the original ProductCode. Compare against the
    # actual image produced by the previous MSP when that patch is applied.
    RunWix 'torch' @('-nologo','-p','-xi',$Baseline118Patched,$Target118,'-out',$patched)
    RunWix 'torch' @('-nologo','-p','-xi',$Baseline119,$Target119,'-out',$b)
    $obj=Join-Path $dir 'CommonPatch.wixobj'
    RunWix 'candle' @('-nologo','-arch','x64',"$PSScriptRoot\CommonPatch.wxs",'-out',$obj)
    $patch=Join-Path $dir 'CommonPatch.wixmsp'
    RunWix 'light' @('-nologo',$obj,'-out',$patch)
    $msp=Join-Path $dir 'Sarevocs-CCU-Planer-Update-0.3.120.msp'
    RunWix 'pyro' @('-nologo',$patch,'-t','Msi118',$a,'-t','Msi118Patched',$patched,'-t','Msi119',$b,'-out',$msp)
    $bal=Join-Path $WixDirectory 'WixBalExtension.dll'
    $util=Join-Path $WixDirectory 'WixUtilExtension.dll'
    $assets=(Resolve-Path -LiteralPath "$PSScriptRoot\..\..\assets").Path
    $bundleObj=Join-Path $dir 'Bundle.wixobj'
    RunWix 'candle' @('-nologo','-ext',$bal,'-ext',$util,"-dMsi=$FreshMsi","-dMsp=$msp","-dIcon=$assets\app.ico","-dLogo=$assets\app.png",
        "$PSScriptRoot\Bundle.wxs",'-out',$bundleObj)
    $output=Join-Path $dir 'Sarevocs-CCU-Planer-Setup-0.3.120-Alpha.exe'
    RunWix 'light' @('-nologo','-ext',$bal,'-ext',$util,$bundleObj,'-out',$output)
    Get-FileHash -LiteralPath $output,$msp
} finally {
    $env:TEMP=$oldTemp
    $env:TMP=$oldTmp
}
