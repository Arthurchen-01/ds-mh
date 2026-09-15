import z from "@deepseek-ai/schemastery";

const MHF_SETTINGS_NAMESPACE = "mhf";
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
	promptPackageKey: z.string().default(""),
	promptPackageData: z.string().default(""),
	proxyBaseUrl: z.string().default(""),
	modelMappings: z.array(z.object({
		source: z.string(),
		target: z.string(),
		enabled: z.boolean().default(true)
	})).default([])
});

export { MHF_SETTINGS_NAMESPACE, MhfSettingsSchema };
