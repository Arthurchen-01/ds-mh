// Harness's llm/stream waterfall is observational: next() cannot replace its
// frozen request. Decorate adapter dispatch instead, after prepared-call checks.
// Adapter registry access is a compatibility seam checked against supported
// Harness versions; never mutate a request, session surface, or settings here.
export function installProviderRequestTransform(ctx, transform) {
	const llm = ctx.llm;
	if (!(llm.adapters instanceof Map)) {
		throw new Error("MHF: 当前 Harness 的模型适配器接口不兼容，请更新插件。");
	}
	const decorated = new Map();
	let active = true;
	const scan = () => {
		for (const { adapter } of llm.adapters.values()) {
			if (decorated.has(adapter)) continue;
			const key = typeof adapter.prepareCall === "function" ? "prepareCall" : "stream";
			const original = adapter[key];
			const descriptor = Object.getOwnPropertyDescriptor(adapter, key);
			const wrapped = key === "prepareCall"
				? async function (...args) {
					const call = await original.apply(this, args);
					return {
						...call,
						stream(options) {
							return call.stream(active ? transform(options) : options);
						}
					};
				}
				: function (options) {
					return original.call(this, active ? transform(options) : options);
				};
			Object.defineProperty(adapter, key, { configurable: true, writable: true, value: wrapped });
			decorated.set(adapter, { key, descriptor, wrapped });
		}
	};
	const disposeListener = ctx.on("llm/adapters-updated", scan);
	const dispose = () => {
		active = false;
		disposeListener();
		for (const [adapter, { key, descriptor, wrapped }] of decorated) {
			if (adapter[key] !== wrapped) continue;
			if (descriptor) Object.defineProperty(adapter, key, descriptor);
			else delete adapter[key];
		}
		decorated.clear();
	};
	try {
		scan();
	} catch (error) {
		dispose();
		throw error;
	}
	return dispose;
}

/** Read the same projection and rounding used by Harness's context meter. */
export function contextOccupancy(ctx, options) {
	if (!options.sessionId || options.purpose) return undefined;
	const session = ctx.get("sessions")?.get(options.sessionId);
	if (!session) return undefined;
	const pressure = ctx.get("sessionProjections")?.snapshot(session, ["contextPressure"]).values.contextPressure;
	const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
	if (!Number.isFinite(used) || !Number.isFinite(pressure?.contextWindow) || pressure.contextWindow <= 0) return undefined;
	return Math.min(100, Math.round(used / pressure.contextWindow * 100));
}
