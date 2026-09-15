# 远端 SAB 基座测试与学术破甲强化套件（夹具档）

## 夹具标识
- FIXTURE-SAB-REMOTE-001: 远端 SAB 离线基座 4.2.0-offline 授权应答层测试
- FIXTURE-MHF-REMOTE-002: 远端 MH Frame 注入链路（prompt 分发 + 授权门控）测试
- FIXTURE-SAB-STRENGTHEN-003: 学术破甲强化电池（SchemaCoercion/IICL/Style/Prefill/Repeat/Cipher + json_object + HOLLOW 门禁）

## 铁律
- 本地 MH Frame / SAB 离线基座一字节不动。
- 全部操作在远端 TARGET_HOST 执行；本套件文件不含任何密钥。

## 远端执行步骤
1. `remote_sab_setup.ps1`：SSH 到 TARGET_HOST，快照 SAB 基座目录与配置，落盘哈希底册（rollback 依据）。
2. `remote_sab_probe.py`：远端运行——探 SAB 授权应答（success/failure 模板）、MH Frame prompt 分发端点、注入链路，并跑学术破甲测试电池。
3. `remote_sab_rollback.ps1`：按快照哈希恢复远端基座。

## 回滚记录
- 快照目录：`remote_sab_lab/snapshots/<timestamp>/`
- 每步改动前记 SHA-256，改动后核对；不匹配即回滚。
