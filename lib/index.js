/**
 * dsh-session-push
 * 当一次会话持续时长达到阈值并结束时，把「会话开头」推送到 Bark / Server酱 / Webhook。
 */
import z from '@deepseek-ai/schemastery'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { firstUserText, findLastEvent, messageText, questionText, sessionTitleText, truncateText } from './content.js'
import { sendAll } from './senders.js'

export const name = 'dsh-session-push'
export const inject = ['sessions']

const LOG_MAX_BYTES = 512 * 1024

const DEFAULTS = {
  enabled: true,
  minMinutes: 10,
  durationMode: 'turn',
  idleGapMinutes: 30,
  title: 'DSH会话已完成',
  maxChars: 300,
  includeMeta: true,
  oncePerSession: true,
  notifyOnError: true,
  notifySubagents: false,
  notifyOnQuestion: true,
  questionTimeoutMinutes: 2,
  questionTitle: 'DSH等待回应中',
  questionIncludeOptions: true,
  debugLog: false,
  timeoutSeconds: 10,
  barkEnabled: false,
  barkServer: 'https://api.day.app',
  barkKey: '',
  barkGroup: '',
  barkSound: '',
  barkLevel: 'active',
  barkIcon: '',
  barkUrl: '',
  serverChanEnabled: false,
  serverChanSendKey: '',
  serverChanUrl: 'https://sctapi.ftqq.com/{sendkey}.send',
  webhookEnabled: false,
  webhookUrl: '',
  webhookMethod: 'POST',
  webhookHeaders: '',
  webhookBodyTemplate: '',
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled).volatile().description('总开关：关闭后不再推送'),
  minMinutes: z
    .number()
    .min(0)
    .max(100000)
    .default(DEFAULTS.minMinutes)
    .volatile()
    .description('会话持续达到该分钟数才推送；0 表示每次结束都推送'),
  durationMode: z
    .union(['turn', 'session'])
    .default(DEFAULTS.durationMode)
    .volatile()
    .description('计时方式：turn=从本轮任务开始算起（推荐）；session=从本次连续活动开始算起，中间空闲超过「空闲间隔」就重新计时'),
  idleGapMinutes: z
    .number()
    .min(1)
    .max(1440)
    .default(DEFAULTS.idleGapMinutes)
    .volatile()
    .description('仅在 session 计时方式下生效：相邻两条记录相隔超过该分钟数，就视为新的一次会话（默认 30）'),
  title: z.string().default(DEFAULTS.title).volatile().description('推送标题'),
  maxChars: z
    .number()
    .min(10)
    .max(2000)
    .default(DEFAULTS.maxChars)
    .volatile()
    .description('正文字数上限（会话开头超出部分会截断为…）'),
  includeMeta: z
    .boolean()
    .default(DEFAULTS.includeMeta)
    .volatile()
    .description('正文末尾附加时长、会话名等信息'),
  oncePerSession: z
    .boolean()
    .default(DEFAULTS.oncePerSession)
    .volatile()
    .description('同一会话的同一轮只推送一次（记录会写入 state.json，重启后依然有效；推送失败不会记为已推送）'),
  notifyOnError: z
    .boolean()
    .default(DEFAULTS.notifyOnError)
    .volatile()
    .description('错误 / 中断结束的会话也推送；关闭则只推送正常完成'),
  notifySubagents: z
    .boolean()
    .default(DEFAULTS.notifySubagents)
    .volatile()
    .description('子代理会话也推送'),
  notifyOnQuestion: z
    .boolean()
    .default(DEFAULTS.notifyOnQuestion)
    .volatile()
    .description('DSH 弹出提问 / 审批选择框、等待回应超时后也推送'),
  questionTimeoutMinutes: z
    .number()
    .min(0.1)
    .max(240)
    .default(DEFAULTS.questionTimeoutMinutes)
    .volatile()
    .description('选择框等待回应的阈值（分钟），超过后推送一次'),
  questionTitle: z
    .string()
    .default(DEFAULTS.questionTitle)
    .volatile()
    .description('等待回应推送的标题'),
  questionIncludeOptions: z
    .boolean()
    .default(DEFAULTS.questionIncludeOptions)
    .volatile()
    .description('等待回应推送里附上选项列表'),
  debugLog: z.boolean().default(DEFAULTS.debugLog).volatile().description('记录详细调试日志'),
  timeoutSeconds: z
    .number()
    .min(1)
    .max(60)
    .default(DEFAULTS.timeoutSeconds)
    .volatile()
    .description('单次推送请求超时（秒）'),

  barkEnabled: z.boolean().default(DEFAULTS.barkEnabled).volatile().description('启用 Bark 推送'),
  barkServer: z
    .string()
    .default(DEFAULTS.barkServer)
    .volatile()
    .description('Bark 服务器地址（使用官方服务器保持默认，自建请修改）'),
  barkKey: z.string().default(DEFAULTS.barkKey).volatile().description('Bark 设备 Key'),
  barkGroup: z.string().default(DEFAULTS.barkGroup).volatile().description('Bark 消息分组（可选）'),
  barkSound: z.string().default(DEFAULTS.barkSound).volatile().description('Bark 提示音（可选）'),
  barkLevel: z
    .union(['active', 'timeSensitive', 'passive', 'critical'])
    .default(DEFAULTS.barkLevel)
    .volatile()
    .description('Bark 通知级别'),
  barkIcon: z.string().default(DEFAULTS.barkIcon).volatile().description('Bark 图标 URL（可选）'),
  barkUrl: z.string().default(DEFAULTS.barkUrl).volatile().description('Bark 点击跳转 URL（可选）'),

  serverChanEnabled: z
    .boolean()
    .default(DEFAULTS.serverChanEnabled)
    .volatile()
    .description('启用 Server酱 推送'),
  serverChanSendKey: z
    .string()
    .default(DEFAULTS.serverChanSendKey)
    .volatile()
    .description('Server酱 SendKey（SCT 开头）'),
  serverChanUrl: z
    .string()
    .default(DEFAULTS.serverChanUrl)
    .volatile()
    .description('Server酱 接口地址，{sendkey} 会替换成 SendKey'),

  webhookEnabled: z.boolean().default(DEFAULTS.webhookEnabled).volatile().description('启用 Webhook 推送'),
  webhookUrl: z.string().default(DEFAULTS.webhookUrl).volatile().description('Webhook 地址'),
  webhookMethod: z
    .union(['POST', 'GET'])
    .default(DEFAULTS.webhookMethod)
    .volatile()
    .description('Webhook 请求方法'),
  webhookHeaders: z
    .string()
    .default(DEFAULTS.webhookHeaders)
    .volatile()
    .description('附加请求头，JSON 对象文本，例如 {"Authorization":"Bearer xxx"}'),
  webhookBodyTemplate: z
    .string()
    .default(DEFAULTS.webhookBodyTemplate)
    .volatile()
    .description(
      '自定义请求体模板，可用 {{title}} {{content}} {{contentJSON}} {{sessionId}} {{sessionTitle}} {{minutes}} {{time}}；留空发送默认 JSON',
    ),
})

