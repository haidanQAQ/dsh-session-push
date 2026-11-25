/**
 * 会话内容提取：把一条 user/message 事件的数据转成纯文本，并取出会话开头的第一条用户消息。
 * 这里只做保守、无依赖的解析，避免依赖 Session 内部的投影缓存。
 */

/** 把任意值压成干净的单行/多行文本。 */
export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 按可见字符（码点）截断，超出时补省略号。 */
export function truncateText(value, limit) {
  const text = normalizeText(value)
  const max = Math.max(1, Math.floor(Number(limit) || 1))
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

/** 从消息内容块中拼出文本。 */
export function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return normalizeText(content)
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block) continue
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    const type = block.type
    if (type === 'text' || type === 'input_text' || type === 'output_text') {
      if (typeof block.text === 'string') parts.push(block.text)
      continue
    }
    // 图片、附件之类的块只留一个占位，避免正文里出现 JSON 噪音。
    if (type === 'image' || type === 'image_url' || type === 'file') {
      parts.push('[附件]')
      continue
    }
  }
  return normalizeText(parts.join('\n'))
}

/** 反向查找最后一个指定类型的事件。 */
export function findLastEvent(session, endSeq, type) {
  const total = typeof session?.seq === 'number' ? session.seq : 0
  const last = Math.min(typeof endSeq === 'number' ? endSeq : total, total) - 1
  const floor = Math.max(0, last - 2000)
  for (let i = last; i >= floor; i--) {
    let event
    try {
      event = session.eventAt(i)
    } catch {
      continue
    }
    if (event?.type === type) return event
  }
  return undefined
}

/** 看起来像 harness 注入的上下文（运行时上下文、压缩摘要、XML 片段等）。 */
function looksInjected(text) {
  const head = text.slice(0, 120)
  if (head.startsWith('<')) return true
  return /^(Time sampled while preparing|Elapsed since the preceding|Current runtime context|\[Compressed conversation section\])/i.test(
    head,
  )
}

/**
 * 取会话开头的第一条用户消息文本。
 * 优先 source.kind === 'user' 的真实输入，并跳过 harness 注入的上下文消息。
 */
export function firstUserText(session, maxEvents = 400) {
  const total = typeof session?.seq === 'number' ? session.seq : 0
  const limit = Math.min(total, Math.max(1, maxEvents))
  const candidates = []
  for (let i = 0; i < limit && candidates.length < 8; i++) {
    let event
    try {
      event = session.eventAt(i)
    } catch {
      continue
    }
    if (event?.type !== 'user/message') continue
    const text = messageText(event.data)
    if (!text) continue
    const kind = event.data?.source?.kind
    if (kind !== undefined && kind !== 'user') continue
    candidates.push(text)
  }
  if (candidates.length === 0) return ''
  return candidates.find((text) => !looksInjected(text)) ?? candidates[0]
}

/**
 * 把 ask_user_question 的服务请求（questions 数组）拼成推送正文。
 * 形如【标题】问题、详情、· 选项。
 */
export function questionText(questions, includeOptions = true) {
  if (!Array.isArray(questions)) return ''
  const lines = []
  for (const item of questions) {
    if (!item || typeof item.question !== 'string' || !item.question.trim()) continue
    const header = typeof item.header === 'string' && item.header.trim() ? `【${item.header.trim()}】` : ''
    lines.push(`${header}${item.question.trim()}`)
    if (typeof item.detail === 'string' && item.detail.trim()) lines.push(item.detail.trim())
    if (includeOptions && Array.isArray(item.options) && item.options.length > 0) {
      const labels = item.options
        .map((option) => (typeof option?.label === 'string' ? option.label.trim() : ''))
        .filter(Boolean)
      if (labels.length > 0) lines.push(labels.map((label) => `· ${label}`).join('\n'))
    }
  }
  return normalizeText(lines.join('\n'))
}

/** 会话标题（最近一次 session/title 事件）。 */
export function sessionTitleText(session, endSeq) {
  const event = findLastEvent(session, endSeq, 'session/title')
  const title = event?.data?.title
  return typeof title === 'string' ? title.trim() : ''
}
