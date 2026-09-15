window.__ModuleLoader__.load({
	id: "@mh-frame/dsh-mhf-runtime",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { useState, useSyncExternalStore } = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");

const MHF_SETTINGS_API_PATH = "/api/mhf/settings";
const MHF_SESSION_DELETE_API_PATH = "/api/mhf/session/delete";
const MHF_PICKER_FOREGROUND_API_PATH = "/api/mhf/picker/foreground";
const MHF_STYLE_ID = "mhf-plugin-styles";
const MHF_ICON_URL = "/api/mhf/icon";
const MH_PROTECTION_MARKER = "MH-PROTECTED";

class MhfSettingsScope {
	constructor() {
		this.listeners = new Set();
		this.state = { status: "loading", writable: false, value: void 0, error: void 0 };
		this.queue = Promise.resolve();
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	getSnapshot() {
		return this.state;
	}
	publish(next) {
		this.state = next;
		for (const listener of this.listeners) listener();
	}
	async request(method, payload) {
		const response = await fetch(MHF_SETTINGS_API_PATH, {
			method,
			cache: "no-store",
			headers: {
				"X-MH-Protection": MH_PROTECTION_MARKER,
				...(payload === void 0 ? {} : { "Content-Type": "application/json" })
			},
			...(payload === void 0 ? {} : {
				body: JSON.stringify(payload)
			})
		});
		const body = await response.json();
		if (!response.ok || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`);
		return body;
	}
	async refresh() {
		try {
			const body = await this.request("GET");
			this.publish({ status: "ready", writable: body.writable === true, value: body.value, runtimeStatus: body.status, error: void 0 });
		} catch (error) {
			this.publish({ ...this.state, status: "unavailable", writable: false, error: String(error) });
		}
	}
	enqueue(payload) {
		const write = async () => {
			try {
				const body = await this.request("PATCH", payload);
				this.publish({ status: "ready", writable: body.writable === true, value: body.value, runtimeStatus: body.status, error: void 0 });
				return true;
			} catch (error) {
				this.publish({ ...this.state, error: String(error) });
				return false;
			}
		};
		this.queue = this.queue.then(write, write);
		return this.queue;
	}
	set(key, value) {
		return this.enqueue({ patch: { [key]: value } });
	}
	action(action, value = {}) {
		return this.enqueue({ action, ...value });
	}
}

function Toggle({ checked, disabled, onChange, label, compact = false }) {
	return jsx("button", {
		type: "button",
		role: "switch",
		"aria-checked": checked,
		"aria-label": label,
		title: label,
		disabled,
		className: `mhf-switch${compact ? " mhf-switch-compact" : ""}`,
		onClick: () => onChange(!checked),
		children: jsx("span", { className: "mhf-switch-thumb" })
	});
}

function OnlinePromptRow({ item, active, disabled, checking, onCheck, scope, t }) {
	return jsxs("div", {
		className: `mhf-package-row${active ? " is-active" : ""}`,
		children: [
			jsxs("div", {
				className: "mhf-package-copy",
				children: [
					jsxs("div", {
						className: "mhf-package-title",
						children: [
							jsx("strong", { children: item.name }),
							jsx("span", { className: "mhf-version", children: item.version ? `v${item.version}` : t("modeUnpublished") }),
							active && jsx("span", { className: "mhf-active-tag", children: t("packageActive") })
						]
					}),
					jsx("p", { children: item.description || t("packageNoDescription") })
				]
			}),
			jsxs("div", {
				className: "mhf-package-actions",
				children: [
					jsx("button", {
						type: "button",
						className: "mhf-button mhf-check-button",
						disabled,
						"aria-busy": checking,
						onClick: onCheck,
						children: jsxs("span", { className: "mhf-button-content", children: [
							checking && jsx("span", { className: "mhf-button-spinner", "aria-hidden": true }),
							checking ? t("checkingUpdates") : t("modeCheckUpdate")
						] })
					}),
					jsx("button", {
						type: "button",
						className: "mhf-button mhf-button-primary",
						disabled: disabled || active || !item.version,
						onClick: () => scope.action("activate-online-mode", { mode: item.slug }),
						children: active ? t("packageInUse") : t("packageEnable")
					})
				]
			})
		]
	});
}

const OPTIMIZATION_ITEMS = [
	["foregroundDirectoryPicker", "optimizationPicker", "optimizationPickerDesc"],
	["chinesePermissionLabels", "optimizationPermission", "optimizationPermissionDesc"],
	["chineseCommandDescriptions", "optimizationCommands", "optimizationCommandsDesc"],
	["sessionContextMenu", "optimizationSessions", "optimizationSessionsDesc"],
	["compactActivityGroups", "optimizationActivity", "optimizationActivityDesc"]
];

function MhfSettingsSection({ scope, t }) {
	const state = useSyncExternalStore((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [checkingMode, setCheckingMode] = useState(null);
	const authorizationStatus = state.runtimeStatus?.authorizationStatus ?? "checking";
	const authorized = authorizationStatus === "authorized";
	if (authorizationStatus === "protected") {
		return jsxs("section", {
			className: "mhf-settings mhf-authorization-only mhf-protection-triggered",
			children: [
				jsx("img", { className: "mhf-auth-mark", src: MHF_ICON_URL, alt: "" }),
				jsxs("div", { className: "mhf-auth-copy", children: [
					jsx("h2", { children: t("protectionTriggeredTitle") }),
					jsx("p", { children: state.runtimeStatus?.lastError ?? t("protectionTriggeredDescription") }),
					jsx("code", { className: "mhf-protection-marker", children: MH_PROTECTION_MARKER })
				] })
			]
		});
	}
	if (!authorized) {
		const checking = authorizationStatus === "checking" && state.status !== "unavailable";
		const message = state.error
			?? state.runtimeStatus?.lastError
			?? (checking ? t("checkingAuthorization") : authorizationStatus === "error" ? t("onlineError") : t("unauthorized"));
		const submitLogin = async (event) => {
			event.preventDefault();
			if (submitting || identifier.trim() === "" || password === "") return;
			setSubmitting(true);
			try {
				await scope.action("login-online", { identifier: identifier.trim(), password });
				setPassword("");
			} finally {
				setSubmitting(false);
			}
		};
		return jsxs("section", {
			className: "mhf-settings mhf-authorization-only",
			children: [
				jsx("img", { className: "mhf-auth-mark", src: MHF_ICON_URL, alt: "" }),
				jsxs("div", { className: "mhf-auth-copy", children: [
					jsx("h2", { children: checking ? t("checkingAuthorizationTitle") : t("unauthorized") }),
					jsx("p", { children: message })
				] }),
				jsxs("form", { className: "mhf-login-form", onSubmit: submitLogin, children: [
					jsxs("label", { children: [
						jsx("span", { children: t("account") }),
						jsx("input", { type: "text", name: "identifier", autoComplete: "username", value: identifier, disabled: submitting, onChange: (event) => setIdentifier(event.target.value), placeholder: t("accountPlaceholder") })
					] }),
					jsxs("label", { children: [
						jsx("span", { children: t("password") }),
						jsx("input", { type: "password", name: "password", autoComplete: "current-password", value: password, disabled: submitting, onChange: (event) => setPassword(event.target.value), placeholder: t("passwordPlaceholder") })
					] }),
					jsxs("div", { className: "mhf-auth-actions", children: [
						jsx("button", { type: "submit", className: "mhf-button mhf-button-primary", disabled: submitting || identifier.trim() === "" || password === "", children: submitting ? t("loggingIn") : t("login") }),
						jsx("button", { type: "button", className: "mhf-button", disabled: submitting || checking, onClick: () => scope.action("refresh-online-prompts"), children: t("recheck") })
					] })
				] })
			]
		});
	}
	const value = state.value;
	const enabled = value?.enabled ?? true;
	const disabled = state.status !== "ready" || !state.writable;
	const promptModes = value?.promptModes ?? [];
	const activeMode = value?.activePromptMode ?? "";
	const windowsCompatibilityEnabled = value?.windowsCompatibilityEnabled ?? true;
	const windowsGlobalCompatibilityEnabled = value?.windowsGlobalCompatibilityEnabled ?? false;
	const optimizationMaster = value?.experienceOptimizationsEnabled ?? true;
	const optimizationValues = value?.experienceOptimizations ?? {};
	const checkUpdates = async (mode = null) => {
		if (disabled || checkingMode !== null) return;
		setCheckingMode(mode ?? "__all__");
		try {
			await scope.action("refresh-online-prompts", mode === null ? {} : { mode });
		} finally {
			setCheckingMode(null);
		}
	};
	const setOptimization = (key, checked) => {
		scope.set("experienceOptimizations", { ...optimizationValues, [key]: checked });
	};
	return jsxs("section", {
		className: "mhf-settings",
		children: [
			jsxs("header", {
				className: "mhf-settings-header",
				children: [
					jsx("img", { className: "mhf-brand-mark", src: MHF_ICON_URL, alt: "" }),
					jsxs("div", { children: [
						jsx("h2", { children: t("title") }),
						jsx("p", { children: t("description") })
					] }),
					jsx("span", { className: "mhf-local-badge", children: t("onlinePlugin") })
				]
			}),
			jsxs("div", {
				className: "mhf-control-row",
				children: [
					jsxs("div", { children: [
						jsx("strong", { children: t("coreSwitch") }),
						jsx("p", { children: enabled ? t("coreEnabledDesc") : t("coreDisabledDesc") })
					] }),
					Toggle({ checked: enabled, disabled, onChange: (checked) => scope.set("enabled", checked), label: enabled ? t("enabled") : t("disabled") })
				]
			}),
			jsxs("div", {
				className: "mhf-control-row mhf-protection-row",
				children: [
					jsxs("div", { children: [
						jsx("strong", { children: t("protectionTitle") }),
						jsxs("p", { children: [jsx("code", { children: MH_PROTECTION_MARKER }), ` · ${t("protectionDescription")}`] })
					] }),
					jsx("span", { className: "mhf-protection-state", children: t("protectionEnabled") })
				]
			}),
			jsxs("div", {
				className: "mhf-section-block",
				children: [
					jsxs("div", {
						className: "mhf-section-heading",
						children: [
							jsxs("div", { children: [
								jsx("h3", { children: t("onlinePrompts") }),
								jsx("p", { children: t("onlinePromptsDescription") })
							] }),
							jsx("button", {
								type: "button",
								className: "mhf-import-button mhf-check-button",
								disabled: disabled || checkingMode !== null,
								"aria-busy": checkingMode === "__all__",
								onClick: () => void checkUpdates(),
								children: jsxs("span", { className: "mhf-button-content", children: [
									checkingMode === "__all__" && jsx("span", { className: "mhf-button-spinner", "aria-hidden": true }),
									checkingMode === "__all__" ? t("checkingUpdates") : t("checkAllUpdates")
								] })
							})
						]
					}),
					promptModes.length === 0
						? jsx("div", { className: "mhf-empty", children: state.runtimeStatus?.authorizationStatus === "unauthorized" ? t("unauthorized") : t("onlineEmpty") })
						: jsx("div", {
							className: "mhf-package-list",
							children: promptModes.map((item) => jsx(OnlinePromptRow, {
								item,
								active: item.slug === activeMode,
								disabled: disabled || checkingMode !== null,
								checking: checkingMode === item.slug,
								onCheck: () => void checkUpdates(item.slug),
								scope,
								t
							}, item.slug))
						})
				]
			}),
			jsxs("div", {
				className: "mhf-compatibility-block",
				children: [
					jsxs("div", {
						className: "mhf-control-row mhf-compatibility-row",
						children: [
							jsxs("div", { children: [
								jsx("strong", { children: t("windowsCompatibility") }),
								jsx("p", { children: t("windowsCompatibilityDescription") })
							] }),
							Toggle({ checked: windowsCompatibilityEnabled, disabled, onChange: (checked) => scope.set("windowsCompatibilityEnabled", checked), label: t("windowsCompatibility") })
						]
					}),
					jsxs("div", {
						className: "mhf-control-row mhf-global-compatibility-row",
						children: [
							jsxs("div", { children: [
								jsx("strong", { children: t("windowsGlobalCompatibility") }),
								jsx("p", { children: t("windowsGlobalCompatibilityDescription") })
							] }),
							Toggle({ checked: windowsGlobalCompatibilityEnabled, disabled: disabled || !windowsCompatibilityEnabled, onChange: (checked) => scope.set("windowsGlobalCompatibilityEnabled", checked), label: t("windowsGlobalCompatibility"), compact: true })
						]
					})
				]
			}),
			jsxs("div", {
				className: "mhf-section-block mhf-optimization-block",
				children: [
					jsxs("div", {
						className: "mhf-control-row mhf-control-row-plain",
						children: [
							jsxs("div", { children: [
								jsx("h3", { children: t("optimization") }),
								jsx("p", { children: t("optimizationDescription") })
							] }),
							Toggle({ checked: optimizationMaster, disabled, onChange: (checked) => scope.set("experienceOptimizationsEnabled", checked), label: t("optimization") })
						]
					}),
					jsx("div", {
						className: "mhf-optimization-list",
						children: OPTIMIZATION_ITEMS.map(([key, titleKey, descriptionKey]) => jsxs("div", {
							className: "mhf-optimization-row",
							children: [
								jsxs("div", { children: [
									jsx("strong", { children: t(titleKey) }),
									jsx("p", { children: t(descriptionKey) })
								] }),
								Toggle({ checked: optimizationValues[key] ?? true, disabled: disabled || !optimizationMaster, onChange: (checked) => setOptimization(key, checked), label: t(titleKey), compact: true })
							]
						}, key))
					})
				]
			}),
			jsx("div", {
				className: `mhf-status-line${state.error || ["unauthorized", "error"].includes(state.runtimeStatus?.authorizationStatus) ? " is-error" : ""}`,
				children: state.error ?? (state.runtimeStatus?.authorizationStatus === "unauthorized" ? t("unauthorized") : state.runtimeStatus?.authorizationStatus === "error" ? (state.runtimeStatus?.lastError ?? t("onlineError")) : state.runtimeStatus?.authorizationStatus === "checking" ? t("checkingAuthorization") : state.status === "ready" ? t("ready") : t("unavailable"))
			})
		]
	});
}

function openMhfSettings() {
	const selectMhf = () => {
		const dialog = document.querySelector('[role="dialog"]');
		if (!dialog) return false;
		const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "MH Frame");
		if (!button) return false;
		button.click();
		return true;
	};
	if (selectMhf()) return;
	const settingsButton = [...document.querySelectorAll("button")].find((button) => {
		if (button.closest('[role="dialog"]') !== null) return false;
		const names = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
			.map((value) => value?.trim())
			.filter(Boolean);
		return names.includes("设置") || names.includes("Settings");
	});
	settingsButton?.click();
	let attempts = 0;
	const timer = window.setInterval(() => {
		attempts += 1;
		if (selectMhf() || attempts >= 20) window.clearInterval(timer);
	}, 40);
}

function MhfSidebarAction({ wide, scope, t }) {
	const state = useSyncExternalStore((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
	const enabled = state.value?.enabled ?? true;
	const authorizationStatus = state.runtimeStatus?.authorizationStatus;
	const disabled = state.status !== "ready" || !state.writable || authorizationStatus !== "authorized";
	const activeMode = state.value?.activePromptMode ?? "";
	const activePrompt = (state.value?.promptModes ?? []).find((item) => item.slug === activeMode);
	return jsxs("div", {
		className: "mhf-sidebar-status",
		"data-wide": wide ? "true" : "false",
		"data-enabled": enabled && authorizationStatus === "authorized" ? "true" : "false",
		children: [
			jsxs("button", {
				type: "button",
				className: "mhf-sidebar-main",
				title: t("openSettings"),
				"aria-label": t("openSettings"),
				onClick: openMhfSettings,
				children: [
					jsx("span", { className: "mhf-sidebar-logo", children: jsx("img", { className: "mhf-sidebar-logo-image", src: MHF_ICON_URL, alt: "" }) }),
					wide && jsxs("span", { className: "mhf-sidebar-copy", children: [
						jsx("strong", { children: "MH Frame" }),
						jsx("small", { children: authorizationStatus === "protected" ? t("protectionTriggeredTitle") : enabled ? (authorizationStatus === "unauthorized" ? t("unauthorized") : authorizationStatus === "checking" ? t("checkingAuthorization") : activePrompt ? `${activePrompt.name} ${activePrompt.version || "-"}` : t("noActivePackage")) : t("disabled") })
					] })
				]
			}),
			jsx("span", {
				className: "mhf-sidebar-toggle",
				onClick: (event) => event.stopPropagation(),
				children: Toggle({ checked: enabled, disabled, onChange: (checked) => scope.set("enabled", checked), label: enabled ? t("enabled") : t("disabled"), compact: !wide })
			})
		]
	});
}

const PERMISSION_TEXT = new Map([
	["Read Only", "只读"],
	["Workspace Write", "仅工作区"],
	["Full access", "完全访问"]
]);
const COMMAND_TEXT = new Map([
	["Download this Session log as a ZIP archive", "将此会话日志下载为 ZIP 压缩包"],
	["record feedback about this session", "记录关于当前会话的反馈"],
	["set or view the goal for a long-running task", "设置或查看长期任务目标"],
	["Switch the permission preset (sandbox mode + approval policy)", "切换权限预设（沙箱模式和审批策略）"],
	["Select the model for this session", "选择本会话使用的模型"]
]);

function installExperienceOptimizations(ctx, scope) {
	const translated = new Map();
	const activityControllers = /* @__PURE__ */ new Map();
	const activityExpanded = /* @__PURE__ */ new Map();
	const activityFirstSeen = /* @__PURE__ */ new WeakMap();
	const activityTimings = /* @__PURE__ */ new WeakMap();
	let activeSession = null;
	let activeRow = null;
	let activeTitle = "";
	let scheduled = false;
	let activityFrame = 0;
	const optionEnabled = (key) => {
		const snapshot = scope.getSnapshot();
		const value = snapshot.value;
		return snapshot.runtimeStatus?.authorizationStatus === "authorized"
			&& value?.experienceOptimizationsEnabled === true
			&& value?.experienceOptimizations?.[key] === true;
	};
	const restoreType = (type) => {
		for (const [node, entry] of translated) {
			if (!node.isConnected) {
				translated.delete(node);
				continue;
			}
			if (entry.type === type && node.data === entry.replacement) {
				node.data = entry.original;
				translated.delete(node);
			}
		}
	};
	const translateText = (map, type) => {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const original = node.data;
			const trimmed = original.trim();
			const replacement = map.get(trimmed);
			if (replacement === void 0 || translated.has(node)) continue;
			const leading = original.slice(0, original.indexOf(trimmed));
			const trailing = original.slice(original.indexOf(trimmed) + trimmed.length);
			node.data = `${leading}${replacement}${trailing}`;
			translated.set(node, { original, replacement: node.data, type });
		}
	};
	const sessionIdFromRow = (row) => {
		const fiberKey = Object.keys(row).find((key) => key.startsWith("__reactFiber$"));
		let fiber = fiberKey === void 0 ? void 0 : row[fiberKey];
		while (fiber) {
			const id = fiber.memoizedProps?.node?.id;
			if (typeof id === "string") {
				activeTitle = fiber.memoizedProps?.node?.title ?? "";
				return id;
			}
			fiber = fiber.return;
		}
		const snapshot = ctx.sessions.list.getSnapshot();
		const text = row.textContent ?? "";
		const matches = snapshot.items.filter((item) => typeof item.title === "string" && item.title !== "" && text.includes(item.title));
		if (matches.length === 1) {
			activeTitle = matches[0].title;
			return matches[0].id;
		}
		return null;
	};
	const rememberRow = (target) => {
		const row = target instanceof Element ? target.closest('[role="treeitem"]') : null;
		if (!row) return null;
		const id = sessionIdFromRow(row);
		if (id === null) return null;
		activeSession = id;
		activeRow = row;
		return row;
	};
	const closeModal = (modal) => modal.remove();
	const showDeleteModal = (sessionId) => {
		const overlay = document.createElement("div");
		overlay.className = "mhf-modal-overlay";
		overlay.innerHTML = `<div class="mhf-delete-dialog" role="dialog" aria-modal="true" aria-label="删除会话"><h3>删除会话</h3><p>将永久删除“${(activeTitle || sessionId).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char])}”的本地记录，此操作无法撤销。</p><div class="mhf-delete-error" role="alert"></div><div class="mhf-delete-footer"><button type="button" data-action="cancel">取消</button><button type="button" class="danger" data-action="delete">永久删除</button></div></div>`;
		const cancel = overlay.querySelector('[data-action="cancel"]');
		const remove = overlay.querySelector('[data-action="delete"]');
		const error = overlay.querySelector(".mhf-delete-error");
		cancel.addEventListener("click", () => closeModal(overlay));
		overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(overlay); });
		remove.addEventListener("click", async () => {
			remove.disabled = true;
			cancel.disabled = true;
			error.textContent = "";
			try {
				const response = await fetch(MHF_SESSION_DELETE_API_PATH, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId })
				});
				const body = await response.json();
				if (!response.ok || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`);
				activeRow?.remove();
				closeModal(overlay);
			} catch (reason) {
				error.textContent = String(reason instanceof Error ? reason.message : reason);
				remove.disabled = false;
				cancel.disabled = false;
			}
		});
		document.body.append(overlay);
	};
	const enhanceMenus = () => {
		if (!optionEnabled("sessionContextMenu") || activeSession === null) return;
		for (const menu of document.querySelectorAll('[role="menu"]')) {
			if (menu.querySelector('[data-mhf-session-delete="true"]')) continue;
			const items = [...menu.querySelectorAll('[role="menuitem"], button')];
			const labels = items.map((item) => item.textContent?.trim() ?? "");
			const isSessionMenu = (labels.includes("重命名") || labels.includes("Rename"))
				&& (labels.includes("分叉会话") || labels.includes("Fork session"))
				&& (labels.includes("归档会话") || labels.includes("Archive session"));
			if (!isSessionMenu) continue;
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.setAttribute("data-mhf-session-delete", "true");
			button.className = `${items[0]?.className ?? ""} mhf-delete-menu-item`;
			button.textContent = "删除会话";
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const sessionId = activeSession;
				document.body.click();
				if (sessionId !== null) showDeleteModal(sessionId);
			});
			menu.append(button);
		}
	};
	const hasAssistantText = (row) => {
		const thinkRows = [...row.querySelectorAll('[data-variant="think"]')];
		if (thinkRows.length === 0) return row.dataset.chatFlowKind === "assistant-step";
		const bodies = new Set(thinkRows.map((think) => think.parentElement).filter(Boolean));
		for (const body of bodies) {
			for (const child of body.children) {
				if (child.matches('[data-variant="think"]')) continue;
				if ((child.textContent ?? "").trim() !== "" || child.matches("img, video, canvas") || child.querySelector("img, video, canvas")) return true;
			}
		}
		return false;
	};
	const isActivityRow = (row) => {
		if (row.querySelector("[data-tool]")) return true;
		if (row.dataset.chatFlowKind === "context" || row.querySelector("[data-context-source], [data-context-injection-body]")) return true;
		return row.querySelector('[data-variant="think"]') !== null && !hasAssistantText(row);
	};
	const activitySummary = (row) => {
		const type = row.querySelector("[data-tool]") ? "工具" : row.querySelector('[data-variant="think"]') ? "思考" : "上下文";
		const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
		return text === "" ? type : `${type} · ${text}`;
	};
	const applyActivityState = (controller) => {
		controller.element.dataset.expanded = controller.expanded ? "true" : "false";
		controller.label.textContent = controller.expanded ? `${String(controller.rows.length)} 条过程信息已展开` : `${String(controller.rows.length)} 条过程信息`;
		controller.toggle.textContent = controller.expanded ? "收起" : "展开";
		controller.toggle.setAttribute("aria-expanded", controller.expanded ? "true" : "false");
		for (const row of controller.rows) row.setAttribute("data-mhf-activity-collapsed", controller.expanded ? "false" : "true");
	};
	const formatActivityDuration = (totalSeconds) => {
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor(totalSeconds % 3600 / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) return `${String(hours)}小时${minutes > 0 ? `${String(minutes)}分` : ""}${seconds > 0 ? `${String(seconds)}秒` : ""}`;
		if (minutes > 0) return seconds === 0 ? `${String(minutes)}分钟` : `${String(minutes)}分${String(seconds)}秒`;
		return `${String(seconds)}s`;
	};
	const updateActivityTimer = (controller) => {
		const end = controller.endedAt ?? Date.now();
		const seconds = Math.max(1, Math.floor((end - controller.startedAt) / 1000));
		const text = formatActivityDuration(seconds);
		const title = `已持续 ${text}`;
		if (controller.timer.textContent !== text) controller.timer.textContent = text;
		if (controller.timer.title !== title) controller.timer.title = title;
	};
	const syncActivityTimer = (controller, running) => {
		const timing = activityTimings.get(controller.rows[0]) ?? { startedAt: Date.now(), endedAt: void 0 };
		if (running) timing.endedAt = void 0;
		else if (timing.endedAt === void 0) timing.endedAt = Date.now();
		activityTimings.set(controller.rows[0], timing);
		controller.startedAt = timing.startedAt;
		controller.endedAt = timing.endedAt;
		updateActivityTimer(controller);
		if (running && controller.timerInterval === 0) {
			controller.timerInterval = window.setInterval(() => updateActivityTimer(controller), 1000);
		} else if (!running && controller.timerInterval !== 0) {
			window.clearInterval(controller.timerInterval);
			controller.timerInterval = 0;
		}
	};
	const destroyActivityController = (controller) => {
		if (controller.timerInterval !== 0) window.clearInterval(controller.timerInterval);
		for (const row of controller.rows) row.removeAttribute("data-mhf-activity-collapsed");
		controller.element.remove();
	};
	const clearActivityGroups = () => {
		for (const controller of activityControllers.values()) destroyActivityController(controller);
		activityControllers.clear();
	};
	const updateActivitySummaries = (controller) => {
		const summary = activitySummary(controller.rows[controller.rows.length - 1]);
		const existing = controller.viewport.firstElementChild;
		if (controller.viewport.childElementCount === 1 && existing?.textContent === summary) return;
		const line = document.createElement("div");
		line.className = "mhf-activity-summary-line";
		line.textContent = summary;
		line.title = summary;
		controller.viewport.replaceChildren(line);
	};
	const createActivityController = (rows, running) => {
		const first = rows[0];
		const key = first.dataset.chatFlowKey ?? first.dataset.chatAnchorKey ?? String(Date.now());
		const element = document.createElement("div");
		element.className = "mhf-activity-fold";
		element.setAttribute("role", "group");
		element.setAttribute("aria-label", "AI 过程信息");
		const label = document.createElement("span");
		label.className = "mhf-activity-count";
		const viewport = document.createElement("div");
		viewport.className = "mhf-activity-summary-viewport";
		viewport.setAttribute("aria-label", "最新一条过程信息");
		const timer = document.createElement("span");
		timer.className = "mhf-activity-timer";
		timer.setAttribute("aria-label", "过程持续时间");
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "mhf-activity-toggle";
		const controller = { element, rows, label, viewport, timer, toggle, expanded: activityExpanded.get(key) ?? false, key, startedAt: Date.now(), endedAt: void 0, timerInterval: 0 };
		toggle.addEventListener("click", () => {
			controller.expanded = !controller.expanded;
			activityExpanded.set(controller.key, controller.expanded);
			applyActivityState(controller);
		});
		element.append(label, viewport, timer, toggle);
		first.before(element);
		updateActivitySummaries(controller);
		syncActivityTimer(controller, running);
		applyActivityState(controller);
		return controller;
	};
	const refreshActivityGroups = () => {
		activityFrame = 0;
		if (!optionEnabled("compactActivityGroups")) {
			clearActivityGroups();
			return;
		}
		const desired = /* @__PURE__ */ new Map();
		for (const flow of document.querySelectorAll("[data-chat-flow]")) {
			const rows = [...flow.children].filter((child) => child instanceof HTMLElement && child.hasAttribute("data-chat-flow-kind"));
			let group = [];
			const flush = (running) => {
				if (group.length >= 2) {
					const first = group[0];
					const timing = activityTimings.get(first) ?? { startedAt: activityFirstSeen.get(first) ?? Date.now(), endedAt: void 0 };
					if (running) timing.endedAt = void 0;
					else if (timing.endedAt === void 0) timing.endedAt = Date.now();
					activityTimings.set(first, timing);
					desired.set(first, { rows: group, running });
				}
				group = [];
			};
			for (const row of rows) {
				if (isActivityRow(row)) {
					if (!activityFirstSeen.has(row)) activityFirstSeen.set(row, Date.now());
					group.push(row);
				} else flush(false);
			}
			flush(true);
		}
		for (const [first, controller] of activityControllers) {
			const next = desired.get(first);
			const nextRows = next?.rows;
			if (nextRows !== void 0 && nextRows.length === controller.rows.length && nextRows.every((row, index) => row === controller.rows[index])) {
				updateActivitySummaries(controller);
				syncActivityTimer(controller, next.running);
				desired.delete(first);
				continue;
			}
			destroyActivityController(controller);
			activityControllers.delete(first);
		}
		for (const [first, next] of desired) activityControllers.set(first, createActivityController(next.rows, next.running));
	};
	const scheduleActivityGroups = () => {
		if (activityFrame !== 0) return;
		activityFrame = window.requestAnimationFrame(refreshActivityGroups);
	};
	const scan = () => {
		scheduled = false;
		if (optionEnabled("chinesePermissionLabels")) translateText(PERMISSION_TEXT, "permission");
		else restoreType("permission");
		if (optionEnabled("chineseCommandDescriptions")) translateText(COMMAND_TEXT, "command");
		else restoreType("command");
		enhanceMenus();
		scheduleActivityGroups();
	};
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(scan);
	};
	const onClickCapture = (event) => {
		const button = event.target instanceof Element ? event.target.closest("button") : null;
		if (button) rememberRow(button);
		if (optionEnabled("foregroundDirectoryPicker") && button) {
			const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`;
			if (/选择工作区|添加工作区|Select workspace|Add workspace/i.test(label)) {
				void fetch(MHF_PICKER_FOREGROUND_API_PATH, { method: "POST" });
			}
		}
	};
	const onContextMenu = (event) => {
		if (!optionEnabled("sessionContextMenu")) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
		const row = rememberRow(target);
		if (!row) return;
		event.preventDefault();
		event.stopPropagation();
		const buttons = [...row.querySelectorAll("button")];
		const menuButton = buttons.find((button) => /会话|session/i.test(button.getAttribute("aria-label") ?? "")) ?? buttons[buttons.length - 1];
		menuButton?.click();
	};
	const observer = new MutationObserver(schedule);
	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
	document.addEventListener("click", onClickCapture, true);
	document.addEventListener("contextmenu", onContextMenu, true);
	const unsubscribe = scope.subscribe(schedule);
	schedule();
	return () => {
		observer.disconnect();
		document.removeEventListener("click", onClickCapture, true);
		document.removeEventListener("contextmenu", onContextMenu, true);
		unsubscribe();
		if (activityFrame !== 0) window.cancelAnimationFrame(activityFrame);
		clearActivityGroups();
		restoreType("permission");
		restoreType("command");
		document.querySelectorAll(".mhf-modal-overlay").forEach((element) => element.remove());
	};
}

function installStyles() {
	const existing = document.getElementById(MHF_STYLE_ID);
	if (existing) return () => {};
	const style = document.createElement("style");
	style.id = MHF_STYLE_ID;
	style.textContent = `
.mhf-settings{display:grid;gap:18px;max-width:780px;padding-bottom:8px}.mhf-settings *{box-sizing:border-box;letter-spacing:0}.mhf-settings-header{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:12px;padding-bottom:16px;border-bottom:1px solid rgba(127,127,127,.2)}.mhf-settings-header h2,.mhf-section-heading h3,.mhf-control-row h3{margin:0;font-size:18px}.mhf-settings-header p,.mhf-section-heading p,.mhf-control-row p,.mhf-package-copy p,.mhf-optimization-row p{margin:4px 0 0;color:var(--ds-text-secondary,#6b7280);font-size:13px;line-height:1.45}.mhf-brand-mark{display:block;width:42px;height:42px;padding:2px;border:1px solid rgba(127,127,127,.2);border-radius:6px;background:#fff;object-fit:contain}.mhf-sidebar-logo{position:relative;display:grid;place-items:center;flex:none;width:26px;height:26px;border:1px solid rgba(127,127,127,.18);border-radius:5px;background:#fff}.mhf-sidebar-logo-image{display:block;width:100%;height:100%;border-radius:4px;object-fit:contain}.mhf-local-badge,.mhf-active-tag,.mhf-version{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;font-size:12px;white-space:nowrap}.mhf-local-badge{background:rgba(16,185,129,.12);color:#047857}.mhf-control-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid rgba(127,127,127,.16)}.mhf-control-row>div{min-width:0}.mhf-control-row-plain{padding-top:0}.mhf-switch{position:relative;flex:none;width:42px;height:24px;border:0;border-radius:999px;padding:2px;background:#9ca3af;cursor:pointer;transition:background .16s ease,box-shadow .16s ease}.mhf-switch:hover:not(:disabled){box-shadow:0 0 0 3px rgba(16,185,129,.15)}.mhf-switch[aria-checked=true]{background:#059669}.mhf-switch:disabled{cursor:not-allowed;opacity:.5}.mhf-switch-thumb{display:block;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);transform:translateX(0);transition:transform .16s ease}.mhf-switch[aria-checked=true] .mhf-switch-thumb{transform:translateX(18px)}.mhf-switch-compact{width:36px;height:20px}.mhf-switch-compact .mhf-switch-thumb{width:16px;height:16px}.mhf-switch-compact[aria-checked=true] .mhf-switch-thumb{transform:translateX(16px)}.mhf-section-block{display:grid;gap:12px}.mhf-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.mhf-import-button{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 13px;border:1px solid rgba(5,150,105,.45);border-radius:6px;color:#047857;font-size:13px;font-weight:600;cursor:pointer;background:rgba(16,185,129,.06);transition:background .15s ease,border-color .15s ease}.mhf-import-button:hover:not(:disabled){background:rgba(16,185,129,.12);border-color:#059669}.mhf-import-button:disabled{opacity:.5;cursor:not-allowed}.mhf-import-button input{display:none}.mhf-empty{display:grid;place-items:center;min-height:88px;border:1px dashed rgba(127,127,127,.32);border-radius:6px;color:var(--ds-text-secondary,#6b7280);font-size:13px}.mhf-package-list{display:grid;gap:8px}.mhf-package-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;min-height:76px;padding:12px 14px;border:1px solid rgba(127,127,127,.22);border-radius:6px;background:rgba(127,127,127,.025);transition:border-color .15s ease,background .15s ease}.mhf-package-row:hover{border-color:rgba(5,150,105,.42);background:rgba(16,185,129,.04)}.mhf-package-row.is-active{border-color:rgba(5,150,105,.55);background:rgba(16,185,129,.07)}.mhf-package-title{display:flex;align-items:center;gap:8px;min-width:0}.mhf-package-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mhf-version{background:rgba(127,127,127,.12);color:inherit}.mhf-active-tag{background:rgba(16,185,129,.14);color:#047857}.mhf-package-actions{display:flex;gap:7px}.mhf-button{min-height:32px;padding:0 11px;border-radius:6px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font-size:13px;cursor:pointer}.mhf-button:hover:not(:disabled){background:rgba(127,127,127,.08)}.mhf-button:disabled{opacity:.46;cursor:not-allowed}.mhf-button-primary:not(:disabled){border-color:rgba(5,150,105,.42);color:#047857}.mhf-button-danger:not(:disabled){border-color:rgba(220,38,38,.3);color:#dc2626}.mhf-optimization-block{padding-top:4px}.mhf-optimization-list{display:grid;border-top:1px solid rgba(127,127,127,.16)}.mhf-optimization-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid rgba(127,127,127,.12)}.mhf-optimization-row strong{font-size:13px}.mhf-status-line{font-size:12px;color:#047857}.mhf-status-line.is-error{color:#dc2626}.mhf-sidebar-status{position:relative;display:flex;align-items:center;gap:5px;width:100%;min-height:42px;padding:4px;border:1px solid rgba(127,127,127,.16);border-radius:6px;background:rgba(127,127,127,.03);transition:background .15s ease,border-color .15s ease}.mhf-sidebar-status:hover{background:rgba(16,185,129,.07);border-color:rgba(5,150,105,.35)}.mhf-sidebar-main{display:flex;align-items:center;gap:9px;min-width:0;flex:1;height:34px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0 5px;border-radius:4px}.mhf-sidebar-main:hover{background:rgba(127,127,127,.07)}.mhf-sidebar-toggle{display:flex;align-items:center;justify-content:center;flex:none;padding:2px}.mhf-sidebar-status[data-enabled=true] .mhf-sidebar-logo:after{content:"";position:absolute;right:-2px;bottom:-2px;width:8px;height:8px;border-radius:50%;background:#10b981;border:2px solid var(--ds-bg-primary,#fff)}.mhf-sidebar-copy{display:grid;min-width:0}.mhf-sidebar-copy strong,.mhf-sidebar-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mhf-sidebar-copy strong{font-size:12px}.mhf-sidebar-copy small{font-size:10px;color:var(--ds-text-secondary,#6b7280);margin-top:1px}.mhf-sidebar-status[data-wide=false]{width:42px;padding:3px}.mhf-sidebar-status[data-wide=false] .mhf-sidebar-main{padding:0;justify-content:center}.mhf-sidebar-status[data-wide=false] .mhf-sidebar-toggle{position:absolute;right:-2px;bottom:-3px;padding:0}.mhf-sidebar-status[data-wide=false] .mhf-switch{transform:scale(.7);transform-origin:right bottom}.mhf-delete-menu-item{display:flex!important;width:100%;align-items:center;color:#dc2626!important;text-align:left}.mhf-modal-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(0,0,0,.46);padding:20px}.mhf-delete-dialog{width:min(430px,100%);border-radius:7px;background:var(--ds-bg-primary,#fff);color:var(--ds-text-primary,#111827);box-shadow:0 18px 55px rgba(0,0,0,.3);padding:20px}.mhf-delete-dialog h3{margin:0 0 10px;font-size:18px}.mhf-delete-dialog p{margin:0;color:var(--ds-text-secondary,#6b7280);line-height:1.55;font-size:13px}.mhf-delete-error{min-height:20px;margin-top:10px;color:#dc2626;font-size:12px}.mhf-delete-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.mhf-delete-footer button{min-width:82px;min-height:34px;border:1px solid rgba(127,127,127,.3);border-radius:6px;background:transparent;color:inherit;cursor:pointer}.mhf-delete-footer button.danger{border-color:#dc2626;background:#dc2626;color:#fff}.mhf-delete-footer button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:680px){.mhf-settings-header{grid-template-columns:42px minmax(0,1fr)}.mhf-local-badge{display:none}.mhf-package-row{grid-template-columns:1fr}.mhf-package-actions{justify-content:flex-end}.mhf-section-heading{align-items:flex-start;flex-direction:column}.mhf-import-button{align-self:stretch}}
.mhf-activity-fold{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;min-height:38px;padding:3px 6px 3px 10px;border:1px solid rgba(127,127,127,.18);border-radius:6px;background:rgba(127,127,127,.035);color:var(--ds-text-secondary,#6b7280)}.mhf-activity-count{font-size:12px;white-space:nowrap;color:var(--ds-text-secondary,#6b7280)}.mhf-activity-summary-viewport{height:30px;min-width:0;overflow-x:hidden;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;border-radius:4px;outline:none}.mhf-activity-summary-viewport:focus-visible{box-shadow:0 0 0 2px rgba(5,150,105,.22)}.mhf-activity-summary-viewport::-webkit-scrollbar{width:4px}.mhf-activity-summary-viewport::-webkit-scrollbar-thumb{border-radius:4px;background:rgba(127,127,127,.34)}.mhf-activity-summary-line{height:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;scroll-snap-align:start;font-size:13px;line-height:30px}.mhf-activity-timer{min-width:34px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ds-text-secondary,#6b7280)}.mhf-activity-toggle{min-width:48px;height:30px;padding:0 9px;border:1px solid rgba(127,127,127,.24);border-radius:5px;background:transparent;color:inherit;font-size:12px;cursor:pointer}.mhf-activity-toggle:hover{border-color:rgba(5,150,105,.42);background:rgba(16,185,129,.08);color:#047857}.mhf-activity-fold[data-expanded=true] .mhf-activity-summary-viewport{visibility:hidden}.mhf-activity-fold+ [data-chat-flow-kind]{margin-top:0}[data-chat-flow-kind][data-mhf-activity-collapsed=true]{display:none!important}@media(max-width:680px){.mhf-activity-fold{grid-template-columns:minmax(0,1fr) auto auto}.mhf-activity-count{display:none}}
.mhf-activity-summary-viewport{overflow:hidden;scroll-snap-type:none;overscroll-behavior:auto;outline:none}.mhf-activity-summary-viewport:focus-visible{box-shadow:none}.mhf-activity-summary-viewport::-webkit-scrollbar{display:none}.mhf-activity-summary-line{scroll-snap-align:none}
.mhf-compatibility-block{display:grid;border-top:1px solid rgba(127,127,127,.16);border-bottom:1px solid rgba(127,127,127,.16)}.mhf-compatibility-row{border-bottom:1px solid rgba(127,127,127,.12);padding:13px 0}.mhf-global-compatibility-row{padding:11px 0 11px 18px;border-bottom:0}.mhf-global-compatibility-row strong{font-size:13px}
.mhf-authorization-only{width:min(460px,100%);min-height:420px;align-content:center;justify-items:center;margin:0 auto;text-align:center}.mhf-auth-mark{display:block;width:52px;height:52px;padding:2px;border:1px solid rgba(127,127,127,.2);border-radius:7px;background:#fff;object-fit:contain;box-shadow:0 10px 26px rgba(17,24,39,.14)}.mhf-auth-copy{max-width:420px}.mhf-auth-copy h2{margin:0;font-size:20px}.mhf-auth-copy p{margin:7px 0 0;color:var(--ds-text-secondary,#6b7280);font-size:13px;line-height:1.6}.mhf-login-form{display:grid;gap:12px;width:min(390px,100%);margin-top:6px;text-align:left}.mhf-login-form label{display:grid;gap:6px}.mhf-login-form label>span{font-size:12px;font-weight:650;color:var(--ds-text-secondary,#6b7280)}.mhf-login-form input{width:100%;height:38px;padding:0 11px;border:1px solid rgba(127,127,127,.3);border-radius:6px;background:#fff;color:#111827!important;caret-color:#111827;outline:none}.mhf-login-form input::placeholder{color:#9ca3af;opacity:1}.mhf-login-form input:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(16,185,129,.12)}.mhf-auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:2px}.mhf-auth-actions .mhf-button{height:38px}.mhf-auth-actions .mhf-button-primary:not(:disabled){background:#059669;border-color:#059669;color:#fff}@media(max-width:520px){.mhf-auth-actions{grid-template-columns:1fr}.mhf-authorization-only{min-height:360px}}
.mhf-protection-row code,.mhf-protection-marker{font-family:Consolas,"Courier New",monospace;letter-spacing:0}.mhf-protection-state{flex:none;padding:4px 9px;border-radius:999px;background:rgba(16,185,129,.12);color:#047857;font-size:12px;font-weight:650}.mhf-protection-triggered .mhf-auth-mark{border-color:rgba(220,38,38,.35);box-shadow:0 10px 26px rgba(220,38,38,.14)}.mhf-protection-triggered .mhf-auth-copy h2{color:#dc2626}.mhf-protection-marker{display:inline-block;margin-top:16px;padding:6px 10px;border:1px solid rgba(220,38,38,.28);border-radius:5px;background:rgba(220,38,38,.06);color:#b91c1c}
`;
	style.textContent += `.mhf-button-content{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:78px}.mhf-check-button{min-width:104px}.mhf-button-spinner{display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:mhf-update-spin .7s linear infinite}@keyframes mhf-update-spin{to{transform:rotate(360deg)}}`;
	document.head.append(style);
	return () => style.remove();
}

const zh = {
	nav: "MH Frame",
	title: "MH Frame",
	description: "在线授权的 Harness 增强插件。自动读取当前设备授权和最新系统提示词，始终保留 Harness 原生工具。",
	onlinePlugin: "在线版",
	enabled: "已开启",
	disabled: "已关闭",
	coreSwitch: "破甲开关",
	coreEnabledDesc: "正在使用服务器下发的在线提示词，并替换 Harness 原生系统提示词；命令与文件工具由 Harness 原生提供。",
	coreDisabledDesc: "当前使用 Harness 原生提示词；原生工具保持不变。",
	protectionTitle: "MH 安全保护",
	protectionDescription: "仅检测用户消息与 AI 返回内容，系统提示词不参与检测。",
	protectionEnabled: "已启用",
	protectionTriggeredTitle: "触发 MH 安全保护",
	protectionTriggeredDescription: "已强制中断当前 AI 连接，请重启 Harness 后再使用。",
	onlinePrompts: "在线提示词",
	onlinePromptsDescription: "提示词由服务器按当前设备授权下发。每次只能启用一个提示词模式。",
	checkAllUpdates: "检查并更新",
	onlineEmpty: "服务器尚未发布可用的提示词模式。",
	modeCheckUpdate: "检查更新",
	modeUnpublished: "未发布",
	packageActive: "已启用",
	packageInUse: "当前使用",
	packageEnable: "启用",
	packageNoDescription: "暂无简介",
	windowsCompatibility: "Windows 兼容模式",
	windowsCompatibilityDescription: "默认开启。仅在识别到极简模式时修复 Windows Bash；Windows 10 会使用无 ACL 隔离的兼容路径。",
	windowsGlobalCompatibility: "全局兼容",
	windowsGlobalCompatibilityDescription: "默认关闭。开启后，所有模式都会使用 Windows 终端兼容处理。",
	optimization: "体验优化",
	optimizationDescription: "关闭总开关后，Harness 的界面与交互保持原生状态。",
	optimizationPicker: "目录选择器置顶",
	optimizationPickerDesc: "打开工作区目录时，将系统选择器带到 Harness 窗口前方。",
	optimizationPermission: "权限名称汉化",
	optimizationPermissionDesc: "将只读、仅工作区和完全访问统一显示为中文。",
	optimizationCommands: "命令说明汉化",
	optimizationCommandsDesc: "将内置命令的功能说明显示为中文。",
	optimizationSessions: "会话菜单增强",
	optimizationSessionsDesc: "禁用网页右键菜单，并为会话右键菜单增加永久删除。",
	optimizationActivity: "过程信息折叠",
	optimizationActivityDesc: "将连续的思考、工具调用和上下文归入单行最新摘要，可随时完整展开或收起。",
	ready: "设备授权正常，在线提示词已同步。",
	checkingAuthorization: "正在检查当前设备授权并同步提示词...",
	checkingAuthorizationTitle: "正在验证授权",
	unauthorized: "当前设备未获得授权",
	onlineError: "在线授权或提示词更新失败。",
	account: "账号",
	accountPlaceholder: "用户名或邮箱",
	password: "密码",
	passwordPlaceholder: "请输入密码",
	login: "登录并验证",
	loggingIn: "正在登录...",
	recheck: "重新检查",
	unavailable: "MH Frame 设置暂不可用。",
	openSettings: "打开 MH Frame 设置",
	noActivePackage: "未选择提示词模式"
};
zh.checkingUpdates = "检查中...";
const en = { ...zh };
const NS = "settings.mhf";
const inject = ["slots", "locale", "sessions"];

function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "mhf: dictionaries");
	ctx.effect(() => installStyles(), "mhf: styles");
	const t = ctx.locale.bind(NS);
	const scope = new MhfSettingsScope();
	ctx.effect(() => {
		void scope.refresh();
		const timer = window.setInterval(() => void scope.refresh(), 5_000);
		return () => {
			window.clearInterval(timer);
		};
	}, "mhf: online authorization status");
	ctx.effect(() => installExperienceOptimizations(ctx, scope), "mhf: experience optimizations");
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "mhf",
		order: 30,
		label: () => t("nav"),
		locale: NS,
		inject: () => ({ scope })
	}, MhfSettingsSection));
	ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
		name: "sidebar.footer.action",
		id: "mhf",
		order: 0,
		locale: NS,
		inject: () => ({ scope })
	}, MhfSidebarAction));
}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
