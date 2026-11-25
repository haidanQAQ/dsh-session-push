window.__ModuleLoader__.load({
	id: "dsh-session-push",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.tsx
		/**
		 * dsh-session-push 浏览器侧：在「设置 → 插件」里注册一个「会话推送」标签页。
		 * 读写宿主的 Config（命名空间 = 宿主 entry id `session-push`），
		 * 通过 ctx.configForms.get(NS) 拿到表单控制器（getSnapshot / subscribe / set / unset）。
		 */
		const inject = ["slots", "configForms", "locale"];
		const name = "dsh-session-push";
		const NS = "session-push";
		const TAB_ORDER = 50;
		const SECTION_ORDER = 2;

		const zh = {
			tab: "会话推送",
			title: "会话推送",
			intro: "会话持续到设定时长后结束时推送会话开头；DSH 弹出提问或审批选择框长时间无人回应时推送问题本身。",
			loading: "正在读取配置…",
			unavailable: "配置命名空间暂不可用（session-push）。",
			readonly: "当前配置为只读。",
			sectionGeneral: "通用",
			sectionQuestion: "等待回应",
			sectionBark: "Bark",
			sectionServerChan: "Server酱",
			sectionWebhook: "Webhook",
			save: "保存",
			discard: "撤销修改",
			dirty: "有 {n} 项未保存",
			clean: "已保存",
			saving: "保存中…",
			saved: "已保存",
			failed: "保存失败，请重试",
			invalid: "请检查数值字段的填写",
			enabled: "启用",
			enabledHint: "总开关：关闭后不再推送",
		};

		const en = {
			tab: "Session Push",
			title: "Session Push",
			intro: "Pushes the opening of a session when it ends after the configured duration; pushes the question itself when a DSH dialog waits too long for an answer.",
			loading: "Loading configuration…",
			unavailable: "Configuration namespace unavailable (session-push).",
			readonly: "Configuration is read-only.",
			sectionGeneral: "General",
			sectionQuestion: "Waiting for answer",
			sectionBark: "Bark",
			sectionServerChan: "ServerChan",
			sectionWebhook: "Webhook",
			save: "Save",
			discard: "Discard",
			dirty: "{n} unsaved change(s)",
			clean: "Saved",
			saving: "Saving…",
			saved: "Saved",
			failed: "Save failed, please retry",
			invalid: "Please check the numeric fields",
			enabled: "Enabled",
			enabledHint: "Master switch",
		};

		/** 字段 → 分组。key 必须与宿主 Config 一致。 */
		const SECTIONS = [
			{
				key: "general",
				titleKey: "sectionGeneral",
				fields: [
					{ key: "enabled", label: "启用插件", hint: "关闭后不再推送任何消息", type: "bool" },
					{
						key: "minMinutes",
						label: "推送阈值（分钟）",
						hint: "会话持续达到该分钟数才推送，0 表示每次结束都推送",
						type: "number",
						min: 0,
						max: 100000,
						step: 1,
					},
					{
						key: "durationMode",
						label: "计时方式",
						hint: "session = 从会话开始算起；turn = 从本轮开始算起",
						type: "select",
						options: [
							["session", "从会话开始计时（session）"],
							["turn", "从本轮开始计时（turn）"],
						],
					},
					{ key: "title", label: "推送标题", hint: "会话完成推送的标题", type: "text" },
					{
						key: "maxChars",
						label: "正文字数上限",
						hint: "会话开头超出部分截断为…",
						type: "number",
						min: 10,
						max: 2000,
						step: 10,
					},
					{ key: "includeMeta", label: "附带时长 / 会话名", hint: "正文末尾附加时长、会话名、完成时间", type: "bool" },
					{ key: "oncePerSession", label: "每个会话只推一次", hint: "推送失败不会记为已推送", type: "bool" },
					{ key: "notifyOnError", label: "错误 / 中断也推送", hint: "关闭则只推送正常完成", type: "bool" },
					{ key: "notifySubagents", label: "子代理会话也推送", hint: "默认跳过子代理会话", type: "bool" },
					{ key: "debugLog", label: "详细日志", hint: "写入更详细的调试记录", type: "bool" },
					{
						key: "timeoutSeconds",
						label: "请求超时（秒）",
						hint: "单次推送请求的超时时间",
						type: "number",
						min: 1,
						max: 60,
						step: 1,
					},
				],
			},
			{
				key: "question",
				titleKey: "sectionQuestion",
				fields: [
					{
						key: "notifyOnQuestion",
						label: "选择框超时推送",
						hint: "DSH 弹出提问 / 审批选择框、等待回应超时后推送一次",
						type: "bool",
					},
					{
						key: "questionTimeoutMinutes",
						label: "等待阈值（分钟）",
						hint: "超过该时长仍未回应即推送，默认 2 分钟",
						type: "number",
						min: 0.1,
						max: 240,
						step: 0.1,
					},
					{ key: "questionTitle", label: "推送标题", hint: "等待回应推送的标题", type: "text" },
					{ key: "questionIncludeOptions", label: "附带选项列表", hint: "正文里列出可选项", type: "bool" },
				],
			},
			{
				key: "bark",
				titleKey: "sectionBark",
				fields: [
					{ key: "barkEnabled", label: "启用 Bark", hint: "推送到 iPhone 上的 Bark App", type: "bool" },
					{
						key: "barkServer",
						label: "服务器地址",
						hint: "官方服务器 https://api.day.app，自建请修改",
						type: "text",
						placeholder: "https://api.day.app",
					},
					{ key: "barkKey", label: "设备 Key", hint: "Bark App 首页的设备 Key", type: "text", placeholder: "xxxxxxxx" },
					{ key: "barkGroup", label: "分组", hint: "可选，消息分组名", type: "text" },
					{ key: "barkSound", label: "提示音", hint: "可选，如 bell / alarm", type: "text" },
					{
						key: "barkLevel",
						label: "通知级别",
						hint: "critical 需要 App 端允许",
						type: "select",
						options: [
							["active", "active（默认）"],
							["timeSensitive", "timeSensitive（时效性）"],
							["passive", "passive（静默）"],
							["critical", "critical（重要）"],
						],
					},
					{ key: "barkIcon", label: "图标 URL", hint: "可选", type: "text" },
					{ key: "barkUrl", label: "点击跳转 URL", hint: "可选", type: "text" },
				],
			},
			{
				key: "serverchan",
				titleKey: "sectionServerChan",
				fields: [
					{ key: "serverChanEnabled", label: "启用 Server酱", hint: "推送到微信", type: "bool" },
					{
						key: "serverChanSendKey",
						label: "SendKey",
						hint: "Server酱³ 为 sctp 开头，Turbo 版为 SCT 开头",
						type: "text",
						placeholder: "SCTxxxxxxxx",
					},
					{
						key: "serverChanUrl",
						label: "推送地址模板",
						hint: "保留 {sendkey} 占位符",
						type: "text",
						placeholder: "https://sctapi.ftqq.com/{sendkey}.send",
					},
				],
			},
			{
				key: "webhook",
				titleKey: "sectionWebhook",
				fields: [
					{ key: "webhookEnabled", label: "启用 Webhook", hint: "推送到自定义 HTTP 接口", type: "bool" },
					{ key: "webhookUrl", label: "地址", hint: "http(s) 地址", type: "text", placeholder: "https://example.com/hook" },
					{
						key: "webhookMethod",
						label: "请求方法",
						hint: "POST 携带正文；GET 把内容拼到查询参数",
						type: "select",
						options: [
							["POST", "POST"],
							["GET", "GET"],
						],
					},
					{
						key: "webhookHeaders",
						label: "请求头（JSON）",
						hint: '例如 {"Authorization":"Bearer xxx"}',
						type: "textarea",
						placeholder: '{"Authorization":"Bearer xxx"}',
					},
					{
						key: "webhookBodyTemplate",
						label: "请求体模板（可选）",
						hint: "留空使用默认 JSON；可用 {{title}} {{content}} {{sessionId}} 等占位符",
						type: "textarea",
						placeholder: '{"text":"{{title}}：{{content}}"}',
					},
				],
			},
		];

		/** CSS 变量（与官方 dsw-alias 一致）。 */
		const v = {
			border: "var(--dsw-alias-border-l2)",
			bg3: "var(--dsw-alias-bg-layer-3)",
			bg2: "var(--dsw-alias-bg-layer-2)",
			label1: "var(--dsw-alias-label-primary)",
			label2: "var(--dsw-alias-label-secondary)",
			label3: "var(--dsw-alias-label-tertiary)",
			brand: "var(--dsw-alias-brand-primary)",
			err: "var(--dsw-alias-label-error)",
		};

		const s = {
			wrap: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 2px 8px" },
			headTitle: { fontSize: "15px", fontWeight: 600, color: v.label1, margin: 0 },
			headText: { fontSize: "12px", lineHeight: 1.6, color: v.label2, margin: "6px 0 0" },
			section: {
				border: "1px solid " + v.border,
				borderRadius: "12px",
				background: v.bg2,
				padding: "12px 14px",
			},
			sectionTitle: { fontSize: "12px", fontWeight: 600, color: v.label1, margin: "0 0 10px" },
			row: {
				display: "grid",
				gridTemplateColumns: "200px minmax(0, 1fr)",
				gap: "10px 14px",
				alignItems: "start",
				padding: "8px 0",
				borderTop: "1px solid " + v.border,
			},
			rowFirst: { borderTop: "none", paddingTop: 0 },
			label: { fontSize: "12px", color: v.label1, lineHeight: "28px" },
			control: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
			hint: { fontSize: "11px", lineHeight: 1.5, color: v.label3 },
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "5px 9px",
				fontSize: "12px",
				color: v.label1,
				background: v.bg3,
				border: "1px solid " + v.border,
				borderRadius: "8px",
				outline: "none",
			},
			checkWrap: { display: "flex", alignItems: "center", gap: "8px", minHeight: "28px" },
			check: { width: "14px", height: "14px", accentColor: v.brand, cursor: "pointer" },
			checkText: { fontSize: "12px", color: v.label2 },
			footer: {
				position: "sticky",
				bottom: 0,
				display: "flex",
				alignItems: "center",
				gap: "10px",
				padding: "10px 14px",
				border: "1px solid " + v.border,
				borderRadius: "12px",
				background: v.bg2,
			},
			status: { fontSize: "12px", color: v.label3, flex: 1 },
			btn: {
				padding: "5px 14px",
				fontSize: "12px",
				borderRadius: "8px",
				border: "1px solid " + v.border,
				background: v.bg3,
				color: v.label1,
				cursor: "pointer",
			},
			btnPrimary: {
				padding: "5px 14px",
				fontSize: "12px",
				borderRadius: "8px",
				border: "1px solid transparent",
				background: v.brand,
				color: "#fff",
				cursor: "pointer",
			},
			btnOff: { opacity: 0.45, cursor: "not-allowed" },
			error: { fontSize: "12px", color: v.err, flex: 1 },
		};

		/** 数值字段的输入值 → 数字，无效返回 undefined。 */
		function toNumber(field, raw) {
			const text = String(raw ?? "").trim();
			if (text === "") return undefined;
			const n = Number(text);
			if (!Number.isFinite(n)) return undefined;
			if (field.min !== undefined && n < field.min) return undefined;
			if (field.max !== undefined && n > field.max) return undefined;
			return n;
		}

		function FieldControl(props) {
			const { field, value, disabled, t, onChange } = props;
			if (field.type === "bool") {
				return react.createElement(
					"div",
					{ style: s.checkWrap },
					react.createElement("input", {
						type: "checkbox",
						style: s.check,
						checked: value === true,
						disabled,
						onChange: (e) => onChange(e.target.checked),
					}),
					react.createElement("span", { style: s.checkText }, value === true ? t("enabled") : "—"),
				);
			}
			if (field.type === "select") {
				return react.createElement(
					"select",
					{
						style: s.input,
						value: value === undefined || value === null ? "" : String(value),
						disabled,
						onChange: (e) => onChange(e.target.value),
					},
					(field.options || []).map((opt) =>
						react.createElement("option", { key: opt[0], value: opt[0] }, opt[1]),
					),
				);
			}
			if (field.type === "textarea") {
				return react.createElement("textarea", {
					style: Object.assign({}, s.input, { minHeight: "56px", resize: "vertical", fontFamily: "inherit" }),
					value: value === undefined || value === null ? "" : String(value),
					disabled,
					placeholder: field.placeholder || "",
					onChange: (e) => onChange(e.target.value),
				});
			}
			return react.createElement("input", {
				type: field.type === "number" ? "number" : "text",
				style: s.input,
				value: value === undefined || value === null ? "" : String(value),
				disabled,
				placeholder: field.placeholder || "",
				min: field.min,
				max: field.max,
				step: field.step,
				onChange: (e) => onChange(e.target.value),
			});
		}

		function SessionPushCard(props) {
			const form = props.form;
			const [snap, setSnap] = react.useState(() =>
				form && typeof form.getSnapshot === "function" ? form.getSnapshot() : { status: "missing" },
			);
			const [draft, setDraft] = react.useState({});
			const [saving, setSaving] = react.useState(false);
			const [status, setStatus] = react.useState("clean");
			react.useEffect(() => {
				if (!form || typeof form.subscribe !== "function") return undefined;
				return form.subscribe(() => {
					setSnap(form.getSnapshot());
				});
			}, [form]);
			const ready = snap && snap.status === "ready";
			const value = ready ? snap.value || {} : {};
			const writable = !!(snap && snap.writable);
			const dirtyKeys = Object.keys(draft);
			const fieldValue = (field) => (field.key in draft ? draft[field.key] : value[field.key]);
			const stage = (field, next) => {
				setStatus("clean");
				setDraft((prev) => {
					const out = Object.assign({}, prev);
					out[field.key] = next;
					return out;
				});
			};
			const commit = () => {
				if (!form || dirtyKeys.length === 0 || saving || !writable) return;
				const writes = [];
				for (const section of SECTIONS) {
					for (const field of section.fields) {
						if (!(field.key in draft)) continue;
						const raw = draft[field.key];
						if (field.type === "number") {
							const n = toNumber(field, raw);
							if (n === undefined) {
								setStatus("invalid");
								return;
							}
							writes.push(form.set(field.key, n));
						} else {
							writes.push(form.set(field.key, raw));
						}
					}
				}
				setSaving(true);
				Promise.all(writes)
					.then(() => {
						setDraft({});
						setSaving(false);
						setStatus("saved");
					})
					.catch(() => {
						setSaving(false);
						setStatus("failed");
					});
			};
			if (!ready) {
				return react.createElement(
					"div",
					{ style: s.wrap },
					react.createElement(
						"p",
						{ style: s.headText },
						snap && snap.status === "unavailable" ? t("unavailable") : t("loading"),
					),
				);
			}
			return react.createElement(
				"div",
				{ style: s.wrap },
				react.createElement(
					"div",
					null,
					react.createElement("h3", { style: s.headTitle }, t("title")),
					react.createElement("p", { style: s.headText }, t("intro")),
				),
				react.createElement(
					"div",
					null,
					SECTIONS.map((section, index) =>
						react.createElement(
							"div",
							{ key: section.key, style: Object.assign({}, s.section, index === 0 ? {} : { marginTop: "12px" }) },
							react.createElement("h4", { style: s.sectionTitle }, section.titleKey),
							section.fields.map((field, i) =>
								react.createElement(
									"div",
									{ key: field.key, style: Object.assign({}, s.row, i === 0 ? s.rowFirst : {}) },
									react.createElement("div", { style: s.label }, field.label),
									react.createElement(
										"div",
										{ style: s.control },
										react.createElement(FieldControl, {
											field,
											value: fieldValue(field),
											disabled: !writable || saving,
											onChange: (next) => stage(field, next),
										}),
										field.hint ? react.createElement("div", { style: s.hint }, field.hint) : null,
										field.key in draft
											? react.createElement(
													"div",
													{ style: Object.assign({}, s.hint, { color: v.brand }) },
													"待保存",
												)
											: null,
									),
								),
							),
						),
					),
				),
				react.createElement(
					"div",
					{ style: s.footer },
					react.createElement(
						"span",
						{ style: status === "invalid" || status === "failed" ? s.error : s.status },
						status === "invalid"
							? "请检查数值字段的填写"
							: status === "failed"
								? "保存失败，请重试"
								: saving
									? "保存中…"
									: dirtyKeys.length
										? "有 " + dirtyKeys.length + " 项未保存"
										: status === "saved"
											? "已保存"
											: !writable
												? "当前配置为只读"
												: "—",
					),
					react.createElement(
						"button",
						{
							type: "button",
							style: Object.assign({}, s.btn, dirtyKeys.length === 0 || saving ? s.btnOff : {}),
							disabled: dirtyKeys.length === 0 || saving,
							onClick: () => {
								setDraft({});
								setStatus("clean");
							},
						},
						"撤销修改",
					),
					react.createElement(
						"button",
						{
							type: "button",
							style: Object.assign({}, s.btnPrimary, dirtyKeys.length === 0 || saving || !writable ? s.btnOff : {}),
							disabled: dirtyKeys.length === 0 || saving || !writable,
							onClick: commit,
						},
						"保存",
					),
				),
			);
		}

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh,
						en,
					}),
				"session-push: settings dictionaries",
			);
			let form;
			try {
				form = ctx.configForms.get(NS);
			} catch (e) {
				form = undefined;
			}
			// 主导航里的独立设置页（与 dsh-pocket 的「手机访问」同一槽位、同一写法）。
			ctx.effect(
				() =>
					ctx.slots.inject("settings.section", () =>
						ctx.slots.register(
							{
								name: "settings.section",
								id: NS,
								order: SECTION_ORDER,
								label: () => t("tab"),
								inject: () => ({ form }),
							},
							SessionPushCard,
						),
					),
				"session-push: settings section",
			);
			// 另外在「设置 → 插件」里也挂一个标签页。
			ctx.effect(
				() =>
					ctx.slots.inject("settings.plugins.tab", () =>
						ctx.slots.register(
							{
								name: "settings.plugins.tab",
								id: NS,
								order: TAB_ORDER,
								label: () => t("tab"),
								inject: () => ({ form }),
							},
							SessionPushCard,
						),
					),
				"session-push: plugins tab",
			);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
