param([string]$Version = 'v1.9.2')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Official CPU release; binaries/models stay outside the repository.
$root = Join-Path $env:LOCALAPPDATA 'NexusDeck\whisper'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$release = Invoke-RestMethod "https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/$Version"
$asset = $release.assets | Where-Object name -eq 'whisper-bin-x64.zip' | Select-Object -First 1
if (!$asset -or $asset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Official CPU archive or published SHA256 missing.' }
function Get-VerifiedFile($url, $destination, $expected) {
  if (!(Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile ($destination + '.partial')
    $actual = (Get-FileHash -LiteralPath ($destination + '.partial') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "SHA256 mismatch: $destination ($actual)" }
    Move-Item -LiteralPath ($destination + '.partial') -Destination $destination -Force
  }
  Write-Output "SHA256 verified $expected  $destination"
}
$zip = Join-Path $root "$Version-cpu.zip"
Get-VerifiedFile $asset.browser_download_url $zip $asset.digest.Substring(7)
$bin = Join-Path $root $Version
Expand-Archive -LiteralPath $zip -DestinationPath $bin -Force
$model = Join-Path $root 'ggml-base.bin'
# Hugging Face's published LFS SHA256 for the multilingual base model.
Get-VerifiedFile 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' $model '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
$exe = Get-ChildItem -LiteralPath $bin -Recurse -Filter whisper-cli.exe | Select-Object -First 1
if (!$exe) { throw 'whisper-cli.exe is missing from the archive.' }
@{version=$Version;exe=$exe.FullName;model=$model;archiveSha256=$asset.digest;modelSha256='60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'install.json') -Encoding UTF8
Write-Output "Ready: $($exe.FullName) (multilingual base, CPU)"
