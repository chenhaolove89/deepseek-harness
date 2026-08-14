param([string]$Path)
$ErrorActionPreference = 'Stop'
$Target = if ($Path) { $Path } else { Join-Path $PSScriptRoot '.' }
# 两类文件用不同校验方式：
# - host.js / client.js：插件"函数体"（cordis_define 的 code.host/code.client），顶层 return 合法，
#   用 new Function 解析；不要用 node --check（受所在目录 CJS/ESM 影响会误报）。
# - 其他 .js / .mjs：真模块（如 preset/plugin.js、chrome-helper.mjs），用 node --check。
$fnCheck = "const fs=require('fs');try{new Function(fs.readFileSync(process.argv[1],'utf8'));console.log('OK    ' + process.argv[1])}catch(e){console.log('FAIL  ' + process.argv[1] + ' : ' + e.message);process.exit(1)}"
$count = 0
Get-ChildItem $Target -Recurse -Include *.js,*.mjs -File | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
    $count++
    if ($_.Name -in @('host.js', 'client.js')) {
        node -e $fnCheck $_.FullName
    } else {
        node --check $_.FullName
    }
    if ($LASTEXITCODE -ne 0) { throw "校验失败: $($_.FullName)" }
}
Write-Host "全部通过（$count 个 JS/MJS 文件）"
