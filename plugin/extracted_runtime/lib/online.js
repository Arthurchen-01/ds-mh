import { spawnSync } from "node:child_process";
import { createDecipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync } from "node:crypto";
import { MH_PROTECTION_MARKER } from "./protection.js";

const MHF_ONLINE_API_BASE = "https://8.137.193.226";
const MHF_HARNESS_PROMPTS_PATH = "/api/mhf/harness/prompts";
const MHF_LOGIN_PATH = "/api/auth/login";
const MHF_DEVICE_BIND_PATH = "/api/device/bind";
const MHF_DEVICE_DOMAIN = Buffer.from("mh-control/windows-machine-guid/v1\0", "utf8");
const MHF_MAC_DEVICE_DOMAIN = Buffer.from("mh-control/macos-platform-uuid/v1\0", "utf8");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function deriveWindowsDeviceId(machineGuid) {
	const normalized = String(machineGuid).trim().toLowerCase();
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) throw new Error("当前设备信息格式无效");
	return `mhw-${createHash("sha256").update(MHF_DEVICE_DOMAIN).update(normalized, "utf8").digest("hex")}`;
}

function validDeviceId(value) {
	if (/^mhw-[0-9a-f]{64}$/.test(value)) return true;
	if (/^mhm-[0-9a-f]{64}$/.test(value)) return true;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function deriveMacDeviceId(platformUuid) {
	const normalized = String(platformUuid).trim().toLowerCase();
	if (!/^[0-9a-f-]{16,128}$/.test(normalized)) throw new Error("当前 macOS 设备信息格式无效");
	return `mhm-${createHash("sha256").update(MHF_MAC_DEVICE_DOMAIN).update(normalized, "utf8").digest("hex")}`;
}

function readStoredMacDeviceId() {
	const result = spawnSync("security", ["find-generic-password", "-s", "installation-id.com.mhframe.control.device", "-w"], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 5_000
	});
	const value = String(result.stdout ?? "").trim().toLowerCase();
	return result.status === 0 && validDeviceId(value) ? value : void 0;
}

function readMacDeviceId() {
	const stored = readStoredMacDeviceId();
	if (stored) return stored;
	const result = spawnSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 5_000
	});
	if (result.status !== 0) throw new Error("无法读取 macOS 设备信息");
	const match = String(result.stdout).match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{16,128})"/);
	if (!match) throw new Error("无法读取 macOS 设备标识");
	return deriveMacDeviceId(match[1]);
}

function readStoredWindowsDeviceId() {
	const script = String.raw`
using namespace System.Runtime.InteropServices
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MhfCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public Int64 LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reserved, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr credential);
}
'@
$pointer = [IntPtr]::Zero
if ([MhfCredentialReader]::CredRead('installation-id.com.mhframe.control.device', 1, 0, [ref]$pointer)) {
  try {
    $credential = [Marshal]::PtrToStructure($pointer, [type][MhfCredentialReader+Credential])
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    [Convert]::ToBase64String($bytes)
  } finally { [MhfCredentialReader]::CredFree($pointer) }
}`;
	const encoded = Buffer.from(script, "utf16le").toString("base64");
	const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 5_000
	});
	if (result.status !== 0 || !String(result.stdout).trim()) return void 0;
	const bytes = Buffer.from(String(result.stdout).trim(), "base64");
	for (const encoding of ["utf16le", "utf8"]) {
		const value = bytes.toString(encoding).replace(/\0+$/g, "").trim();
		if (validDeviceId(value)) return value;
	}
	return void 0;
}

function readWindowsDeviceId() {
	if (process.platform !== "win32") throw new Error("当前平台不是 Windows");
	const stored = readStoredWindowsDeviceId();
	if (stored) return stored;
	const result = spawnSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"]
	});
	if (result.status !== 0) throw new Error("无法读取当前设备信息");
	const match = String(result.stdout).match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/i);
	if (!match) throw new Error("当前设备信息格式无效");
	return deriveWindowsDeviceId(match[1]);
}

function readDeviceId() {
	if (process.platform === "win32") return readWindowsDeviceId();
	if (process.platform === "darwin") return readMacDeviceId();
	throw new Error("在线版 MH Frame 当前仅支持 Windows 和 macOS");
}

function int64Buffer(value) {
	const buffer = Buffer.alloc(8);
	buffer.writeBigInt64BE(BigInt(value));
	return buffer;
}

