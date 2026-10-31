# Explicit installer; never invoked by the web server. All files stay in TTS root.
param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$ttsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NexusDeck\tts'))
$sources = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sources.json') -Raw | ConvertFrom-Json
$dependencies = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
function Get-Verified($item) {
  $destination = [IO.Path]::GetFullPath((Join-Path $ttsRoot $item.file))
  if (!$destination.StartsWith($ttsRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid download path' }
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  if (!(Test-Path -LiteralPath $destination)) {
    Invoke-WebRequest -UseBasicParsing -Uri $item.url -OutFile ($destination + '.partial')
    Move-Item -LiteralPath ($destination + '.partial') -Destination $destination
  }
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256.ToLowerInvariant()) { throw ('Hash mismatch: ' + $item.file) }
}
foreach ($source in $sources) { Get-Verified $source }
foreach ($source in $dependencies) { Get-Verified $source }
if (!$VerifyOnly) { Expand-Archive -LiteralPath (Join-Path $ttsRoot 'uv.zip') -DestinationPath (Join-Path $ttsRoot 'uv') -Force }
$uv = Join-Path $ttsRoot 'uv\uv.exe'
$env:UV_CACHE_DIR = Join-Path $ttsRoot 'cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $ttsRoot 'python'
$env:UV_PYTHON_BIN_DIR = Join-Path $ttsRoot 'bin'
function Invoke-UV { & $uv @args; if ($LASTEXITCODE) { throw 'Isolated runtime install failed' } }
$runtimeDir = Join-Path $ttsRoot 'runtime'
$runtimePython = Join-Path $runtimeDir 'python\python.exe'
if (!$VerifyOnly -and !(Test-Path -LiteralPath $runtimePython)) {
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  & tar -xzf (Join-Path $ttsRoot 'archives\python-3.11.18.tar.gz') -C $runtimeDir
  if ($LASTEXITCODE) { throw 'Pinned Python extraction failed' }
}
foreach ($runtime in @('neural','chatterbox','piper','piper-gpu')) {
  $venv = Join-Path $ttsRoot $runtime
  if (!$VerifyOnly -and !(Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) { Invoke-UV venv --python $runtimePython $venv }
  $python = Join-Path $venv 'Scripts\python.exe'
  # Versions were resolved/tested together. --no-deps preserves the documented
  # CUDA override required by Blackwell and separate transformers versions.
  $pins = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($runtime + '-versions.txt')) | Where-Object { $_ -notmatch '^(chatterbox[-_]tts|resemble[-_]perth|en[-_]core[-_]web[-_]sm)==' }
  $pinFile = Join-Path $ttsRoot ($runtime + '-install.txt')
  $requirements = foreach ($pin in $pins) {
    $name,$version = $pin -split '=='
    $prefix = ($name.Replace('-','_') + '_' + $version + '_').ToLowerInvariant()
    $artifact = @($dependencies | Where-Object { $_.package.Replace('_','-').ToLowerInvariant() -eq $name.Replace('_','-').ToLowerInvariant() -and $_.version -eq $version })
    if (!$artifact.Count) { $artifact = @($sources | Where-Object { [IO.Path]::GetFileName($_.file).Replace('-','_').ToLowerInvariant().StartsWith($prefix) }) }
    if ($artifact.Count -ne 1) { throw ('Missing unique audited package: ' + $pin) }
    $pin + ' --hash=sha256:' + $artifact[0].sha256
  }
  $requirements | Set-Content -LiteralPath $pinFile
  if ($VerifyOnly) {
    Invoke-UV pip install --python $python --no-deps --require-hashes -r $pinFile --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu128 --dry-run
    continue
  }
  Invoke-UV pip install --python $python --no-deps --require-hashes -r $pinFile --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu128
  if ($runtime -eq 'neural') { Invoke-UV pip install --python $python --no-deps (Join-Path $ttsRoot 'archives\en_core_web_sm-3.8.0-py3-none-any.whl') }
  if ($runtime -eq 'chatterbox') {
    Invoke-UV pip install --python $python --no-deps (Join-Path $ttsRoot 'chatterbox-source.zip') (Join-Path $ttsRoot 'perth-source.zip')
  }
}
if ($VerifyOnly) { Write-Output 'Verified all download hashes and runtime installation plans.'; exit 0 }
$pkuseg = Join-Path $ttsRoot 'pkuseg\spacy_ontonotes'
if (!(Test-Path -LiteralPath $pkuseg)) { Expand-Archive -LiteralPath (Join-Path $ttsRoot 'pkuseg\spacy_ontonotes.zip') -DestinationPath $pkuseg }
$python = Join-Path $ttsRoot 'neural\Scripts\python.exe'
foreach ($engine in @('kokoro','qwen','chatterbox','piper')) {
  & $python (Join-Path $PSScriptRoot 'samples.py') $engine
  if ($LASTEXITCODE) { throw ('Sample generation failed: ' + $engine) }
}
& $python (Join-Path $PSScriptRoot 'samples.py') piper --gpu
if ($LASTEXITCODE) { throw 'GPU Piper samples failed; CPU samples remain available.' }
Write-Output 'Voices installed. Open NEXUS Settings > Voice to listen and choose.'