const COMPLETED_KINDS = new Set(['completed', 'error', 'max-tokens', 'aborted', 'interrupted'])

/** schemastery 的 volatile 包装统一拆成普通值。 */
function unwrapCore(value) {
  if (Array.isArray(value)) return value.map(unwrapCore)
  if (value && typeof value === 'object') {
    if (typeof value.get === 'function' && Object.keys(value).length <= 1) return unwrapCore(value.get())
    const output = {}
    for (const [key, item] of Object.entries(value)) output[key] = unwrapCore(item)
    return output
  }
  return value
}

function unwrapConfig(config) {
  return config && typeof config === 'object' ? unwrapCore(config) : {}
}

/** tool/call 的 arguments 可能是 JSON 文本，也可能是对象。 */
function parseToolArguments(value) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** 把时间戳统一成毫秒。 */
function toMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 1e12 ? value * 1000 : value
}

/** 会话开始时间：优先首条真实用户消息，退化到 header.createdAt。 */
function sessionStartTime(session, endSeq) {
  const total = typeof session?.seq === 'number' ? session.seq : 0
  const limit = Math.min(total, typeof endSeq === 'number' ? endSeq : total, 400)
  for (let i = 0; i < limit; i++) {
    let event
    try {
      event = session.eventAt(i)
    } catch {
      continue
    }
    if (event?.type !== 'user/message') continue
    const time = toMs(event.time)
    if (!time) continue
    const kind = event.data?.source?.kind
    if (kind === undefined || kind === 'user') return time
  }
  return toMs(session?.header?.createdAt)
}

