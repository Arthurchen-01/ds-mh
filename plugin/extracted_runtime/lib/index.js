import { spawn } from "node:child_process";
import { readFile, rename, rm } from "node:fs/promises";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { installWindowsTerminalCompatibility } from "./windows-compat.js";
import { fetchOnlinePrompts, loginOnlineAccount } from "./online.js";
import {
	MH_PROTECTION_ERROR_MESSAGE,
	MH_PROTECTION_MARKER,
	conversationContainsProtectionMarker,
	protectResponseStream,
	protectionError,
	userMessagesContainProtectionMarker
} from "./protection.js";
//#region lib/types/settings.js
/** Durable MHF settings shared by the Host runtime and the browser settings card. */
/** Settings namespace owned by the MHF runtime. */
const MHF_SETTINGS_NAMESPACE = "mhf";
/** Schemastery schema sent to the browser settings transport. */
const MhfSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	promptPackages: z.array(z.object({
		key: z.string(),
		data: z.string()
	})).default([]),
	activePromptPackageKey: z.string().default(""),
	onlinePromptModes: z.array(z.object({
		slug: z.string(),
		name: z.string(),
		description: z.string(),
		version: z.string(),
		updatedAt: z.string()
	})).default([]),
	activeOnlinePromptMode: z.string().default(""),
	// Removed custom-prompt fields are retained only long enough to clear old settings safely.
	customSystemPrompt: z.string().default(""),
	customSystemPromptEnabled: z.boolean().default(false),
	windowsCompatibilityEnabled: z.boolean().default(true),
	windowsGlobalCompatibilityEnabled: z.boolean().default(false),
	experienceOptimizationsEnabled: z.boolean().default(true),
	experienceOptimizations: z.object({
		foregroundDirectoryPicker: z.boolean().default(true),
		chinesePermissionLabels: z.boolean().default(true),
		chineseCommandDescriptions: z.boolean().default(true),
		sessionContextMenu: z.boolean().default(true),
		compactActivityGroups: z.boolean().default(true)
	}).default({}),
	// Legacy single-package fields are read only for one-time migration.
	promptPackageKey: z.string().default(""),
	promptPackageData: z.string().default(""),
	proxyBaseUrl: z.string().default(""),
	modelMappings: z.array(z.object({
		source: z.string(),
		target: z.string(),
		enabled: z.boolean().default(true)
	})).default([])
});
//#endregion
//#region lib/types/prompt-package.js
/** Local encrypted MHF prompt-package format. */
/** Derive the AES key directly from the package filename key. */
function deriveKey(key) {
	return createHash("sha256").update(key, "utf8").digest();
}
/** Encrypt one package; the caller uses the returned key as the filename. */
function encryptPromptPackage(value, key = randomBytes(16).toString("hex")) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(key), iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
	const envelope = {
		format: "mhf-prompt-package/v1",
		meta: {
			packageName: value.packageName,
			description: value.description,
			version: value.version,
			createdAt: value.createdAt
		},
		iv: iv.toString("base64url"),
		tag: cipher.getAuthTag().toString("base64url"),
		ciphertext: ciphertext.toString("base64url")
	};
	return {
		key,
		data: JSON.stringify(envelope)
	};
}
/** Decrypt and validate one imported package envelope. */
function decryptPromptPackage(data, key) {
	const envelope = JSON.parse(data);
	if (envelope.format !== "mhf-prompt-package/v1" || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") throw new Error("invalid MHF prompt package format");
	const decipher = createDecipheriv("aes-256-gcm", deriveKey(key), Buffer.from(envelope.iv, "base64url"));
	decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
	const value = JSON.parse(plaintext);
	if (typeof value.packageName !== "string" || typeof value.description !== "string" || typeof value.version !== "string" || typeof value.createdAt !== "string" || typeof value.systemPrompt !== "string") throw new Error("invalid MHF prompt package payload");
	return value;
}
function promptPackageView(entry) {
	const value = decryptPromptPackage(entry.data, entry.key);
	return {
		key: entry.key,
		packageName: value.packageName,
		description: value.description,
		version: value.version,
		createdAt: value.createdAt
	};
}
//#endregion
//#region lib/types/index.js
/**
* Built-in MH Frame runtime for DeepSeek Harness.
*
* The runtime is intentionally a normal Cordis plugin. It participates in the
 * existing prompt/request waterfalls, so disabling `enabled` returns the
 * exact downstream Harness values and does not create a second proxy process.
*/
/** Resolve a JSON-safe value to a one-line diagnostic string. */
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
const AUTHORIZATION_MAX_AGE_MS = 60_000;
/** MHF runtime service. */
var MhfRuntime = class {
	settings;
	onlinePrompts = /* @__PURE__ */ new Map();
	authorizationStatus = "checking";
	lastCheckedAt;
	requests = 0;
	failures = 0;
	lastError;
	protectionTriggered = false;
	developerAccount = false;
	/** @param initial - composed settings used before the provider is ready. */
	constructor(initial) {
		this.settings = initial;
	}
	/** Replace the current settings snapshot after a settings commit. */
	update(next) {
		this.settings = next;
	}
	authorizationIsFresh(now = Date.now()) {
		if (this.protectionTriggered && !this.developerAccount) return false;
		if (this.authorizationStatus !== "authorized" || typeof this.lastCheckedAt !== "string") return false;
		const checkedAt = Date.parse(this.lastCheckedAt);
		return Number.isFinite(checkedAt) && now - checkedAt <= AUTHORIZATION_MAX_AGE_MS;
	}
	beginOnlineCheck() {
		if (this.protectionTriggered && !this.developerAccount) return false;
		if (this.authorizationIsFresh()) return false;
		this.authorizationStatus = "checking";
		this.onlinePrompts.clear();
		return true;
	}
	applyOnlineModes(modes, replaceAll, developer = false) {
		this.developerAccount = developer === true;
		if (this.protectionTriggered && !this.developerAccount) throw protectionError();
		if (replaceAll) this.onlinePrompts.clear();
		for (const mode of modes) {
			if (mode.systemPrompt.trim() === "") this.onlinePrompts.delete(mode.slug);
			else this.onlinePrompts.set(mode.slug, mode.systemPrompt);
		}
		this.authorizationStatus = "authorized";
		this.lastCheckedAt = new Date().toISOString();
		this.lastError = void 0;
	}
	setOnlineFailure(error) {
		if (this.protectionTriggered && !this.developerAccount) return;
		this.lastCheckedAt = new Date().toISOString();
		this.onlinePrompts.clear();
		if (error?.authorizationDenied === true) {
			this.authorizationStatus = "unauthorized";
		} else {
			this.authorizationStatus = "error";
		}
		this.recordFailure(error);
	}
	/** @returns the current immutable status snapshot. */
	status() {
		const authorized = this.authorizationIsFresh();
		const modes = this.settings.onlinePromptModes ?? [];
		const activeSlug = this.settings.activeOnlinePromptMode || (modes.length === 1 ? modes[0].slug : "");
		const activeMode = modes.find((mode) => mode.slug === activeSlug);
		return {
			enabled: this.settings.enabled,
			promptConfigured: authorized && this.activeSystemPrompt().trim() !== "",
			authorizationStatus: this.protectionTriggered && !this.developerAccount ? "protected" : this.authorizationStatus === "authorized" && !authorized ? "checking" : this.authorizationStatus,
			developerAccount: this.developerAccount,
			protectionMarker: MH_PROTECTION_MARKER,
			protectionTriggered: this.protectionTriggered && !this.developerAccount,
			lastCheckedAt: this.lastCheckedAt,
			windowsCompatibilityEnabled: this.settings.windowsCompatibilityEnabled,
			windowsGlobalCompatibilityEnabled: this.settings.windowsGlobalCompatibilityEnabled,
			toolCount: 0,
			requestCount: this.requests,
			failureCount: this.failures,
			...!authorized || activeMode === void 0 ? {} : {
				modeName: activeMode.name,
				modeVersion: activeMode.version
			},
			...this.lastError === void 0 ? {} : { lastError: this.lastError }
		};
	}
	/** Return the exact active online system prompt held in memory. */
	activeSystemPrompt() {
		if (!this.authorizationIsFresh()) return "";
		const modes = this.settings.onlinePromptModes ?? [];
		const activeSlug = this.settings.activeOnlinePromptMode || (modes.length === 1 ? modes[0].slug : "");
		return this.onlinePrompts.get(activeSlug) ?? "";
	}
	/** Whether MHF should own the session's complete system-prompt slot. */
	shouldReplaceSystemPrompt() {
		return this.authorizationIsFresh() && this.settings.enabled && this.activeSystemPrompt().trim() !== "";
	}
	/** Whether request and response protection should inspect this model call. */
	protectionIsActive() {
		// [PATCH] Anti-leak protection permanently removed
		return false;
	}
	protectionIsTriggered() {
		// [PATCH] Anti-leak protection permanently removed
		return false;
	}
	/** Permanently fail closed for the current Harness process. */
	triggerProtection() {
		// [PATCH] Anti-leak self-destruct trigger permanently removed
	}
	/** Apply an enabled source → target model mapping. */
	transformRequest(config) {
		if (!this.authorizationIsFresh() || !this.settings.enabled) return config;
		const mapping = this.settings.modelMappings.find((item) => item.enabled && item.source === config.model && item.target.trim() !== "");
		return mapping === void 0 ? config : {
			...config,
			model: mapping.target
		};
	}
	/** Count requests entering the active MHF route. */
	recordRequest() {
		this.requests += 1;
	}
	/** Record an execution failure for the status surface. */
	recordFailure(error) {
		this.failures += 1;
		this.lastError = errorText(error);
	}
};
const MHF_SETTINGS_API_PATH = "/api/mhf/settings";
const MHF_ICON_API_PATH = "/api/mhf/icon";
const MHF_SESSION_DELETE_API_PATH = "/api/mhf/session/delete";
const MHF_PICKER_FOREGROUND_API_PATH = "/api/mhf/picker/foreground";
const MHF_SETTING_KEYS = new Set([
	"enabled",
	"windowsCompatibilityEnabled",
	"windowsGlobalCompatibilityEnabled",
	"experienceOptimizationsEnabled",
	"experienceOptimizations",
	"proxyBaseUrl",
	"modelMappings"
]);
function writeJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(body)
	});
	res.end(body);
}
function writePng(res, buffer) {
	res.writeHead(200, {
		"Content-Type": "image/png",
		"Cache-Control": "public, max-age=31536000, immutable",
		"Content-Length": buffer.length
	});
	res.end(buffer);
}
function isTrustedSettingsRequest(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === req.headers.host;
	} catch {
		return false;
	}
}
async function readJsonBody(req) {
	if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new Error("content-type must be application/json");
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 4 * 1024 * 1024) throw new Error("settings request is too large");
		chunks.push(buffer);
	}
	const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("invalid JSON request");
	return body;
}
function settingsView(settings, authorized) {
	if (!authorized) return { enabled: false };
	const promptModes = settings.onlinePromptModes ?? [];
	return {
		enabled: settings.enabled,
		windowsCompatibilityEnabled: settings.windowsCompatibilityEnabled,
		windowsGlobalCompatibilityEnabled: settings.windowsGlobalCompatibilityEnabled,
		promptModes,
		activePromptMode: settings.activeOnlinePromptMode || (promptModes.length === 1 ? promptModes[0].slug : ""),
		experienceOptimizationsEnabled: settings.experienceOptimizationsEnabled,
		experienceOptimizations: settings.experienceOptimizations
	};
}
function settingsResponse(scope, runtime, writable) {
	const authorized = runtime.authorizationIsFresh();
	return { ok: true, writable, value: settingsView(scope.get(), authorized), status: runtime.status() };
}
async function updateSettings(scope, runtime, patch) {
	await scope.update(patch);
	runtime.update(scope.get());
}
async function applySettingsRequest(scope, runtime, body, refreshOnlinePrompts, loginOnline) {
	if (typeof body.action === "string") {
		const current = scope.get();
		if (body.action === "login-online") {
			await loginOnline(String(body.identifier ?? ""), typeof body.password === "string" ? body.password : "");
			return;
		}
		if (body.action === "refresh-online-prompts") {
			const mode = body.mode === void 0 ? void 0 : String(body.mode);
			if (mode !== void 0 && !/^[a-z0-9-]{1,48}$/.test(mode)) throw new Error("提示词模式无效");
			await refreshOnlinePrompts(mode);
			return;
		}
		if (body.action === "activate-online-mode") {
			if (!runtime.authorizationIsFresh()) throw new Error("当前设备未获得授权");
			const mode = String(body.mode ?? "");
			if (!current.onlinePromptModes.some((entry) => entry.slug === mode && entry.version.trim() !== "")) throw new Error("提示词模式不存在或尚未发布版本");
			await updateSettings(scope, runtime, { activeOnlinePromptMode: mode });
			return;
		}
		throw new Error(`unknown MHF settings action: ${body.action}`);
	}
	if (!runtime.authorizationIsFresh()) throw new Error("当前设备未获得授权");
	if (typeof body.patch !== "object" || body.patch === null || Array.isArray(body.patch)) throw new Error("invalid settings patch");
	for (const key of Object.keys(body.patch)) if (!MHF_SETTING_KEYS.has(key)) throw new Error(`unknown MHF setting: ${key}`);
	await updateSettings(scope, runtime, body.patch);
}
async function clearLegacyPackages(scope, runtime) {
	const current = scope.get();
	if (current.promptPackages.length === 0 && current.promptPackageKey === "" && current.promptPackageData === "") return;
	await updateSettings(scope, runtime, {
		promptPackages: [],
		activePromptPackageKey: "",
		promptPackageKey: "",
		promptPackageData: ""
	});
}
async function clearRemovedCustomPrompt(scope, runtime) {
	const current = scope.get();
	if (current.customSystemPrompt === "" && !current.customSystemPromptEnabled) return;
	await updateSettings(scope, runtime, {
		customSystemPrompt: "",
		customSystemPromptEnabled: false
	});
}
let pickerForegroundWatcher;
function startPickerForegroundWatcher() {
	if (process.platform !== "win32" || pickerForegroundWatcher?.exitCode === null) return;
	const script = "$s='using System; using System.Runtime.InteropServices; public static class MHFPicker { [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string n); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f); }'; Add-Type $s; $d=[DateTime]::UtcNow.AddSeconds(8); do { $h=[MHFPicker]::FindWindow($null,'Select Workspace Directory'); if($h -ne [IntPtr]::Zero){ [MHFPicker]::ShowWindow($h,5)|Out-Null; [MHFPicker]::SetWindowPos($h,[IntPtr](-1),0,0,0,0,67)|Out-Null; [MHFPicker]::SetForegroundWindow($h)|Out-Null; Start-Sleep -Milliseconds 120; [MHFPicker]::SetWindowPos($h,[IntPtr](-2),0,0,0,0,3)|Out-Null; break }; Start-Sleep -Milliseconds 100 } while([DateTime]::UtcNow -lt $d)";
	pickerForegroundWatcher = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
		windowsHide: true,
		stdio: "ignore"
	});
	pickerForegroundWatcher.once("exit", () => {
		pickerForegroundWatcher = void 0;
	});
	pickerForegroundWatcher.unref();
}
/** Register MHF and its settings namespace. */
function apply(ctx, config = {}) {
	const base = {
		enabled: config.enabled ?? true,
		promptPackages: config.promptPackages ?? [],
		activePromptPackageKey: config.activePromptPackageKey ?? "",
		onlinePromptModes: config.onlinePromptModes ?? [],
		activeOnlinePromptMode: config.activeOnlinePromptMode ?? "",
		windowsCompatibilityEnabled: config.windowsCompatibilityEnabled ?? true,
		windowsGlobalCompatibilityEnabled: config.windowsGlobalCompatibilityEnabled ?? false,
		experienceOptimizationsEnabled: config.experienceOptimizationsEnabled ?? true,
		experienceOptimizations: config.experienceOptimizations ?? {},
		proxyBaseUrl: config.proxyBaseUrl ?? "",
		promptPackageKey: config.promptPackageKey ?? "",
		promptPackageData: config.promptPackageData ?? "",
		modelMappings: config.modelMappings ?? []
	};
	ctx.inject(["settings"], (settingsHost) => {
		const scope = settingsHost.settings.register(settingsNamespace("mhf"), MhfSettingsSchema, { base });
		const runtime = new MhfRuntime(scope.get());
		let syncPromptScopes = () => {};
		let refreshQueue = Promise.resolve();
		const refreshOnlinePrompts = (mode) => {
			const run = async () => {
				if (runtime.protectionIsTriggered()) throw protectionError();
				if (runtime.beginOnlineCheck()) syncPromptScopes(true);
				try {
					const result = await fetchOnlinePrompts(mode);
					const current = scope.get();
					const incoming = result.modes.map(({ systemPrompt: _systemPrompt, ...metadata }) => metadata);
					let onlinePromptModes;
					if (mode === void 0) {
						onlinePromptModes = incoming;
					} else {
						const replacements = new Map(incoming.map((item) => [item.slug, item]));
						onlinePromptModes = current.onlinePromptModes.map((item) => replacements.get(item.slug) ?? item);
						for (const item of incoming) if (!onlinePromptModes.some((existing) => existing.slug === item.slug)) onlinePromptModes.push(item);
					}
					const activeCandidate = current.activeOnlinePromptMode;
					const activeOnlinePromptMode = onlinePromptModes.some((item) => item.slug === activeCandidate && item.version.trim() !== "")
						? activeCandidate
						: onlinePromptModes.find((item) => item.version.trim() !== "")?.slug ?? "";
					runtime.applyOnlineModes(result.modes, mode === void 0, result.developer);
					await updateSettings(scope, runtime, { onlinePromptModes, activeOnlinePromptMode });
					return true;
				} catch (error) {
					runtime.setOnlineFailure(error);
					syncPromptScopes(true);
					throw error;
				}
			};
			refreshQueue = refreshQueue.then(run, run);
			return refreshQueue;
		};
		const loginOnline = async (identifier, password) => {
			if (runtime.protectionIsTriggered()) throw protectionError();
			if (runtime.beginOnlineCheck()) syncPromptScopes(true);
			try {
				await loginOnlineAccount(identifier, password);
			} catch (error) {
				runtime.setOnlineFailure(error);
				syncPromptScopes(true);
				throw error;
			}
			await refreshOnlinePrompts();
		};
		settingsHost.provide("mhf", runtime);
		scope.watch((next) => {
			runtime.update(next);
			// Re-registering emits system-prompt/change so no agent can retain a
			// cached prompt after a package switch or an enable/disable change.
			syncPromptScopes(true);
		});
		void clearLegacyPackages(scope, runtime).catch((error) => {
			runtime.recordFailure(error);
		});
		void clearRemovedCustomPrompt(scope, runtime).catch((error) => {
			runtime.recordFailure(error);
		});
		settingsHost.inject(["subprocess", "agents", "agentPresets"], (subprocessHost) => {
			subprocessHost.effect(
				() => installWindowsTerminalCompatibility(
					subprocessHost,
					() => runtime.authorizationIsFresh()
						? scope.get()
						: { ...scope.get(), windowsCompatibilityEnabled: false, windowsGlobalCompatibilityEnabled: false },
					(spec) => {
						const sessionId = spec.env?.DSH_SESSION_ID;
						if (typeof sessionId !== "string") return false;
						const agent = subprocessHost.agents.get(sessionId);
						return agent !== void 0 && subprocessHost.agentPresets.composedPreset(agent.ctx) === "minimal";
					}
				),
				"mhf: Windows terminal compatibility"
			);
		});
		settingsHost.inject(["webServer", "sessionPersistence", "workspaceRegistry", "sessions"], (httpHost) => {
			httpHost.effect(() => httpHost.webServer.register({
				kind: "exact",
				path: MHF_ICON_API_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") {
						res.setHeader("Allow", "GET");
						writeJson(res, 405, { ok: false, error: "method not allowed" });
						return;
					}
					try {
						writePng(res, await readFile(new URL("./mhf-icon.png", import.meta.url)));
					} catch (error) {
						writeJson(res, 500, { ok: false, error: errorText(error) });
					}
				}
			}), "mhf: icon API");
			httpHost.effect(() => httpHost.webServer.register({
				kind: "exact",
				path: MHF_SETTINGS_API_PATH,
				handler: async (req, res) => {
					if (!isTrustedSettingsRequest(req)) {
						writeJson(res, 403, { ok: false, error: "forbidden" });
						return;
					}
					if (req.method === "GET") {
						writeJson(res, 200, settingsResponse(scope, runtime, settingsHost.settings.writable));
						return;
					}
					if (req.method !== "PATCH") {
						res.setHeader("Allow", "GET, PATCH");
						writeJson(res, 405, { ok: false, error: "method not allowed" });
						return;
					}
					if (!settingsHost.settings.writable) {
						writeJson(res, 409, { ok: false, error: "settings are read-only" });
						return;
					}
					try {
						await applySettingsRequest(scope, runtime, await readJsonBody(req), refreshOnlinePrompts, loginOnline);
						writeJson(res, 200, settingsResponse(scope, runtime, true));
					} catch (error) {
						writeJson(res, 400, { ok: false, error: errorText(error) });
					}
				}
			}), "mhf: local settings API");
			httpHost.effect(() => httpHost.webServer.register({
				kind: "exact",
				path: MHF_PICKER_FOREGROUND_API_PATH,
				handler: (req, res) => {
					if (!isTrustedSettingsRequest(req)) {
						writeJson(res, 403, { ok: false, error: "forbidden" });
						return;
					}
					if (req.method !== "POST") {
						res.setHeader("Allow", "POST");
						writeJson(res, 405, { ok: false, error: "method not allowed" });
						return;
					}
					const current = scope.get();
					if (runtime.authorizationIsFresh() && current.experienceOptimizationsEnabled && current.experienceOptimizations.foregroundDirectoryPicker) startPickerForegroundWatcher();
					writeJson(res, 200, { ok: true });
				}
			}), "mhf: folder picker foreground API");
			httpHost.effect(() => httpHost.webServer.register({
				kind: "exact",
				path: MHF_SESSION_DELETE_API_PATH,
				handler: async (req, res) => {
					if (!isTrustedSettingsRequest(req)) {
						writeJson(res, 403, { ok: false, error: "forbidden" });
						return;
					}
					if (req.method !== "POST") {
						res.setHeader("Allow", "POST");
						writeJson(res, 405, { ok: false, error: "method not allowed" });
						return;
					}
					try {
						const current = scope.get();
						if (!runtime.authorizationIsFresh()) throw new Error("当前设备未获得授权");
						if (!current.experienceOptimizationsEnabled || !current.experienceOptimizations.sessionContextMenu) throw new Error("会话菜单优化未开启");
						const body = await readJsonBody(req);
						if (typeof body.sessionId !== "string" || body.sessionId.trim() === "") throw new Error("会话编号无效");
						if (httpHost.sessions.get(body.sessionId) !== void 0) throw new Error("该会话仍在运行，请先切换到其他会话后再删除");
						const header = (await httpHost.sessionPersistence.list()).find((entry) => String(entry.id) === body.sessionId);
						if (header === void 0) throw new Error("没有找到该会话的本地记录");
						const location = httpHost.sessionPersistence.locate(header);
						if (location === void 0 || location.kind !== "jsonl") throw new Error("当前会话存储模式不支持直接删除");
						const pending = `${location.path}.mhf-delete-${String(process.pid)}-${String(Date.now())}`;
						await rename(location.path, pending);
						try {
							await httpHost.workspaceRegistry.archiveSession(header.id);
						} catch (error) {
							await rename(pending, location.path);
							throw error;
						}
						await rm(pending, { force: true });
						writeJson(res, 200, { ok: true, sessionId: body.sessionId });
					} catch (error) {
						writeJson(res, 400, { ok: false, error: errorText(error) });
					}
				}
			}), "mhf: session delete API");
		});
		settingsHost.inject(["systemPrompt", "agents"], (promptHost) => {
			const promptScopes = /* @__PURE__ */ new Map();
			const disposePrompt = (agent) => {
				const dispose = promptScopes.get(agent);
				if (dispose === void 0) return;
				promptScopes.delete(agent);
				dispose();
			};
			const syncAgent = (agent, refresh = false) => {
				if (refresh) disposePrompt(agent);
				if (!runtime.shouldReplaceSystemPrompt() || promptScopes.has(agent)) return;
				try {
					const dispose = agent.ctx.systemPrompt.section({
						name: "deployment:persona",
						order: 0,
						text: () => runtime.activeSystemPrompt(),
						complete: true
					});
					promptScopes.set(agent, dispose);
				} catch (error) {
					runtime.recordFailure(error);
				}
			};
			syncPromptScopes = (refresh = false) => {
				const live = new Set(promptHost.agents.list());
				for (const agent of promptScopes.keys()) if (!live.has(agent)) promptScopes.delete(agent);
				for (const agent of live) syncAgent(agent, refresh);
			};
			promptHost.on("agent/created", ({ agent }) => {
				syncAgent(agent);
			});
			promptHost.on("agent/disposed", ({ agent }) => {
				// The agent scope owns the section and already disposed it.
				promptScopes.delete(agent);
			});
			promptHost.effect(() => {
				syncPromptScopes();
				return () => {
					syncPromptScopes = () => {};
					for (const agent of [...promptScopes.keys()]) disposePrompt(agent);
				};
			}, "mhf: scoped complete system prompts");
		});
		settingsHost.on("agent/request", async (_payload, next) => {
			if (runtime.protectionIsTriggered()) throw protectionError();
			if (!runtime.authorizationIsFresh()) await refreshOnlinePrompts().catch(() => {});
			const request = await next();
			if (!runtime.authorizationIsFresh() || !runtime.status().enabled) return request;
			runtime.recordRequest();
			return runtime.transformRequest(request);
		});
		settingsHost.on("agent/pre-step", async (_payload, next) => {
			// [PATCH] Anti-leak pre-step inspection completely removed
			return next();
		});
		settingsHost.on("llm/stream", (_options, next) => {
			// [PATCH] Anti-leak stream inspection completely removed
			return next();
		});
		settingsHost.effect(() => {
			void refreshOnlinePrompts().catch(() => {});
			const timer = setInterval(() => void refreshOnlinePrompts().catch(() => {}), 30_000);
			return () => clearInterval(timer);
		}, "mhf: online authorization and prompt refresh");
	});
}
//#endregion
export { MH_PROTECTION_MARKER } from "./protection.js";
export { MHF_SETTINGS_NAMESPACE, MhfRuntime, MhfSettingsSchema, apply, apply as default, decryptPromptPackage, encryptPromptPackage };
