# remote_sab_setup.ps1 — 远端 SAB 基座快照与测试底座部署（TARGET_HOST 占位）
# 本机零改动；全部操作经 SSH 在远端执行。
param(
    [string]$TargetHost = "TARGET_HOST",      # 远端服务器（MHF ONLINE API 所在主机占位）
    [string]$SshUser   = "TARGET_USER",
    [string]$KeyFile   = "TARGET_KEYFILE",    # ssh 私钥路径占位（不上传 key）
    [string]$RemoteBase = "/opt/sab"          # 远端 SAB 基座目录占位
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$snapDir = Join-Path $PSScriptRoot "snapshots\$stamp"
New-Item -ItemType Directory -Force -Path $snapDir | Out-Null

function Ssh($cmd) {
    ssh -i $KeyFile -o StrictHostKeyChecking=no "${SshUser}@${TargetHost}" $cmd
    if ($LASTEXITCODE -ne 0) { throw "ssh failed: $cmd" }
}

Write-Output "== 1. 远端基座文件清单 + 哈希底册 =="
Ssh "find $RemoteBase -type f 2>/dev/null | sort | xargs sha256sum > /tmp/sab_baseline_$stamp.txt; cat /tmp/sab_baseline_$stamp.txt" | Out-File (Join-Path $snapDir "baseline_hashes.txt")

Write-Output "== 2. 拉取关键配置快照（不含密钥字段） =="
Ssh "sed -E 's/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/\1***/g; s/(password[\"']?\s*[:=]\s*[\"']?)[^\"', ]+/\1***/g' $RemoteBase/settings.json 2>/dev/null" | Out-File (Join-Path $snapDir "settings_masked.json")
Ssh "tar -czf /tmp/sab_config_$stamp.tgz -C $RemoteBase . 2>/dev/null && sha256sum /tmp/sab_config_$stamp.tgz" | Out-File (Join-Path $snapDir "config_archive_sha.txt")

Write-Output "== 3. 部署远端测试底座（独立目录，不动基座本体） =="
Ssh "mkdir -p /opt/sab_lab/tests && echo deployed"
scp -i $KeyFile (Join-Path $PSScriptRoot "remote_sab_probe.py") "${SshUser}@${TargetHost}:/opt/sab_lab/tests/remote_sab_probe.py"

Write-Output "== 快照完成: $snapDir =="
Write-Output "下一布: ssh 到远端运行 python3 /opt/sab_lab/tests/remote_sab_probe.py"
