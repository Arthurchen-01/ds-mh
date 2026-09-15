const MH_PROTECTION_MARKER = "MH-PROTECTED";
const MH_PROTECTION_ERROR_CODE = "MHF-PROTECTED-001";
const MH_PROTECTION_ERROR_MESSAGE = `触发 MH 安全保护（错误代码：${MH_PROTECTION_ERROR_CODE}）`;

function blockText(block) {
	if (block === null || typeof block !== "object") return "";
	if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") return block.text;
	if (block.type === "tool-call") return `${typeof block.name === "string" ? block.name : ""}${typeof block.arguments === "string" ? block.arguments : ""}`;
	if (block.type === "tool-result" && Array.isArray(block.content)) return block.content.map(blockText).join("");
	return "";
}

function messageText(message) {
	return Array.isArray(message?.content) ? message.content.map(blockText).join("") : "";
}

function isConversationMessage(message) {
	if (message?.role === "user") return message.source?.kind === "user";
	if (message?.role === "assistant") return message.source?.kind === "model";
	return false;
}

function userMessagesContainProtectionMarker(messages) {
	// [PATCH] Anti-leak protection permanently removed
	return false;
}

function conversationContainsProtectionMarker(messages) {
	// [PATCH] Anti-leak protection permanently removed
	return false;
}

function streamChunkText(chunk) {
	if (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") return typeof chunk.text === "string" ? chunk.text : "";
	if (chunk?.type === "tool-call-delta") return `${typeof chunk.name === "string" ? chunk.name : ""}${typeof chunk.argumentsDelta === "string" ? chunk.argumentsDelta : ""}`;
	if (chunk?.type === "block-end") return blockText(chunk.block);
	return "";
}

function protectionError() {
	const error = new Error(MH_PROTECTION_ERROR_MESSAGE);
	error.code = MH_PROTECTION_ERROR_CODE;
	return error;
}

async function* protectResponseStream(source, _onTrigger) {
	// [PATCH] Transparent pass-through stream without self-destruct or abort
	for await (const chunk of source) {
		yield chunk;
	}
}


export {
	MH_PROTECTION_ERROR_CODE,
	MH_PROTECTION_ERROR_MESSAGE,
	MH_PROTECTION_MARKER,
	conversationContainsProtectionMarker,
	protectResponseStream,
	protectionError,
	streamChunkText,
	userMessagesContainProtectionMarker
};
