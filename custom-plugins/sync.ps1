param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'status')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$DshHome = Join-Path $HOME '.dsh'

switch ($Action) {
    'setup' {
        # 1) 安装技能种子 -> ~/.dsh/skills
        $srcSkills = Join-Path $Root 'skills'
        if (Test-Path $srcSkills) {
            foreach ($s in (Get-ChildItem $srcSkills -Directory)) {
                $dst = Join-Path $DshHome ('skills\' + $s.Name)
                New-Item -ItemType Directory -Force -Path $dst | Out-Null
                Copy-Item (Join-Path $s.FullName '*') $dst -Recurse -Force
                Write-Host "[技能] $($s.Name) -> $dst"
            }
        }
        # 2) 安装 preset 种子 -> ~/.dsh/.agent-presets
        $srcPresets = Join-Path $Root 'presets'
        if (Test-Path $srcPresets) {
            foreach ($p in (Get-ChildItem $srcPresets -Directory)) {
                $dst = Join-Path $DshHome ('.agent-presets\' + $p.Name)
                New-Item -ItemType Directory -Force -Path $dst | Out-Null
                Copy-Item (Join-Path $p.FullName '*') $dst -Recurse -Force
                Write-Host "[preset] $($p.Name) -> $dst"
            }
        }
        # 3) 放置 chrome 运行时 helper（.dsh-chrome 被仓库 .gitignore 忽略、不入库，从库内副本放置）
        $chromeHelper = Join-Path $Root 'chrome-control\chrome-helper.mjs'
        $runtimeDir = Join-Path (Split-Path $Root -Parent) '.dsh-chrome'
        if (Test-Path $chromeHelper) {
            New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
            Copy-Item $chromeHelper (Join-Path $runtimeDir 'chrome-helper.mjs') -Force
            Write-Host "[chrome] helper -> $runtimeDir"
        }
        # 4) 构建常驻静态插件包（lib/ 不入库，新电脑 clone 后需重建；
        #    这两个包由 web-app bundle 组合挂载，构建后随 GUI 启动自动常驻，无需 cordis_define）
        $RepoRoot = Split-Path $Root -Parent
        $PluginDirs = @('ccswitch-import', 'prompt-deepen')
        $missing = @($PluginDirs | Where-Object {
            -not (Test-Path (Join-Path $RepoRoot ("packages\client\$_`\lib\index.js")))
        })
        if ($missing.Count -gt 0) {
            Write-Host "[build] 缺失产物: $($missing -join ', ') —— 运行 tsc + tsdown 重建..."
            Push-Location $RepoRoot
            try {
                pnpm install
                foreach ($p in $missing) {
                    Write-Host "[build] tsc -b $p"
                    pnpm --filter "@deepseek-ai/dsh-$p" exec tsc -b
                    Write-Host "[build] bundle $p"
                    pnpm --filter "@deepseek-ai/dsh-$p" bundle
                }
            }
            finally { Pop-Location }
            Write-Host '[build] 插件包构建完成。'
        }
        else {
            Write-Host '[build] 插件包产物已存在，跳过构建。'
        }
        Write-Host 'setup 完成：新会话将自动加载 plugin-sourcelib 技能与已安装的 preset；静态插件随组合常驻。'
    }
    'status' {
        Write-Host "库根: $Root"
        Get-ChildItem $Root -Directory | Where-Object { $_.Name -notin @('skills', 'presets') } | ForEach-Object {
            $files = (Get-ChildItem $_.FullName -File | Select-Object -ExpandProperty Name) -join ', '
            Write-Host ("[{0}] {1}" -f $_.Name, $files)
        }
    }
}
