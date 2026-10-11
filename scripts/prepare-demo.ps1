$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path -Parent $PSScriptRoot
$demoRecording = Join-Path $demoRoot 'submission\recording'
New-Item -ItemType Directory -Path $demoRecording -Force | Out-Null
Add-Type -AssemblyName System.Speech
$demoVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$demoVoice.SelectVoice('Microsoft Zira Desktop')
$demoVoice.Rate = 1
$demoFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$demoSegments = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $demoRoot 'submission\narration.json') | ConvertFrom-Json
foreach ($demoSegment in $demoSegments) {
  $demoWave = Join-Path $demoRecording ($demoSegment.id + '.wav')
  $demoVoice.SetOutputToWaveFile($demoWave, $demoFormat)
  $demoVoice.Speak($demoSegment.text)
  $demoVoice.SetOutputToNull()
}
$demoVoice.Dispose()
$demoResultsPath = Join-Path $demoRoot 'evidence\test-results.txt'
$demoResults = Get-Content -Raw -Encoding UTF8 -LiteralPath $demoResultsPath
[System.IO.File]::WriteAllText($demoResultsPath,$demoResults,[System.Text.UTF8Encoding]::new($false))
$demoEscapedResults = [System.Net.WebUtility]::HtmlEncode($demoResults)
$demoHtml = @"
<!doctype html><html lang="en"><meta charset="utf-8"><title>Campaign Compass development evidence</title><style>body{margin:0;background:#111713;color:#eef2eb;font:18px/1.6 system-ui;padding:45px 70px}h1{font-size:34px;margin:0;color:#c3ee89}h2{font-size:21px;margin:25px 0 10px}p{max-width:1100px;color:#c4d0c4}blockquote{border-left:3px solid #c3ee89;margin:15px 0;padding:10px 22px;background:#1e291c}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#19211a;padding:22px;font-size:12px;line-height:1.5;max-height:350px;overflow:auto;border:1px solid #354630}.tag{font-size:12px;letter-spacing:2px;color:#c3ee89}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:35px}li{margin-bottom:12px;font-size:16px}small{color:#a5b6a2}</style><div class="tag">ACTUAL BUILD EVIDENCE / SYNTHETIC NARRATION</div><h1>Built with Codex. Verified against evidence.</h1><h2>Actual initial request</h2><blockquote>go ahead create a compelling ad-campaign dashboard is AI Native. Create a github public project for it, capture a video recording, and other materials required for the submission.</blockquote><div class="grid"><section><h2>Real iterations</h2><ol><li>Two asynchronous DOM assertions ran before the answer settled. The harness now waits for the complete event-loop turn.</li><li>Real mobile inspection found a clipped metric selector. The controls now wrap below the heading; before/after screenshots are preserved.</li><li>The user requested a glossary. Added 21 searchable terms with definitions, formulas and examples.</li></ol><small>Current limit: deterministic assistance. No live model connection.</small></section><section><h2>Actual test output</h2><pre>$demoEscapedResults</pre></section></div></html>
"@
[System.IO.File]::WriteAllText((Join-Path $demoRoot 'submission\development-evidence.html'),$demoHtml,[System.Text.UTF8Encoding]::new($false))
Write-Output 'Generated disclosed synthetic narration and an evidence page from the actual test log.'
