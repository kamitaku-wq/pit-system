param(
  [string]$EnvFile = ".env.local"
)

if (-not (Test-Path $EnvFile)) {
  Write-Error "File $EnvFile not found."
  exit 1
}

$lines = Get-Content $EnvFile
Write-Output "=== diagnostic ==="
Write-Output ("total line count: {0}" -f $lines.Count)
Write-Output ""

Write-Output "=== all non-empty lines (key only, value redacted) ==="
$idx = 0
foreach ($line in $lines) {
  $idx = $idx + 1
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $trimmed = $line.TrimStart()
  if ($trimmed.StartsWith("#")) {
    Write-Output ("L{0}: [comment] {1}" -f $idx, $trimmed.Substring(0, [Math]::Min(40, $trimmed.Length)))
    continue
  }

  $eqIndex = $line.IndexOf("=")
  if ($eqIndex -lt 0) {
    Write-Output ("L{0}: [no-eq] {1}" -f $idx, $line.Substring(0, [Math]::Min(40, $line.Length)))
    continue
  }

  $key = $line.Substring(0, $eqIndex)
  $val = $line.Substring($eqIndex + 1)
  $val = $val.Trim('"').Trim("'")

  if ($val.Length -le 20) {
    Write-Output ("L{0}: {1} = {2}" -f $idx, $key, $val)
  }
  else {
    $head = $val.Substring(0, 8)
    $rest = $val.Length - 8
    $preview = $head + "...(+" + $rest + " chars)"
    Write-Output ("L{0}: {1} = {2}" -f $idx, $key, $preview)
  }
}

Write-Output ""
Write-Output "=== end ==="
