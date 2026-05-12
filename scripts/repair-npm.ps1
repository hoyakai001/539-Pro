# scripts/repair-npm.ps1
#
# 修復 user 本機 npm 損壞（@npmcli/{arborist,config,git,map-workspaces}/package.json 是二進位垃圾）
#
# 使用方式（必須以系統管理員身份開 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File scripts/repair-npm.ps1
#
# 或在已開的 PowerShell（管理員）內：
#   cd C:\Users\amos\Downloads\539-Pro-main\539-Pro-main
#   .\scripts\repair-npm.ps1
#
# 此腳本：
#   1. 從 npmjs.org registry 抓 4 個正確的 package.json
#   2. 寫到 C:\Program Files\nodejs\node_modules\npm\node_modules\@npmcli\<name>\package.json
#   3. 驗證 `npm --version` 能正常輸出
#
# 不修改 npm 行為、不安裝任何新套件、不接觸 production / Vercel。

$ErrorActionPreference = "Stop"

$packages = @{
    "arborist"       = "9.4.2"
    "config"         = "10.9.0"
    "git"            = "7.0.2"
    "map-workspaces" = "5.0.3"
}

$npmRoot = "C:\Program Files\nodejs\node_modules\npm\node_modules\@npmcli"

if (-not (Test-Path $npmRoot)) {
    Write-Error "Cannot find $npmRoot — is Node.js installed to default location?"
    exit 1
}

foreach ($name in $packages.Keys) {
    $ver = $packages[$name]
    $url = "https://registry.npmjs.org/@npmcli/$name/$ver"
    $dest = Join-Path $npmRoot "$name\package.json"

    Write-Host "[repair] fetching $name@$ver from npm registry..."
    try {
        $manifest = Invoke-RestMethod -Uri $url -UseBasicParsing
    } catch {
        Write-Warning "[repair] FAILED to fetch $name@$ver — $_"
        continue
    }

    # Serialize manifest as JSON (2-space indent matching npm style)
    $json = $manifest | ConvertTo-Json -Depth 100 -Compress:$false

    Write-Host "[repair] writing $dest"
    Set-Content -Path $dest -Value $json -Encoding utf8 -Force
}

Write-Host ""
Write-Host "[repair] verifying npm..."
$v = & npm --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[repair] SUCCESS — npm $v"
    exit 0
} else {
    Write-Warning "[repair] npm still failing:"
    Write-Warning "$v"
    Write-Warning ""
    Write-Warning "Fallback: reinstall Node.js LTS from https://nodejs.org/"
    exit 1
}
