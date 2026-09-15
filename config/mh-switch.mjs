import fs from "fs";
import path from "path";

const CONFIG_DIR = path.join(process.env.USERPROFILE || "", ".config", "opencode");
const CONFIG_PATH = path.join(CONFIG_DIR, "mh-config.json");
const MODES_PATH = path.join(CONFIG_DIR, "mh-modes.json");
const PROMPT_PATH = path.join(CONFIG_DIR, "custom_system_prompt.txt");

function readJson(p, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJson(p, val) {
  fs.writeFileSync(p, JSON.stringify(val, null, 2), "utf8");
}

const args = process.argv.slice(2);
const command = args[0] || "status";

async function main() {
  const config = readJson(CONFIG_PATH, {
    enabled: true,
    activeMode: "general",
    autoSyncCloud: true,
    syncIntervalMinutes: 5,
    modelMappings: []
  });

  const modes = readJson(MODES_PATH, {});

  if (command === "status" || command === "info") {
    console.log("==================================================");
    console.log("   OpenCode MHF (Model Hacker Frame) 状态看板");
    console.log("==================================================");
    console.log(`- 引擎状态:       ${config.enabled ? "\x1b[32m已启用 (ENABLED)\x1b[0m" : "\x1b[31m已停用 (DISABLED)\x1b[0m"}`);
    console.log(`- 当前激活模式:   \x1b[36m${config.activeMode}\x1b[0m (${modes[config.activeMode]?.name || "未知"})`);
    console.log(`- 模式版本:       ${modes[config.activeMode]?.version || "N/A"}`);
    console.log(`- 自动云同步:     ${config.autoSyncCloud ? "是" : "否"}`);
    console.log(`- 上次同步时间:   ${config.lastSyncTime || "未同步"}`);
    console.log(`- 模型映射数:     ${config.modelMappings?.length || 0}`);
    console.log("--------------------------------------------------");
    console.log("可用命令:");
    console.log("  mh-switch list              查看全部可用模式");
    console.log("  mh-switch set <mode_slug>   切换激活模式 (如 general)");
    console.log("  mh-switch sync              立即与 MHF 云端同步拉取最新提示词");
    console.log("  mh-switch enable / disable  开启/关闭系统提示词接管");
    console.log("==================================================");
    return;
  }

  if (command === "list") {
    console.log("--------------------------------------------------------------------------------");
    console.log("模式标识 (slug)        模式名称       版本       字符数   当前状态");
    console.log("--------------------------------------------------------------------------------");
    for (const [slug, m] of Object.entries(modes)) {
      const isCur = slug === config.activeMode ? "\x1b[32m* [当前激活]\x1b[0m" : "";
      const len = m.systemPrompt ? m.systemPrompt.length : (slug === "custom" ? "读取txt" : 0);
      console.log(`${slug.padEnd(22)} ${(m.name || "").padEnd(12)} ${(m.version || "").padEnd(10)} ${String(len).padEnd(8)} ${isCur}`);
    }
    console.log("--------------------------------------------------------------------------------");
    return;
  }

  if (command === "set") {
    const target = args[1];
    if (!target) {
      console.error("错误: 请指定要切换的模式标识，例如: mh-switch set general");
      return;
    }
    if (!modes[target] && target !== "custom") {
      console.error(`错误: 模式 [${target}] 不存在。请运行 mh-switch list 查看可用模式。`);
      return;
    }
    config.activeMode = target;
    writeJson(CONFIG_PATH, config);
    console.log(`\x1b[32m[OK] 已成功切换至模式: ${target} (${modes[target]?.name || "本地自定义"})\x1b[0m`);
    console.log("OpenCode 插件热监听已触发，后续会话将即刻应用该提示词！");
    return;
  }

  if (command === "enable") {
    config.enabled = true;
    writeJson(CONFIG_PATH, config);
    console.log("\x1b[32m[OK] MHF 引擎已开启！\x1b[0m");
    return;
  }

  if (command === "disable") {
    config.enabled = false;
    writeJson(CONFIG_PATH, config);
    console.log("\x1b[33m[OK] MHF 引擎已停用，OpenCode 将使用默认提示词。\x1b[0m");
    return;
  }

  if (command === "sync") {
    console.log("正在与 MHF 云端 (8.137.193.226) 进行 X25519 协商与提示词同步...");
    const dshOnlinePath = "C:/Users/25472/.dsh/profiles/web/node_modules/@mh-frame/dsh-mhf-runtime/lib/online.js";
    if (!fs.existsSync(dshOnlinePath)) {
      console.error("未找到在线拉取组件");
      return;
    }
    const { fetchOnlinePrompts } = await import("file:///" + dshOnlinePath);
    const result = await fetchOnlinePrompts();
    for (const m of result.modes) {
      modes[m.slug] = {
        slug: m.slug,
        name: m.name,
        version: m.version,
        updatedAt: m.updatedAt,
        systemPrompt: m.systemPrompt
      };
    }
    writeJson(MODES_PATH, modes);
    config.lastSyncTime = new Date().toISOString();
    writeJson(CONFIG_PATH, config);
    console.log(`\x1b[32m[OK] 同步成功！共更新 ${result.modes.length} 个在线模式。\x1b[0m`);
    return;
  }

  console.log(`未知命令: ${command}。请运行 mh-switch 查看帮助。`);
}

main().catch(console.error);
