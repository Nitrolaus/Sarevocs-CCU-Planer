param(
    [Parameter(Mandatory)][string] $Setup,
    [Parameter(Mandatory)][string] $Output
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Reflection.Metadata
$file = [IO.File]::OpenRead($Setup)
try {
    $pe = [System.Reflection.PortableExecutable.PEReader]::new($file)
    try {
        $cor = $pe.PEHeaders.CorHeader
        if (!$cor -or !$pe.HasMetadata) { throw 'Expected a managed installer' }
        $reader = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)
        $expected = @{
            'SarevocsCCUPlaner.Cabinet' = 'payload.cab'
            'SarevocsCCUPlaner.PayloadManifest' = 'product-files.txt'
        }
        $seen = @{}
        $section = $pe.GetSectionData($cor.ResourcesDirectory.RelativeVirtualAddress)
        if ($cor.ResourcesDirectory.Size -gt $section.Length) { throw 'Invalid resource directory' }
        foreach ($id in $reader.ManifestResources) {
            $resource = $reader.GetManifestResource($id)
            $name = $reader.GetString($resource.Name)
            if (!$expected.ContainsKey($name) -or !$resource.Implementation.IsNil -or $seen.ContainsKey($name)) {
                throw 'Unexpected installer resource'
            }
            $remaining = $cor.ResourcesDirectory.Size - $resource.Offset
            if ($resource.Offset -lt 0 -or $remaining -lt 4) { throw 'Invalid resource offset' }
            $blob = $section.GetReader($resource.Offset, $remaining)
            $size = $blob.ReadInt32()
            if ($size -le 0 -or $size -gt $remaining - 4) { throw 'Invalid resource size' }
            [IO.File]::WriteAllBytes((Join-Path $Output $expected[$name]), $blob.ReadBytes($size))
            $seen[$name] = $true
        }
        if ($seen.Count -ne $expected.Count) { throw 'Missing CAB installer resource' }
    } finally { $pe.Dispose() }
} finally { $file.Dispose() }
