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
Write-Output 'Generated disclosed synthetic narration. Saved evidence pages retain their explicit application milestone.'
Write-Output 'Generated disclosed synthetic narration. Saved evidence pages retain their explicit application milestone.'
