param([Parameter(Mandatory)][string]$BuildDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$logo=[Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\..\assets\app.png'))
$banner=[Drawing.Bitmap]::new(852,128,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$canvas=[Drawing.Graphics]::FromImage($banner)
$canvas.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$bounds=[Drawing.Rectangle]::new(0,0,$banner.Width,$banner.Height)
$fill=[Drawing.Drawing2D.LinearGradientBrush]::new($bounds,[Drawing.Color]::FromArgb(14,32,41),[Drawing.Color]::FromArgb(25,56,61),[float]8)
$accent=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(114,210,196))
$headlineBrush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(244,248,250))
$headlineFont=[Drawing.Font]::new('Segoe UI',34,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
try {
    $canvas.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $headlines=[ordered]@{ Update='Update installieren'; Fresh='Planer installieren' }
    foreach ($entry in $headlines.GetEnumerator()) {
        $canvas.FillRectangle($fill,$bounds)
        $canvas.DrawImage($logo,22,15,96,96)
        $canvas.DrawString($entry.Value,$headlineFont,$headlineBrush,[float]140,[float]32)
        $canvas.FillRectangle($accent,0,125,852,3)
        $banner.Save((Join-Path $BuildDirectory ('SetupBanner'+$entry.Key+'.bmp')),[Drawing.Imaging.ImageFormat]::Bmp)
    }
    foreach ($art in @(@{File='SetupProgress.bmp';Height=58},@{File='SetupFinished.bmp';Height=312})) {
        $bitmap=[Drawing.Bitmap]::new(493,$art.Height,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics=[Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            if ($art.Height -eq 58) { $graphics.DrawImage($logo,439,5,48,48) }
            else {
                $graphics.FillRectangle($fill,0,0,116,$art.Height)
                $graphics.DrawImage($logo,16,31,84,84)
            }
            $bitmap.Save((Join-Path $BuildDirectory $art.File),[Drawing.Imaging.ImageFormat]::Bmp)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $headlineFont.Dispose()
    $headlineBrush.Dispose()
    $accent.Dispose()
    $fill.Dispose()
    $canvas.Dispose()
    $banner.Dispose()
    $logo.Dispose()
}

$setup = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\SetupWindow.cs') -Raw
$literal = [regex]::Match($setup,'public const string Text="((?:\\.|[^"\\])*)";')
$receipt = [regex]::Match($setup,'public const string Receipt="[^":]+:([0-9a-f]{64})";')
if (!$literal.Success -or !$receipt.Success) { throw 'The versioned installation terms could not be read.' }
$terms=[regex]::Unescape($literal.Groups[1].Value)
$sha=[Security.Cryptography.SHA256]::Create()
try {
    $fingerprint=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($terms))).Replace('-','').ToLowerInvariant()
} finally { $sha.Dispose() }
if ($fingerprint -cne $receipt.Groups[1].Value) { throw 'The displayed terms differ from the acceptance receipt.' }
$headings=[regex]::Match($setup,'public static readonly string\[\] Headings=\{([^}]+)\};')
if (!$headings.Success) { throw 'The section headings could not be read.' }
$titles = @([regex]::Matches($headings.Groups[1].Value,'"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$rtf=[Text.StringBuilder]::new('{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Segoe UI;}}\uc1\viewkind4\pard\f0\fs19 ')
foreach ($line in ($terms -split '\r?\n')) {
    $isTitle=$line -cin $titles
    if ($isTitle) { [void]$rtf.Append('\b ') }
    foreach($character in $line.ToCharArray()) {
        if ($character -in '\','{','}') { [void]$rtf.Append('\').Append($character) }
        elseif ([int]$character -gt 127) { [void]$rtf.Append('\u').Append([int]$character).Append('?') }
        else { [void]$rtf.Append($character) }
    }
    if ($isTitle) { [void]$rtf.Append('\b0 ') }
    [void]$rtf.Append('\par ')
}
[void]$rtf.Append('}')
[IO.File]::WriteAllText((Join-Path $BuildDirectory 'SetupTerms.rtf'),$rtf.ToString(),[Text.Encoding]::ASCII)
