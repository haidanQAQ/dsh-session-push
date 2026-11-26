# dsh-session-push

<img src="icon.png" width="96" alt="dsh-session-push icon" align="right">

给 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）用的推送插件：**会话结束**和**弹框等待回应**时，通过 Bark / Server酱 / 通用 Webhook 提醒你。

- **会话结束推送**：会话持续时长达到阈值后结束时，把**会话开头**推出去。标题默认「DSH会话已完成」，正文取该会话第一条真实用户消息，超出字数上限自动截断为 `…`。
- **等待回应推送**：DSH 弹出提问 / 审批选择框后，超过设定时间（默认 2 分钟）没有回应，推送「DSH等待回应中」和框里的问题。
- 同一会话只推送一次；推送失败不算已推送，下一个结束的轮次会重试。
- 子代理会话默认不推送；错误 / 中断结束默认也推送（可关）。

English: pushes a notification when a session that ran longer than N minutes ends, and when a question or approval dialog is left waiting for an answer. Supports Bark, ServerChan and generic webhooks.

## 安装

从插件市场（发现 → 搜索 `dsh-session-push`）安装，或：

```bash
dsh plugin --profile web add dsh-session-push
```

还没发布到 npm 时，可以直接从仓库装：

```bash
dsh plugin --profile web add https://github.com/haidanQAQ/dsh-session-push
```

装完重启 DSH。打开 **设置 → 左侧「会话推送」**（和 dsh-pocket 的「手机访问」同样的独立设置页，命名空间 `session-push`）即可配置，保存后即时生效；「设置 → 插件」里也有同名标签页。

## 设置项

### 通用

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `minMinutes` | `10` | 计时时长达到该分钟数才推送，`0` 表示每次都推 |
| `durationMode` | `turn` | `turn` = 从本轮任务开始算起（推荐）；`session` = 从本次连续活动开始算起 |
| `idleGapMinutes` | `30` | 仅 `session` 模式：相邻记录相隔超过该分钟数就当作新的一次会话重新计时 |
| `title` | `DSH会话已完成` | 结束推送标题 |
| `maxChars` | `300` | 正文字数上限（按可见字符截断） |
| `includeMeta` | `true` | 正文末尾附加时长 / 会话名 / 完成时间 |
| `oncePerSession` | `true` | 同一会话的同一轮只推送一次（记录写入 `state.json`，重启后依然有效） |
| `notifyOnError` | `true` | 错误、中断结束也推送 |
| `notifySubagents` | `false` | 子代理会话也推送 |
| `notifyOnQuestion` | `true` | 提问 / 审批弹框等待超时也推送 |
| `questionTimeoutMinutes` | `2` | 弹框等待回应的阈值（分钟） |
| `questionTitle` | `DSH等待回应中` | 等待回应推送的标题 |
| `questionIncludeOptions` | `true` | 推送正文里附上选项列表 |
| `timeoutSeconds` | `10` | 单次请求超时 |
| `debugLog` | `false` | 记录跳过原因等调试日志 |

### 计时方式

- `turn`（默认）：只算本轮任务从开始到结束的时长。一条开了很久的会话里，临时问一句、几分钟就结束的这一轮不会触发推送。
- `session`：从「本次连续活动」的第一条记录算起，中间空闲超过 `idleGapMinutes` 分钟就断开重新计时。适合「连续工作一小时以上再提醒」的用法。

两端都用 `minMinutes` 做阈值；推送后按「会话 + 轮次」记入 `state.json`，DSH 重启、插件重装都不会重复推送同一轮。

### 等待回应推送

DSH 弹出 `ask_user_question` 选择框或审批框后开始计时，超过 `questionTimeoutMinutes` 分钟仍无回应就推送一次：

- 标题：`questionTitle`（默认 `DSH等待回应中`）
- 正文：问题标题 / 问题 / 详情 / 选项（`questionIncludeOptions` 控制是否带选项），同样受 `maxChars` 截断

用户提交回答、审批出结果或本轮结束时自动取消计时。定时模式下 `ask_user_question` 会先返回 pending（问题仍可回答），此时继续计时，直到用户真正回答。审批框正文取审批说明，没有说明时显示「工具 xxx 正在请求你的批准」。