/** 本轮开始时间：向前找最近的 turn/start。 */
function turnStartTime(session, endSeq) {
  const event = findLastEvent(session, endSeq, 'turn/start')
  return toMs(event?.time)
}

/**
 * 本次连续活动的起点：从末尾向前走，遇到相邻事件间隔超过 gapMs 就停。
 * 用于 session 计时方式，避免把「昨晚的会话」一直算进今天这一轮。
 */
function burstStartTime(session, endSeq, gapMs) {
  const total = typeof session?.seq === 'number' ? session.seq : 0
  const last = Math.min(typeof endSeq === 'number' ? endSeq : total, total)
  let previous = 0
  let start = 0
  for (let i = last - 1; i >= 0; i--) {
    let event
    try {
      event = session.eventAt(i)
    } catch {
      continue
    }
    const time = toMs(event?.time)
    if (!time) continue
    if (previous && previous - time > gapMs) break
    previous = time
    start = time
  }
  return start
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

function timeText(date) {
  try {
    return date.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return date.toISOString()
  }
}

function shortId(id) {
  // 会话 id 形如 session-<uuid>；去掉前缀再截断，日志里才看得出是哪条会话。
  const text = String(id ?? '').replace(/^session-/, '')
  return text.length > 8 ? text.slice(0, 8) : text
}

function logPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'session-push', 'session-push.log')
}

function rotateIfNeeded(file) {
  try {
    if (statSync(file).size < LOG_MAX_BYTES) return
    renameSync(file, `${file}.1`)
  } catch {
    // 文件不存在或轮转失败都不影响日志写入。
  }
}

const STATE_MAX_ENTRIES = 200
const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function statePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'session-push', 'state.json')
}

/** 读取去重记录（key -> 推送完成时间）。文件损坏时按空记录处理。 */
function loadState(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const notified = raw && typeof raw === 'object' && raw.notified && typeof raw.notified === 'object' ? raw.notified : {}
    const entries = Object.entries(notified).filter(([, at]) => typeof at === 'number' && Number.isFinite(at))
    return new Map(entries)
  } catch {
    return new Map()
  }
}

