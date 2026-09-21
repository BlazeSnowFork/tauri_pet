# 一键打包：功能自测 → tauri build（NSIS）→ 汇总到 pkg/
#   pkg/tauri-desktop-pet_<版本>_x64-setup.exe        安装版（沿用 tauri 生成的文件名）
#   pkg/tauri-desktop-pet-portable-<版本>-x64/        免安装版（exe + WebView2Loader.dll 同目录）
#   pkg/tauri-desktop-pet-portable-<版本>-x64.zip     免安装版压缩包
# 参数：-SkipTests 跳过 npm test；-SkipBuild 只汇总已有产物（改脚本时快速验证用）
param(
  [switch]$SkipTests,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
# 中文输出在 Windows 控制台（默认 GBK 代码页）下需要切到 UTF-8
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new() } catch { }
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "src-tauri/target/release"
$pkgDir = Join-Path $root "pkg"
$exeName = "tauri-desktop-pet"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

function Step($msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Assert-LastExit() {
  if ($LASTEXITCODE -ne 0) { throw "上一步命令失败，退出码 $LASTEXITCODE" }
}

Push-Location $root
try {
  if ($SkipTests) {
    Step "跳过功能自测（-SkipTests）"
  }
  else {
    Step "功能自测：npm run test（v$version）"
    npm.cmd run test
    Assert-LastExit
  }

  if ($SkipBuild) {
    Step "跳过编译，复用 src-tauri/target/release 已有产物（-SkipBuild）"
  }
  else {
    Step "编译并打包：npm run tauri build（release 编译较慢，请耐心等待）"
    npm.cmd run tauri build
    Assert-LastExit
  }

  $exe = Join-Path $release "$exeName.exe"
  $loader = Join-Path $release "WebView2Loader.dll"
  $setup = Get-ChildItem (Join-Path $release "bundle/nsis/*.exe") -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

  if (-not (Test-Path $exe)) { throw "找不到主程序：$exe" }
  if (-not (Test-Path $loader)) { throw "找不到 WebView2Loader.dll：$loader" }
  if (-not $setup) { throw "找不到 NSIS 安装包（$release/bundle/nsis），请去掉 -SkipBuild 完整打包一次" }

  Step "汇总产物到 pkg/"
  if ($setup.Name -notlike "*_${version}_*") {
    Write-Host "警告：最新安装包 $($setup.Name) 的版本号与当前 v$version 不符，可能是旧产物（去掉 -SkipBuild 重编）" -ForegroundColor Yellow
  }
  if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
  New-Item -ItemType Directory -Path $pkgDir | Out-Null

  Copy-Item $setup.FullName (Join-Path $pkgDir $setup.Name)

  $portableName = "${exeName}-portable-${version}-x64"
  $portableDir = Join-Path $pkgDir $portableName
  New-Item -ItemType Directory -Path $portableDir | Out-Null
  Copy-Item $exe, $loader $portableDir
  Compress-Archive -Path $portableDir -DestinationPath (Join-Path $pkgDir "$portableName.zip")

  Step "打包完成"
  Get-ChildItem $pkgDir -Recurse -File | ForEach-Object {
    "{0,9:N0} KB  {1}" -f ($_.Length / 1KB), $_.FullName.Substring($pkgDir.Length + 1)
  }
  Write-Host "`n分发免安装版时，$exeName.exe 与 WebView2Loader.dll 必须在同一个文件夹（exe 动态链接它）。" -ForegroundColor Yellow
}
finally {
  Pop-Location
}
