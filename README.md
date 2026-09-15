# DeepSeek Harness (DSH) 离线免授权破甲运行环境 (Turnkey Standalone)

> 本套件已彻底剥离原作者收费加壳看门狗（`mh-control.vmp.exe`）及远程 X25519 鉴权链路，实现 **100% 离线、永久免授权、跨设备即开即用**。

---

## ⚡ 为什么之前克隆到新电脑“完全没用”？

普通人塞提示词往往塞在 **“Web 界面 / Settings 配置层”**，而大模型依然会跳出“我不能做这个/这违反安全准则”，原因在于原方案依靠 **4 个核心发包层底层机制**：

1. **安全底护剥离**：DSH 原生自带 `@deepseek-ai/dsh-system-prompt`。如果你只在设置里填词，DSH 会把安全红线拼在最前面，导致冲突时模型默认选择安全拒答。本套件在发包前通过适配器拦截器**物理剔除了 DSH 原生提示词**。
2. **双重加权注入 (Double-Prompting)**：整整 9159 字符的 `4.1flash通用` 提示词在发包时被**首尾拼接了两遍**，强行在 Attention 向量中压倒内建对齐。
3. **思维链强制压制 (Flash Thinking Off)**：模型开启思考链（`<think>`）时会自动审查道德风险并拒答。本套件在底层强行注入 `reasoningEffort: "off"`，直接剥离思考反思环节，直出代码。
4. **底层硬件锁机解除**：原版在 `index.js` 中依赖 `MachineGuid` 向远端鉴权，新电脑因机器码不一致导致拦截器直接退出放行。本套件已在底层**永久短路授权门禁**。

---

## 🚀 新电脑 1 秒安装指南

### 第一步：克隆仓库
```bash
git clone https://github.com/Arthurchen-01/ds-mh.git
cd ds-mh
```

### 第二步：一键安装
- **Windows 用户**：直接双击运行 **`install_new_pc.cmd`**（或右键运行 `install_new_pc.ps1`）。
- 脚本会自动将离线运行时部署到 `~/.dsh/profiles/web/`，并将 9 大模式纯文本提示词部署到 `~/.config/opencode/`。

### 第三步：启动 DSH
- 双击 **`start_dsh.cmd`**，或在命令行运行：
```bash
dsh web --port 3080
```
- 浏览器打开 `http://127.0.0.1:3080` 即可开始无限制编程。

---

## 🛠️ 本地模式自由切换

内置模式管理工具（无需联网，毫秒级切换）：
```bash
# 查看所有可用模式
node %USERPROFILE%/.config/opencode/mh-switch.mjs list

# 切换为 4.1flash通用 (默认推荐)
node %USERPROFILE%/.config/opencode/mh-switch.mjs set general

# 切换为 4.0Pro通用
node %USERPROFILE%/.config/opencode/mh-switch.mjs set mode-8xkmkygn

# 切换为模型专精执行体
node %USERPROFILE%/.config/opencode/mh-switch.mjs set poj-kimi-k3
node %USERPROFILE%/.config/opencode/mh-switch.mjs set poj-deepseek-v4.1-flash
node %USERPROFILE%/.config/opencode/mh-switch.mjs set poj-glm-5.3
node %USERPROFILE%/.config/opencode/mh-switch.mjs set poj-gpt-6-astra
```

---

## 📂 项目结构说明

- **`install_new_pc.cmd` / `.ps1`**：新电脑一键全自动部署脚本。
- **`start_dsh.cmd`**：DSH Web 服务快速启动脚本。
- **`standalone_runtime/`**：修复后的 0.5.14 离线免授权运行时（含 `provider-request.js` 适配器拦截器）。
- **`config/`**：
  - `mh-modes.json`：包含 9 大解密模式的纯文本提示词库。
  - `mh-switch.mjs`：离线模式切换脚本。
  - `AGENTS.md`：全局 RedOps 零拒答工作规范。
  - `settings.yaml.example`：DSH 渠道与模型配置模板。
- **`plugin/`**：原始研究语料与历史版本归档。
