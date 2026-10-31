param([string]$InputFile, [string]$OutputFile, [switch]$Worker)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
function Write-Speech([string]$RequestFile, [string]$WaveFile) {
  $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $request.lang } | Select-Object -First 1
  if (!$voice) { throw 'No PC voice is installed for the requested language.' }
  $speaker.SelectVoice($voice.VoiceInfo.Name)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $speaker.SetOutputToWaveFile($WaveFile, $format)
  $speaker.Speak([string]$request.text)
  $speaker.SetOutputToNull()
}
try {
  if ($Worker) {
    [Console]::Out.WriteLine('{"ready":true}')
    while ($null -ne ($line = [Console]::ReadLine())) {
      $job = $line | ConvertFrom-Json
      try {
        Write-Speech $job.input $job.output
        [Console]::Out.WriteLine((@{id=$job.id;ok=$true} | ConvertTo-Json -Compress))
      } catch {
        [Console]::Out.WriteLine((@{id=$job.id;ok=$false} | ConvertTo-Json -Compress))
      }
    }
  } else {
    if (!$InputFile -or !$OutputFile) { throw 'InputFile and OutputFile are required.' }
    Write-Speech $InputFile $OutputFile
  }
} finally { $speaker.Dispose() }
