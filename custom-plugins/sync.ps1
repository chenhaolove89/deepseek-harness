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
        Write-Host 'setup 完成：新会话将自动加载 plugin-sourcelib 技能与已安装的 preset。'
    }
    'status' {
        Write-Host "库根: $Root"
        Get-ChildItem $Root -Directory | Where-Object { $_.Name -notin @('skills', 'presets') } | ForEach-Object {
            $files = (Get-ChildItem $_.FullName -File | Select-Object -ExpandProperty Name) -join ', '
            Write-Host ("[{0}] {1}" -f $_.Name, $files)
        }
    }
}