### Bark

| 字段 | 说明 |
| --- | --- |
| `barkEnabled` | 启用 Bark |
| `barkServer` | 默认 `https://api.day.app`，自建服务器改成自己的地址 |
| `barkKey` | 设备 Key，App 首页可复制 |
| `barkGroup` / `barkSound` / `barkIcon` / `barkUrl` | 可选：分组、提示音、图标、点击跳转 |
| `barkLevel` | `active` / `timeSensitive` / `passive` / `critical` |

请求：`POST {barkServer}/push`，表单字段 `device_key`、`title`、`body`。

### Server酱

| 字段 | 说明 |
| --- | --- |
| `serverChanEnabled` | 启用 Server酱 |
| `serverChanSendKey` | `SCT` 开头的 SendKey |
| `serverChanUrl` | 默认 `https://sctapi.ftqq.com/{sendkey}.send`，`{sendkey}` 会被替换 |

请求：`POST` 表单字段 `title`、`desp`。

### Webhook

| 字段 | 说明 |
| --- | --- |
| `webhookEnabled` | 启用 Webhook |
| `webhookUrl` | 接收地址 |
| `webhookMethod` | `POST`（默认）或 `GET` |
| `webhookHeaders` | 附加请求头，JSON 对象文本，如 `{"Authorization":"Bearer xxx"}` |
| `webhookBodyTemplate` | 自定义请求体，留空则发送默认 JSON |

默认 POST 请求体：

```json
{
  "title": "DSH会话已完成",
  "content": "会话开头的文本…",
  "sessionId": "…",
  "sessionTitle": "…",
  "minutes": 25,
  "time": "2026-01-01 00:00:00",
  "source": "dsh-session-push"
}
```

模板可用占位符：`{{title}}`、`{{content}}`、`{{sessionId}}`、`{{sessionTitle}}`、`{{minutes}}`、`{{time}}`，以及始终做 JSON 转义的 `{{titleJSON}}` / `{{contentJSON}}` / `{{sessionTitleJSON}}` / `{{sessionIdJSON}}`。
当模板本身以 `{` 或 `[` 开头且按 JSON 发送时，`{{content}}` 这类占位符会自动转义，因此下面这种模板可以直接用：

```json
{"msgtype":"text","text":{"content":"{{title}}\n{{content}}"}}
```

GET 模式留空模板时，参数以 `title` `content` `sessionId` `sessionTitle` `minutes` `time` 形式拼到 URL 上。

## 实现要点

- 宿主侧只监听公开的 `session/event` 事件流（`turn/end`、`tool/call`、`tool/result`、`approval/asked`、`approval/decided`、`user/message`），不轮询、不读取会话文件。
- 设置项由 `Config` 导出的 schemastery schema 声明；浏览器侧 `lib/client.js` 通过 `ctx.slots` 注册 `settings.section`（主导航独立设置页，和 dsh-pocket 同一槽位）与 `settings.plugins.tab`（插件页标签），经 `ctx.configForms` 读写 `session-push` 命名空间。
- 只用 Node 内置模块（`fetch`、`AbortSignal.timeout`），没有运行时依赖。

## 测试

```bash
npm test
```

测试用本地 http 服务器接管所有请求，覆盖内容提取、三种通道的请求格式、阈值 / 去重 / 子代理 / 错误重试 / 截断，以及提问与审批的超时、及时回答、事后回答取消等场景（40 项断言）。测试不需要宿主：`test/register.mjs` 把 `@deepseek-ai/schemastery` 解析到仓库内的替身实现。

## 日志

`%DSH_HOME%\session-push\session-push.log`（默认在
`C:\Users\<用户>\AppData\Roaming\dsh-desktop\harness\session-push\session-push.log`），
记录每次推送成功/失败与跳过原因，单个文件超过 512 KB 时轮转为 `.log.1`。

## 隐私

插件只把推送内容发给你自己配置的 Bark / Server酱 / Webhook 地址，不收集、不上报任何数据；日志只写在本地。

## License

MIT
