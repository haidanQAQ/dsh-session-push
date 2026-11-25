/**
 * 推送通道：Bark / Server酱 / 通用 Webhook。
 * 每个通道独立失败，互不影响；返回值用于决定是否记为「已推送」。
 */

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function timeoutSignal(seconds) {
  const ms = Math.max(1, Number(seconds) || 10) * 1000
  try {
    return AbortSignal.timeout(ms)
  } catch {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    if (typeof timer?.unref === 'function') timer.unref()
    return controller.signal
  }
}

async function readBody(response) {
  try {
    const text = await response.text()
    return text.length > 600 ? `${text.slice(0, 600)}…` : text
  } catch {
    return ''
  }
}

function summarize(response, body) {
  const flat = String(body || '').replace(/\s+/g, ' ').trim()
  return `HTTP ${response.status}${flat ? ` · ${flat.slice(0, 300)}` : ''}`
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Bark（支持自建服务器与官方 /push 接口）。 */
export async function pushBark(cfg, payload) {
  const key = String(cfg.barkKey || '').trim()
  if (!key) throw new Error('未填写 Bark 设备 Key')
  const base = trimSlash(cfg.barkServer) || 'https://api.day.app'
  const form = new URLSearchParams()
  form.set('device_key', key)
  form.set('title', payload.title)
  form.set('body', payload.content)
  if (cfg.barkGroup) form.set('group', cfg.barkGroup)
  if (cfg.barkSound) form.set('sound', cfg.barkSound)
  if (cfg.barkLevel && cfg.barkLevel !== 'active') form.set('level', cfg.barkLevel)
  if (cfg.barkIcon) form.set('icon', cfg.barkIcon)
  if (cfg.barkUrl) form.set('url', cfg.barkUrl)

  const response = await fetch(`${base}/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: form.toString(),
    signal: timeoutSignal(cfg.timeoutSeconds),
  })
  const text = await readBody(response)
  if (!response.ok) throw new Error(`Bark 推送失败：${summarize(response, text)}`)
  const json = parseJson(text)
  if (json && typeof json.code === 'number' && json.code !== 200) {
    throw new Error(`Bark 推送失败：code=${json.code} ${json.message ?? ''}`.trim())
  }
  return 'Bark 推送成功'
}

/** Server酱（Turbo / ³ 以及自建兼容接口）。 */
export async function pushServerChan(cfg, payload) {
  const key = String(cfg.serverChanSendKey || '').trim()
  if (!key) throw new Error('未填写 Server酱 SendKey')
  const template = String(cfg.serverChanUrl || 'https://sctapi.ftqq.com/{sendkey}.send').trim()
  const url = template.includes('{sendkey}')
    ? template.split('{sendkey}').join(encodeURIComponent(key))
    : template

  const form = new URLSearchParams()
  form.set('title', payload.title)
  form.set('desp', payload.content)

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: form.toString(),
    signal: timeoutSignal(cfg.timeoutSeconds),
  })
  const text = await readBody(response)
  if (!response.ok) throw new Error(`Server酱 推送失败：${summarize(response, text)}`)
  const json = parseJson(text)
  if (json && typeof json.code === 'number' && json.code !== 0) {
    throw new Error(`Server酱 推送失败：code=${json.code} ${json.message ?? json.info ?? ''}`.trim())
  }
  return 'Server酱 推送成功'
}

function jsonEscape(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1)
}

const TEMPLATE_TOKENS = (payload, jsonSafe) => {
  const wrap = (value) => (jsonSafe ? jsonEscape(value) : String(value ?? ''))
  return {
    '{{title}}': wrap(payload.title),
    '{{content}}': wrap(payload.content),
    '{{sessionId}}': wrap(payload.sessionId),
    '{{sessionTitle}}': wrap(payload.sessionTitle ?? ''),
    '{{minutes}}': String(payload.minutes ?? 0),
    '{{time}}': wrap(payload.timeText ?? ''),
    '{{titleJSON}}': jsonEscape(payload.title),
    '{{contentJSON}}': jsonEscape(payload.content),
    '{{sessionTitleJSON}}': jsonEscape(payload.sessionTitle ?? ''),
    '{{sessionIdJSON}}': jsonEscape(payload.sessionId ?? ''),
  }
}

/** 模板里 { {content} } 这类占位符会被替换；JSON 模板自动做转义，避免引号/换行破坏结构。 */
function applyTemplate(template, payload, jsonSafe = false) {
  const tokens = TEMPLATE_TOKENS(payload, jsonSafe)
  let output = template
  for (const [token, value] of Object.entries(tokens)) {
    output = output.split(token).join(String(value ?? ''))
  }
  return output
}

function parseHeaders(text) {
  const raw = String(text || '').trim()
  if (!raw) return {}
  const json = parseJson(raw)
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('webhookHeaders 必须是 JSON 对象文本，例如 {"Authorization":"Bearer xxx"}')
  }
  const headers = {}
  for (const [name, value] of Object.entries(json)) headers[name] = String(value)
  return headers
}

/** 通用 Webhook：默认发送 JSON，也支持自定义模板与 GET。 */
export async function pushWebhook(cfg, payload) {
  const url = String(cfg.webhookUrl || '').trim()
  if (!url) throw new Error('未填写 Webhook 地址')
  const method = String(cfg.webhookMethod || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  const template = String(cfg.webhookBodyTemplate || '')
  const headers = parseHeaders(cfg.webhookHeaders)
  if (!headers['content-type'] && !headers['Content-Type']) {
    headers['content-type'] = 'application/json; charset=utf-8'
  }
  const contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? '')
  // 模板本身是 JSON 且按 JSON 发送时，占位符内容必须转义，否则引号和换行会破坏结构。
  const jsonSafe = method === 'POST' && /json/i.test(contentType) && /^\s*[[{]/.test(template)

  const defaultBody = JSON.stringify({
    title: payload.title,
    content: payload.content,
    sessionId: payload.sessionId,
    sessionTitle: payload.sessionTitle ?? '',
    minutes: payload.minutes ?? 0,
    time: payload.timeText ?? '',
    source: 'dsh-session-push',
  })

  let target = url
  let body
  if (method === 'GET') {
    if (template) {
      target = applyTemplate(template, payload)
    } else {
      const query = new URLSearchParams({
        title: payload.title,
        content: payload.content,
        sessionId: payload.sessionId,
        sessionTitle: payload.sessionTitle ?? '',
        minutes: String(payload.minutes ?? 0),
        time: payload.timeText ?? '',
      })
      target = `${url}${url.includes('?') ? '&' : '?'}${query.toString()}`
    }
  } else {
    body = template ? applyTemplate(template, payload, jsonSafe) : defaultBody
  }

  const response = await fetch(target, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    signal: timeoutSignal(cfg.timeoutSeconds),
  })
  const text = await readBody(response)
  if (!response.ok) throw new Error(`Webhook 推送失败：${summarize(response, text)}`)
  return 'Webhook 推送成功'
}

/**
 * 依次尝试所有已启用的通道。
 * @returns {{ ok: boolean, skipped?: string, results: Array<{channel: string, ok: boolean, detail: string}> }}
 */
export async function sendAll(cfg, payload) {
  const jobs = []
  if (cfg.barkEnabled) jobs.push(['bark', () => pushBark(cfg, payload)])
  if (cfg.serverChanEnabled) jobs.push(['serverchan', () => pushServerChan(cfg, payload)])
  if (cfg.webhookEnabled) jobs.push(['webhook', () => pushWebhook(cfg, payload)])
  if (jobs.length === 0) return { ok: false, skipped: 'no-channel', results: [] }

  const results = await Promise.all(
    jobs.map(async ([channel, run]) => {
      try {
        const detail = await run()
        return { channel, ok: true, detail: String(detail || '成功') }
      } catch (error) {
        return { channel, ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  return { ok: results.some((result) => result.ok), results }
}
