# Creates a NEXUS shortcut on the Desktop. Pass -Startup to also open NEXUS when Windows starts.
param([switch]$Startup)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ico = Join-Path $dir 'nexus.ico'
$sh = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'))
if ($Startup) { $targets += [Environment]::GetFolderPath('Startup') }
foreach ($t in $targets) {
  $lnk = $sh.CreateShortcut((Join-Path $t 'NEXUS.lnk'))
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = '"' + (Join-Path $dir 'NEXUS.vbs') + '"'
  $lnk.WorkingDirectory = $dir
  $lnk.Description = 'NEXUS session deck: Copilot, Claude and Codex sessions'
  if (Test-Path $ico) { $lnk.IconLocation = $ico }
  $lnk.Save()
  Write-Output "Shortcut: $(Join-Path $t 'NEXUS.lnk')"
}
