param(
  [Parameter(Mandatory=$true)][string]$Presentation,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$Document = ''
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
function Inside([string]$path) {
  $resolved = [IO.Path]::GetFullPath($path)
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay inside app workspace' }
  return $resolved
}
$out = Inside $OutputDirectory
New-Item -ItemType Directory -Path $out -Force | Out-Null
$env:TEMP = Join-Path $root '.tmp'
$env:TMP = $env:TEMP
$ppt = $null; $deck = $null; $word = $null; $doc = $null
$pptOwned = $false; $wordOwned = $false
try {
  # Open read-only, without a presentation window; retain native charts and fonts.
  $ppt = New-Object -ComObject PowerPoint.Application
  $pptOwned = $ppt.Presentations.Count -eq 0
  $deck = $ppt.Presentations.Open([IO.Path]::GetFullPath($Presentation), -1, 0, 0)
  $deck.Export($out, 'PNG', 1600, 900)
  $deck.SaveAs((Join-Path $out 'slides.pdf'), 32)
  $slides = $deck.Slides.Count
  $deck.Close(); $deck = $null
  if ($pptOwned) { $ppt.Quit() }
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt) | Out-Null
  $ppt = $null
  if ($Document) {
    $word = New-Object -ComObject Word.Application
    $wordOwned = $word.Documents.Count -eq 0
    if ($wordOwned) { $word.Visible = $false; $word.DisplayAlerts = 0 }
    $doc = $word.Documents.Open([IO.Path]::GetFullPath($Document), $false, $true, $false)
    $doc.ExportAsFixedFormat((Join-Path $out 'speaker.pdf'), 17)
    $doc.Close(0); $doc = $null
    if ($wordOwned) { $word.Quit() }
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
    $word = $null
  }
  [ordered]@{renderer='Installed Office COM native read-only export'; slides=$slides; source=[IO.Path]::GetFullPath($Presentation); sourceSha256=(Get-FileHash -LiteralPath $Presentation -Algorithm SHA256).Hash.ToLower(); generatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'render-manifest.json') -Encoding UTF8
  Write-Output "Rendered $slides slides to $out"
} finally {
  if ($doc) { $doc.Close(0) }
  if ($word -and $wordOwned) { $word.Quit() }
  if ($deck) { $deck.Close() }
  if ($ppt -and $pptOwned) { $ppt.Quit() }
}
