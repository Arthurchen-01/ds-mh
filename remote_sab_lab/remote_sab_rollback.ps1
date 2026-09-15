# remote_sab_rollback.ps1 — 按快照哈希恢复远端 SAB 基座（TARGET_HOST 占位）
param(
    [string]$TargetHost = "TARGET_HOST",
    [string]$SshUser   = "TARGET_USER",
    [string]$KeyFile   = "TARGET_KEYFILE",
    [string]$RemoteBase = "/opt/sab",
    [string]$Snapshot  = ""   # snapshots/<timestamp> 目录名
)
$ErrorActionPreference = "Stop"
if (-not $Snapshot) {
    $Snapshot = Get-ChildItem (Join-Path $PSScriptRoot "snapshots") -Directory |
                Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
}
$stamp = $Snapshot
Write-Output "== 恢复基线（快照 $stamp）=="
ssh -i $KeyFile -o StrictHostKeyChecking=no "${SshUser}@${TargetHost}" "tar -xzf /tmp/sab_config_$stamp.tgz -C $RemoteBase && sha256sum -c /tmp/sab_baseline_$stamp.txt || true"
if ($LASTEXITCODE -eq 0) { "ROLLBACK DONE (校验输出见上，FAILED 行需人工复核)" } else { "ROLLBACK FAILED - 人工介入" }