async function onlineJsonRequest(path, options = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	let response;
	try {
		response = await fetch(`${MHF_ONLINE_API_BASE}${path}`, {
			method: options.method ?? "POST",
			headers: { ...options.headers, "X-MH-Protection": MH_PROTECTION_MARKER },
			body: options.body,
			cache: "no-store",
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeout);
	}
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`服务器响应格式无效（HTTP ${response.status}）`);
	}
	if (!response.ok) {
		const failure = new Error(body?.error?.message || `服务器请求失败（HTTP ${response.status}）`);
		failure.code = body?.error?.code;
		failure.authorizationDenied = response.status === 401 || response.status === 403;
		throw failure;
	}
	return body;
}

async function loginOnlineAccount(identifier, password) {
	const normalizedIdentifier = String(identifier ?? "").trim();
	if (normalizedIdentifier === "" || typeof password !== "string" || password === "") {
		const failure = new Error("请输入账号和密码");
		failure.authorizationDenied = true;
		throw failure;
	}
	if (normalizedIdentifier.length > 254 || password.length > 1024) {
		const failure = new Error("账号或密码格式无效");
		failure.authorizationDenied = true;
		throw failure;
	}
	const deviceId = readDeviceId();
	const login = await onlineJsonRequest(MHF_LOGIN_PATH, {
			headers: { "Content-Type": "application/json", "X-Device-Id": deviceId },
		body: JSON.stringify({ identifier: normalizedIdentifier, password })
	});
	if (typeof login?.token !== "string" || login.token === "") throw new Error("登录响应格式无效");
	await onlineJsonRequest(MHF_DEVICE_BIND_PATH, {
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${login.token}`,
			"X-Device-Id": deviceId
		},
		body: "{}"
	});
}

function decryptOnlinePrompt(item, response, privateKey) {
	if (typeof item.encrypted_prompt !== "string" || typeof item.version !== "string") return "";
	const serverRaw = Buffer.from(response.server_public_key, "base64url");
	if (serverRaw.length !== 32) throw new Error("服务器提示词密钥格式无效");
	const serverKey = createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, serverRaw]), format: "der", type: "spki" });
	const shared = diffieHellman({ privateKey, publicKey: serverKey });
	const key = createHash("sha256")
		.update(Buffer.from("mh-control/mhf-frame5-prompt/v1\0", "utf8"))
		.update(shared)
		.update(int64Buffer(response.product_id))
		.update(item.version, "utf8")
		.update(int64Buffer(response.expires_at))
		.digest();
	const packet = Buffer.from(item.encrypted_prompt, "base64");
	if (packet.length < 32 || !packet.subarray(0, 4).equals(Buffer.from("MFP5"))) throw new Error("服务器提示词响应格式无效");
	const decipher = createDecipheriv("aes-256-gcm", key, packet.subarray(4, 16));
	decipher.setAAD(Buffer.from(`mhf-frame5-prompt-v1:${response.product_id}:${item.version}:${response.expires_at}`, "utf8"));
	decipher.setAuthTag(packet.subarray(-16));
	return Buffer.concat([decipher.update(packet.subarray(16, -16)), decipher.final()]).toString("utf8");
}

async function fetchOnlinePrompts(mode) {
	const { privateKey, publicKey } = generateKeyPairSync("x25519");
	const publicDer = publicKey.export({ format: "der", type: "spki" });
	const clientPublicKey = Buffer.from(publicDer).subarray(-32).toString("base64url");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	let response;
	try {
		response = await fetch(`${MHF_ONLINE_API_BASE}${MHF_HARNESS_PROMPTS_PATH}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Device-Id": readDeviceId(), "X-MH-Protection": MH_PROTECTION_MARKER },
			body: JSON.stringify({ client_public_key: clientPublicKey, ...(mode ? { mode } : {}) }),
			cache: "no-store",
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeout);
	}
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`服务器响应格式无效（HTTP ${response.status}）`);
	}
	if (!response.ok) {
		const failure = new Error(body?.error?.message || `服务器请求失败（HTTP ${response.status}）`);
		failure.code = body?.error?.code;
		failure.authorizationDenied = response.status === 403 && failure.code === "MHF_HARNESS_NOT_AUTHORIZED";
		throw failure;
	}
	if (body?.authorized !== true || body?.product !== "mhf-harness" || !Array.isArray(body?.modes)) throw new Error("服务器提示词响应无效");
	return {
		developer: body?.developer === true,
		modes: body.modes.map((item) => ({
			slug: String(item.slug ?? ""),
			name: String(item.name ?? ""),
			description: String(item.description ?? ""),
			version: typeof item.version === "string" ? item.version : "",
			updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
			systemPrompt: decryptOnlinePrompt(item, body, privateKey)
		}))
	};
}

export { decryptOnlinePrompt, deriveMacDeviceId, deriveWindowsDeviceId, fetchOnlinePrompts, int64Buffer, loginOnlineAccount, readDeviceId, readMacDeviceId, readWindowsDeviceId };
