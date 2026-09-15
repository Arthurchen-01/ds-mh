import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { release } from "node:os";

function useWindows10Fallback() {
	if (process.platform !== "win32") return false;
	const build = Number(release().split(".").at(-1));
	return Number.isFinite(build) && build < 22000;
}

function windowsBashCandidates() {
	const candidates = [];
	const add = (candidate) => {
		if (typeof candidate !== "string" || candidate.trim() === "") return;
		const absolute = resolve(candidate.trim());
		if (!candidates.includes(absolute)) candidates.push(absolute);
	};
	add(process.env.MHF_BASH_PATH);
	for (const directory of (process.env.PATH ?? "").split(delimiter)) add(join(directory, "bash.exe"));
	for (const root of [
		process.env.ProgramFiles,
		process.env["ProgramFiles(x86)"],
		process.env.LOCALAPPDATA === void 0 ? void 0 : join(process.env.LOCALAPPDATA, "Programs")
	]) {
		if (root === void 0) continue;
		add(join(root, "Git", "bin", "bash.exe"));
		add(join(root, "Git", "usr", "bin", "bash.exe"));
	}
	const whereGit = spawnSync("where.exe", ["git.exe"], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "ignore"]
	});
	if (whereGit.status === 0) {
		for (const git of whereGit.stdout.split(/\r?\n/).filter(Boolean)) {
			const root = resolve(dirname(git.trim()), "..");
			add(join(root, "bin", "bash.exe"));
			add(join(root, "usr", "bin", "bash.exe"));
		}
	}
	return candidates;
}

function resolveWindowsBash() {
	return windowsBashCandidates().find((candidate) => existsSync(candidate));
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function createWindowsTerminalInspector() {
	const identity = (pid) => ({ pid, started: `win32:${String(pid)}` });
	return {
		foregroundPgid: (pid) => processAlive(pid) ? pid : void 0,
		isStdinWaiting: () => false,
		processTree: (pid) => processAlive(pid) ? [identity(pid)] : [],
		processSession: () => [],
		isAlive: (value) => value.started === `win32:${String(value.pid)}` && processAlive(value.pid),
		signalGroup: (pid, signal) => process.kill(pid, signal),
		signalProcess: (value, signal) => {
			if (value.started === `win32:${String(value.pid)}` && processAlive(value.pid)) process.kill(value.pid, signal);
		}
	};
}

function installWindowsTerminalCompatibility(host, settings, isMinimalMode) {
	if (process.platform !== "win32" || typeof host.subprocess?.spawnTerminal !== "function") return () => {};
	const subprocess = host.subprocess;
	const originalSpawnTerminal = subprocess.spawnTerminal;
	const originalInspector = subprocess.terminalInspector;
	const inspector = createWindowsTerminalInspector();
	let bashPath;
	const windows10Fallback = useWindows10Fallback();
	const compatibleSpawnTerminal = async (spec) => {
		const current = settings();
		if (!current.windowsCompatibilityEnabled) return originalSpawnTerminal.call(subprocess, spec);
		if (!current.windowsGlobalCompatibilityEnabled && !isMinimalMode(spec)) {
			return originalSpawnTerminal.call(subprocess, spec);
		}
		const argv = [...spec.argv];
		const bashIndex = argv.findIndex((argument) => argument === "/bin/bash" || argument === "bash");
		if (bashIndex >= 0) {
			if (windows10Fallback) {
				bashPath ??= resolveWindowsBash();
				if (bashPath === void 0) throw new Error("Git for Windows bash.exe was not found");
				argv.splice(0, argv.length, bashPath, ...argv.slice(bashIndex + 1));
			} else {
				bashPath ??= resolveWindowsBash();
				if (bashPath === void 0) throw new Error("Git for Windows bash.exe was not found");
			if (bashPath === void 0) throw new Error("Windows 兼容模式未找到 Git for Windows 的 bash.exe");
				argv[bashIndex] = bashPath;
			}
		}
		const previousInspector = subprocess.terminalInspector;
		subprocess.terminalInspector = inspector;
		try {
			return await originalSpawnTerminal.call(subprocess, { ...spec, argv });
		} finally {
			subprocess.terminalInspector = previousInspector;
		}
	};
	subprocess.spawnTerminal = compatibleSpawnTerminal;
	return () => {
		if (subprocess.spawnTerminal === compatibleSpawnTerminal) subprocess.spawnTerminal = originalSpawnTerminal;
		subprocess.terminalInspector = originalInspector;
	};
}

export { createWindowsTerminalInspector, installWindowsTerminalCompatibility, resolveWindowsBash, windowsBashCandidates };
