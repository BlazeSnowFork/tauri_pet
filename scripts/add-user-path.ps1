$p = [Environment]::GetEnvironmentVariable('Path', 'User')
$add = @('C:\Users\lenovo\.cargo\bin', 'C:\Users\lenovo\msys64\mingw64\bin') | Where-Object { $p -notlike "*$_*" }
if ($add) {
  [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + ($add -join ';')), 'User')
  Write-Output ('added: ' + ($add -join ';'))
} else {
  Write-Output 'already present'
}
