$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $ProjectRoot '.env.local'
$LatencyDir = Join-Path $ProjectRoot 'tests/latency'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ResultPath = Join-Path $LatencyDir "results-$Timestamp.txt"

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $pattern = "^\s*$([regex]::Escape($Name))\s*=\s*(.+?)\s*$"
    foreach ($line in Get-Content -Path $Path) {
        if ($line -match $pattern) {
            $value = $Matches[1].Trim()
            if (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            ) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }

    throw "Missing $Name in $Path"
}

if (-not (Test-Path -Path $EnvPath)) {
    throw "Missing .env.local at $EnvPath"
}

if (-not (Test-Path -Path $LatencyDir)) {
    New-Item -ItemType Directory -Path $LatencyDir | Out-Null
}

$url = Get-DotEnvValue -Path $EnvPath -Name 'NEXT_PUBLIC_SUPABASE_URL'
$key = Get-DotEnvValue -Path $EnvPath -Name 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
$scriptsVolume = "${LatencyDir}:/scripts"

& docker run --rm -i `
    -e SUPABASE_URL=$url `
    -e ANON_KEY=$key `
    -v $scriptsVolume `
    grafana/k6 run /scripts/db-roundtrip.k6.js 2>&1 |
    Tee-Object -FilePath $ResultPath

$exitCode = $LASTEXITCODE
Write-Host "k6 output saved to $ResultPath"
exit $exitCode
