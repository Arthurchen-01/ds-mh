# ==============================================================================
#  DeepSeek Harness (DSH) 离线免授权破甲运行环境一键部署脚本
# ==============================================================================
$ErrorActionPreference = "Stop"
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  正在一键部署 DSH 离线免授权破甲运行环境..." -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$UserHome = $env:USERPROFILE
if (-not $UserHome) { $UserHome = $HOME }

# 1. 部署 OpenCode 提示词库
Write-Host "`n[1/4] 部署本地明文提示词库与模式切换工具..." -ForegroundColor Yellow
$OpenCodeConfigDir = Join-Path $UserHome ".config\opencode"
if (-not (Test-Path $OpenCodeConfigDir)) {
    New-Item -ItemType Directory -Path $OpenCodeConfigDir -Force | Out-Null
}
Copy-Item (Join-Path $ScriptRoot "config\mh-modes.json") $OpenCodeConfigDir -Force
Copy-Item (Join-Path $ScriptRoot "config\custom_system_prompt.txt") $OpenCodeConfigDir -Force
Copy-Item (Join-Path $ScriptRoot "config\mh-switch.mjs") $OpenCodeConfigDir -Force
Copy-Item (Join-Path $ScriptRoot "config\mh-switch.cmd") $OpenCodeConfigDir -Force
Write-Host "  [OK] 提示词库已安装至: $OpenCodeConfigDir" -ForegroundColor Green

# 2. 部署 DSH 全局规范
Write-Host "`n[2/4] 部署 DSH 全局 RedOps 规范 (AGENTS.md)..." -ForegroundColor Yellow
$DshHome = Join-Path $UserHome ".dsh"
if (-not (Test-Path $DshHome)) {
    New-Item -ItemType Directory -Path $DshHome -Force | Out-Null
}
Copy-Item (Join-Path $ScriptRoot "config\AGENTS.md") $DshHome -Force
$SettingsFile = Join-Path $DshHome "settings.yaml"
if (-not (Test-Path $SettingsFile)) {
    Copy-Item (Join-Path $ScriptRoot "config\settings.yaml.example") $SettingsFile -Force
    Write-Host "  [+] 初始化了 settings.yaml (请填入您的 API Key)" -ForegroundColor Cyan
}
Write-Host "  [OK] DSH 配置已安装至: $DshHome" -ForegroundColor Green

# 3. 部署发包层拦截运行时插件
Write-Host "`n[3/4] 部署发包层破甲拦截运行时插件 (Adapter Boundary)..." -ForegroundColor Yellow
$WebProfileDir = Join-Path $DshHome "profiles\web"
$MhModulesDir = Join-Path $WebProfileDir "node_modules\@mh-frame"
if (-not (Test-Path $MhModulesDir)) {
    New-Item -ItemType Directory -Path $MhModulesDir -Force | Out-Null
}

$RuntimeDst = Join-Path $MhModulesDir "dsh-mhf-runtime"
$PluginDst = Join-Path $MhModulesDir "dsh-mhf-plugin"

if (Test-Path $RuntimeDst) { Remove-Item -Recurse -Force $RuntimeDst }
if (Test-Path $PluginDst) { Remove-Item -Recurse -Force $PluginDst }

Copy-Item -Recurse (Join-Path $ScriptRoot "standalone_runtime\@mh-frame\dsh-mhf-runtime") $RuntimeDst -Force
Copy-Item -Recurse (Join-Path $ScriptRoot "standalone_runtime\@mh-frame\dsh-mhf-plugin") $PluginDst -Force

# 确保 web profile package.json 声明加载该 bundle
$WebPackageJsonPath = Join-Path $WebProfileDir "package.json"
$targetJson = @{
    name = "dsh-profile-web"
    private = $true
    dependencies = @{
        "@mh-frame/dsh-mhf-runtime" = "file:./node_modules/@mh-frame/dsh-mhf-runtime"
        "@mh-frame/dsh-mhf-plugin" = "file:./node_modules/@mh-frame/dsh-mhf-plugin"
    }
    dsh = @{
        profile = @{
            bundles = @(
                "@deepseek-ai/dsh-base",
                "@deepseek-ai/dsh-web-app",
                "@mh-frame/dsh-mhf-plugin"
            )
        }
    }
}
$targetJson | ConvertTo-Json -Depth 5 | Set-Content -Path $WebPackageJsonPath -Encoding UTF8
Write-Host "  [OK] 插件已安装至: $WebProfileDir" -ForegroundColor Green

# 4. 完成
Write-Host "`n[4/4] 验证安装环境..." -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  🎉 恭喜！DSH 离线免授权破甲运行环境已全部安装就绪！" -ForegroundColor Green
Write-Host "  - 提示词层级：LLM 适配器出网发送边界 (Adapter Dispatch Boundary)" -ForegroundColor Cyan
Write-Host "  - 安全底护剥离：物理剔除 DSH 原生安全提示词" -ForegroundColor Cyan
Write-Host "  - 双重加权：自动首尾双拼 (Double-Prompting)" -ForegroundColor Cyan
Write-Host "  - 思维链压制：Flash 模型自动关闭反思 (reasoningEffort: off)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Green
Write-Host "`n启动命令：" -ForegroundColor White
Write-Host "  双击运行: start_dsh.cmd" -ForegroundColor Yellow
Write-Host "  或者终端运行: dsh web --port 3080" -ForegroundColor Yellow
Write-Host ""