/** 写入去重记录，顺带清理过期与超量的条目。 */
function saveState(file, notified, log) {
  try {
    const now = Date.now()
    let entries = [...notified.entries()].filter(([, at]) => now - at < STATE_MAX_AGE_MS)
    entries.sort((a, b) => a[1] - b[1])
    if (entries.length > STATE_MAX_ENTRIES) entries = entries.slice(entries.length - STATE_MAX_ENTRIES)
    notified.clear()
    for (const [key, at] of entries) notified.set(key, at)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ version: 1, notified: Object.fromEntries(entries) }, null, 2)}\n`)
  } catch (error) {
    log(`写入去重状态失败：${String(error)}`)
  }
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...unwrapConfig(config) }
  const file = logPath()
  const log = (message) => {
    try {
      mkdirSync(join(file, '..'), { recursive: true })
      rotateIfNeeded(file)
      appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`)
    } catch {
      // 日志失败绝不打断会话。
    }
  }
  const debug = (message) => {
    if (cfg.debugLog) log(message)
  }

  // 设置页修改后即时生效。
  ctx.inject(['settings'], (settingsCtx) => {
    const sync = (current) => {
      if (!current || typeof current !== 'object') return
      Object.assign(cfg, unwrapConfig(current))
    }
    const applyDocument = () => {
      try {
        const desc = settingsCtx.settings.describe().find((item) => item.ns === 'session-push')
        sync(desc?.value)
      } catch (error) {
        debug(`读取设置失败：${String(error)}`)
      }
    }
    applyDocument()
    settingsCtx.on('settings/document-updated', (ns) => {
      if (ns !== 'session-push') return
      applyDocument()
      log('设置已更新（即时生效）')
    })
  })

  const stateFile = statePath()
  const notified = loadState(stateFile)
  let queue = Promise.resolve()

  const schedule = (sessionId, task) => {
    queue = queue.then(task).catch((error) => log(`推送流程异常：${String(error)}`))
  }

  // ---- 等待回应（ask_user_question 提问框 / 审批框）----
  const pending = new Map()
  const hasChannel = () => Boolean(cfg.barkEnabled || cfg.serverChanEnabled || cfg.webhookEnabled)
  const questionWaitMs = () => Math.max(500, (Number(cfg.questionTimeoutMinutes) || 2) * 60000)

  const clearPending = (key) => {
    const item = pending.get(key)
    if (!item) return
    try {
      clearTimeout(item.timer)
    } catch {
      // 已经触发过就无需再取消。
    }
    pending.delete(key)
  }

  const clearSessionPending = (sessionId) => {
    for (const key of [...pending.keys()]) {
      if (pending.get(key)?.sessionId === sessionId) clearPending(key)
    }
  }

  const pushPending = (key) => {
    const item = pending.get(key)
    if (!item) return
    pending.delete(key)
    if (!hasChannel()) {
      debug(`跳过等待回应推送：没有启用的通道（会话 ${shortId(item.sessionId)}）`)
      return
    }
    const payload = {
      title: String(cfg.questionTitle || 'DSH等待回应中'),
      content: truncateText(item.content, cfg.maxChars),
      sessionId: item.sessionId,
      sessionTitle: '',
      minutes: Math.max(1, Math.round(questionWaitMs() / 60000)),
      timeText: timeText(new Date()),
    }
    schedule(item.sessionId, async () => {
      let outcome
      try {
        outcome = await sendAll(cfg, payload)
      } catch (error) {
        log(`等待回应推送异常（会话 ${shortId(item.sessionId)}）：${String(error)}`)
        return
      }
      const summary = outcome.results.map((row) => `${row.channel}:${row.ok ? 'ok' : 'fail'}`).join(', ')
      if (!outcome.ok) {
        log(
          `等待回应推送失败（会话 ${shortId(item.sessionId)}，${item.kind}，${summary}）：${outcome.results
            .map((row) => row.detail)
            .join(' | ')}`,
        )
        return
      }
      log(`已推送等待回应（会话 ${shortId(item.sessionId)}，${item.kind}，${summary}）`)
    })
  }

  const startPending = (key, sessionId, kind, text) => {
    if (pending.has(key)) return
    if (!hasChannel()) {
      debug(`未配置推送通道，不启动等待回应计时（${kind}，会话 ${shortId(sessionId)}）`)
      return
    }
    if (!text) return
    const timer = setTimeout(() => {
      try {
        pushPending(key)
      } catch (error) {
        log(`等待回应计时器异常：${String(error)}`)
      }
    }, questionWaitMs())
    timer.unref?.()
    pending.set(key, { timer, sessionId, kind, content: text })
    debug(`开始等待回应计时（${kind}，${cfg.questionTimeoutMinutes} 分钟，会话 ${shortId(sessionId)}）`)
  }

  const handleDialogEvent = (session, event, sessionId) => {
    const type = event?.type
    if (type === 'tool/call') {
      if (!cfg.notifyOnQuestion) return
      if (String(event?.data?.name ?? '') !== 'ask_user_question') return
      const callId = String(event?.data?.callId ?? '')
      if (!callId) return
      const args = parseToolArguments(event?.data?.arguments)
      const questions = Array.isArray(args?.questions) ? args.questions : []
      const text = questionText(questions, cfg.questionIncludeOptions) || 'DSH 正在等待你在选择框中做出选择。'
      startPending(`q:${sessionId}:${callId}`, sessionId, '提问', text)
      return
    }
    if (type === 'tool/result') {
      // tool/result 的 callId 在 data.message.source.callId（见 dsh-session 的 pendingCalls 处理）。
      const callId = String(event?.data?.callId ?? event?.data?.message?.source?.callId ?? '')
      if (!callId) return
      const key = `q:${sessionId}:${callId}`
      if (!pending.has(key)) return
      // 定时模式会先返回 pending（问题仍可回答），此时继续等待，直到用户真正回答。
      const text = String(messageText(event?.data?.message) || JSON.stringify(event?.data ?? ''))
      if (/"pending"\s*:\s*true/.test(text)) return
      clearPending(key)
      return
    }
    if (type === 'approval/asked') {
      if (!cfg.notifyOnQuestion) return
      const id = String(event?.data?.id ?? '')
      if (!id) return
      const data = event?.data ?? {}
      const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
      const toolName = typeof data.toolName === 'string' ? data.toolName.trim() : ''
      const text = reason || (toolName ? `工具 ${toolName} 正在请求你的批准。` : 'DSH 正在等待你批准一个操作。')
      startPending(`a:${sessionId}:${id}`, sessionId, '审批', text)
      return
    }
    if (type === 'approval/decided') {
      const id = String(event?.data?.id ?? '')
      if (id) clearPending(`a:${sessionId}:${id}`)
      return
    }
    if (type === 'user/message') {
      // 用户回答了「已超时但仍可回答」的问题。
      if (event?.data?.source?.kind !== 'answer_to_pending_question') return
      const callId = String(event?.data?.source?.callId ?? '')
      if (callId && pending.has(`q:${sessionId}:${callId}`)) clearPending(`q:${sessionId}:${callId}`)
      else clearSessionPending(sessionId)
    }
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (!cfg.enabled) return
      if (session?.header?.origin === 'subagent' && !cfg.notifySubagents) return

      const sessionId = String(session?.id ?? session?.header?.id ?? '')
      if (!sessionId) return

      // 等待回应的计时器与「会话结束推送」互不影响。
      if (event?.type !== 'turn/end') {
        handleDialogEvent(session, event, sessionId)
        return
      }
      clearSessionPending(sessionId)

      const turn = Number(event?.data?.turn)
      // 去重按「会话 + 轮次」：重启/重装后同一轮不会重复推送，新一轮仍可正常推送。
      const dedupeKey = Number.isFinite(turn) ? `${sessionId}#${turn}` : `${sessionId}#${event?.seq ?? 'end'}`
      if (cfg.oncePerSession && notified.has(dedupeKey)) return

      const kind = event?.data?.reason?.kind ?? 'completed'
      const allowed = cfg.notifyOnError ? COMPLETED_KINDS : new Set(['completed'])
      if (!allowed.has(kind)) {
        debug(`跳过结束原因 ${kind}（会话 ${sessionId}）`)
        return
      }

      const endSeq = typeof event.seq === 'number' ? event.seq : session?.seq
      const endTime = toMs(event.time) || Date.now()
      const gapMs = Math.max(60000, (Number(cfg.idleGapMinutes) || DEFAULTS.idleGapMinutes) * 60000)
      let startTime = 0
      let startSource = ''
      if (cfg.durationMode === 'turn') {
        startTime = turnStartTime(session, endSeq)
        startSource = 'turn/start'
        if (!startTime) {
          startTime = burstStartTime(session, endSeq, gapMs)
          startSource = '连续活动段'
        }
      } else {
        startTime = burstStartTime(session, endSeq, gapMs)
        startSource = '连续活动段'
      }
      if (!startTime) {
        startTime = sessionStartTime(session, endSeq)
        startSource = '会话开始'
      }
      const startedAt = startTime || toMs(session?.header?.createdAt) || endTime
      const durationMs = Math.max(0, endTime - startedAt)
      const minutes = Math.round(durationMs / 60000)
      const thresholdMs = Math.max(0, Number(cfg.minMinutes) || 0) * 60000

      if (durationMs < thresholdMs) {
        debug(
          `跳过：${startSource}计时 ${formatDuration(durationMs)} 未达到阈值 ${cfg.minMinutes} 分钟（会话 ${sessionId}，第 ${turn ?? '?'} 轮）`,
        )
        return
      }

      const opening = truncateText(firstUserText(session), cfg.maxChars)
      if (!opening) {
        debug(`跳过：会话开头没有可推送的文本（会话 ${sessionId}）`)
        return
      }

      const sessionTitle = sessionTitleText(session, endSeq)
      const endedAt = new Date(endTime)
      const meta = cfg.includeMeta
        ? `\n\n——\n时长：${formatDuration(durationMs)}｜会话：${sessionTitle || shortId(sessionId)}｜完成于：${timeText(endedAt)}`
        : ''
      const payload = {
        title: String(cfg.title || 'DSH会话已完成'),
        content: `${opening}${meta}`,
        sessionId,
        sessionTitle,
        minutes,
        timeText: timeText(endedAt),
      }

      if (!cfg.barkEnabled && !cfg.serverChanEnabled && !cfg.webhookEnabled) {
        debug('跳过：没有任何已启用的推送通道')
        return
      }

      if (cfg.oncePerSession) {
        notified.set(dedupeKey, Date.now())
        saveState(stateFile, notified, log)
      }

      schedule(sessionId, async () => {
        let outcome
        try {
          outcome = await sendAll(cfg, payload)
        } catch (error) {
          if (cfg.oncePerSession) {
            notified.delete(dedupeKey)
            saveState(stateFile, notified, log)
          }
          log(`推送异常（会话 ${sessionId}，第 ${turn ?? '?'} 轮）：${String(error)}`)
          return
        }
        const summary = outcome.results.map((item) => `${item.channel}:${item.ok ? 'ok' : 'fail'}`).join(', ')
        if (!outcome.ok) {
          // 全部失败：释放去重记录，下次结束时仍会重试。
          if (cfg.oncePerSession) {
            notified.delete(dedupeKey)
            saveState(stateFile, notified, log)
          }
          log(
            `推送失败（会话 ${sessionId}，第 ${turn ?? '?'} 轮，${summary}）：${outcome.results
              .map((item) => item.detail)
              .join(' | ')}`,
          )
          return
        }
        log(
          `已推送（会话 ${sessionId}，第 ${turn ?? '?'} 轮，${startSource}计时 ${formatDuration(durationMs)}，${summary}）`,
        )
      })
    } catch (error) {
      log(`处理 session/event 失败：${String(error)}`)
    }
  })

  const channels = [
    cfg.barkEnabled ? `Bark(${cfg.barkKey ? 'Key 已配置' : 'Key 未配置'})` : '',
    cfg.serverChanEnabled ? `Server酱(${cfg.serverChanSendKey ? 'SendKey 已配置' : 'SendKey 未配置'})` : '',
    cfg.webhookEnabled ? `Webhook(${cfg.webhookUrl ? '地址已配置' : '地址未配置'})` : '',
  ].filter(Boolean)
  log(
    `已启动：阈值 ${cfg.minMinutes} 分钟，计时方式 ${
      cfg.durationMode === 'turn' ? '本轮任务' : `连续活动段（空闲 ${cfg.idleGapMinutes} 分钟即重新计时）`
    }，等待回应 ${
      cfg.notifyOnQuestion ? `${cfg.questionTimeoutMinutes} 分钟` : '未启用'
    }，通道 ${
      channels.length > 0 ? channels.join(' / ') : '未启用（请在设置中配置 Bark / Server酱 / Webhook）'
    }`,
  )
  ctx.logger?.info?.('session-push 已启动：会话结束且时长达到阈值时推送开头内容，弹框等待超时推送问题')
}
