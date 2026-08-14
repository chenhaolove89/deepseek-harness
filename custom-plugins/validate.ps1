param([string]$Path)
$ErrorActionPreference = 'Stop'
$Target = if ($Path) { $Path } else { Join-Path $PSScriptRoot '.' }
# 插件源码是"函数体"（cordis_define 的 code.host/code.client），顶层 return 合法。
# 用 new Function 按函数体解析；不要用 node --check（受所在目录 CJS/ESM 影响，会误报）。
$check = "const fs=require('fs');try{new Function(fs.readFileSync(process.argv[1],'utf8'));console.log('OK    ' + process.argv[1])}catch(e){console.log('FAIL  ' + process.argv[1] + ' : ' + e.message);process.exit(1)}"
$count = 0
Get-ChildItem $Target -Recurse -Filter '*.js' | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
    $count++
    node -e $check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "校验失败: $($_.FullName)" }
}
Write-Host "全部通过（$count 个 .js 文件）"
