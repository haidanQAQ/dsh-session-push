import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { firstUserText, truncateText, messageText, questionText } from '../lib/content.js'
import { pushBark, pushServerChan, pushWebhook } from '../lib/senders.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-session-push-test-'))
process.env.DSH_HOME = home

let failures = 0
function check(name, condition, extra) {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` → ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`}`)
  }
}

const requests = []
let failNext = 0

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json; charset=utf-8')
    if (failNext > 0) {
      failNext -= 1
      res.statusCode = 500
      res.end('{"code":500,"message":"boom"}')
      return
    }
    if (req.url.startsWith('/push')) {
      res.end('{"code":200,"message":"success"}')
      return
    }
    if (req.url.includes('.send')) {
      res.end('{"code":0,"message":"ok"}')
      return
    }
    res.end('{"ok":true}')
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const content = (event) => event.data
function makeSession(id, startMs, endMs, options = {}) {
  const opening = options.opening ?? '帮我做一个插件：会话超过 10 分钟结束时推送开头内容'
  const events = [
    {
      type: 'user/message',
      seq: 0,
      time: startMs - 800,
      data: { role: 'user', content: [{ type: 'text', text: 'runtime context injected by harness' }], source: { kind: 'runtime' } },
    },
    {
      type: 'user/message',
      seq: 1,
      time: startMs,
      data: { role: 'user', content: [{ type: 'text', text: opening }], source: { kind: 'user' } },
    },
    { type: 'turn/start', seq: 2, time: startMs + 1000, data: { turn: 1 } },
    { type: 'turn/end', seq: 3, time: endMs, data: { turn: 1, reason: { kind: options.kind ?? 'completed' } } },
  ]
  return {
    id,
    header: { id, createdAt: startMs, origin: options.origin ?? 'session' },
    seq: events.length,
    eventAt: (index) => events[index],
    events,
  }
}

function makeCtx() {
  const handlers = []
  return {
    handlers,
    inject(_names, callback) {
      callback({ settings: { describe: () => [] }, on() {} })
    },
    on(type, handler) {
      handlers.push([type, handler])
    },
    logger: { info() {} },
  }
}

function fire(ctx, session, eventIndex = 3) {
  const event = session.events[eventIndex]
  for (const [type, handler] of ctx.handlers) {
    if (type === 'session/event') handler(session, event)
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 150))

// ---- 内容提取 ----
console.log('content')
check('messageText 拼接 text 块', messageText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }) === 'a\n[附件]\nb')
check('truncateText 按字符截断', truncateText('一二三四五', 3) === '一二…', truncateText('一二三四五', 3))
check('truncateText 不截断', truncateText('短文本', 10) === '短文本')
const sampleSession = makeSession('s-content', Date.now() - 60000, Date.now())
check('firstUserText 跳过运行时注入', firstUserText(sampleSession) === '帮我做一个插件：会话超过 10 分钟结束时推送开头内容', firstUserText(sampleSession))

const injectedFirst = {
  id: 's-inject',
  header: { id: 's-inject', createdAt: Date.now(), origin: 'session' },
  seq: 2,
  eventAt: (index) =>
    [
      { type: 'user/message', seq: 0, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '<hindsight_pages> memory' }], source: { kind: 'user' } } },
      { type: 'user/message', seq: 1, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '真正的开头' }], source: { kind: 'user' } } },
    ][index],
}
check('firstUserText 跳过注入片段', firstUserText(injectedFirst) === '真正的开头', firstUserText(injectedFirst))

// ---- 通道 ----
console.log('bark')
await pushBark(
  { barkServer: base, barkKey: 'KEY123', barkGroup: 'g1', barkSound: 'bell', barkLevel: 'timeSensitive', timeoutSeconds: 5 },
  { title: '会话已完成', content: '正文' },
)
let last = requests.at(-1)
const barkForm = new URLSearchParams(last.body)
check('bark 走 /push', last.url === '/push', last.url)
check('bark device_key', barkForm.get('device_key') === 'KEY123')
check('bark title/body', barkForm.get('title') === '会话已完成' && barkForm.get('body') === '正文')
check('bark group/sound/level', barkForm.get('group') === 'g1' && barkForm.get('sound') === 'bell' && barkForm.get('level') === 'timeSensitive')

console.log('serverchan')
await pushServerChan(
  { serverChanUrl: `${base}/sct/{sendkey}.send`, serverChanSendKey: 'SCTabc', timeoutSeconds: 5 },
  { title: '会话已完成', content: '正文' },
)
last = requests.at(-1)
const scForm = new URLSearchParams(last.body)
check('serverchan 替换 sendkey', last.url === '/sct/SCTabc.send', last.url)
check('serverchan title/desp', scForm.get('title') === '会话已完成' && scForm.get('desp') === '正文')

console.log('webhook')
await pushWebhook(
  { webhookUrl: `${base}/hook`, webhookMethod: 'POST', timeoutSeconds: 5 },
  { title: '会话已完成', content: '正文', sessionId: 'sid-1', sessionTitle: '标题', minutes: 12, timeText: '2026-01-01 00:00:00' },
)
last = requests.at(-1)
const hookBody = JSON.parse(last.body)
check('webhook 默认 JSON', hookBody.title === '会话已完成' && hookBody.content === '正文' && hookBody.minutes === 12)
check('webhook content-type', String(last.headers['content-type']).includes('application/json'))

await pushWebhook(
  {
    webhookUrl: `${base}/hook`,
    webhookMethod: 'GET',
    webhookBodyTemplate: `${base}/hook?kind=get`,
    timeoutSeconds: 5,
  },
  { title: 'T', content: 'C', sessionId: 'sid-2', sessionTitle: '', minutes: 5, timeText: 't' },
)
last = requests.at(-1)
check('webhook GET 模板', last.method === 'GET' && last.url === '/hook?kind=get', `${last.method} ${last.url}`)

const tricky = '带"引号"和\n换行的内容'
await pushWebhook(
  {
    webhookUrl: `${base}/hook`,
    webhookMethod: 'POST',
    webhookBodyTemplate: '{"msg":"{{title}}","txt":"{{content}}"}',
    webhookHeaders: '{"X-Test":"1"}',
    timeoutSeconds: 5,
  },
  { title: '会话"完成"', content: tricky, sessionId: 'sid-3', sessionTitle: '', minutes: 1, timeText: 't' },
)
last = requests.at(-1)
let templated
try {
  templated = JSON.parse(last.body)
} catch (error) {
  templated = { error: String(error) }
}
check('webhook 模板 JSON 可解析', templated.txt === tricky, templated)
check('webhook 自定义头', last.headers['x-test'] === '1')

// ---- 端到端：apply ----
console.log('apply')
const ctx = makeCtx()
apply(ctx, {
  minMinutes: 10,
  webhookEnabled: true,
  webhookUrl: `${base}/hook`,
  oncePerSession: true,
  includeMeta: true,
  maxChars: 200,
})
await tick()

const now = Date.now()
const longSession = makeSession('session-long', now - 25 * 60000, now)
const beforeCount = requests.length
fire(ctx, longSession)
await tick()
check('达到阈值触发推送', requests.length === beforeCount + 1, `${beforeCount} → ${requests.length}`)
last = requests.at(-1)
const pushed = JSON.parse(last.body)
check('标题为 DSH会话已完成', pushed.title === 'DSH会话已完成', pushed.title)
check('正文以会话开头开始', pushed.content.startsWith('帮我做一个插件'), pushed.content.slice(0, 40))
check('正文包含时长信息', pushed.content.includes('时长：25 分'), pushed.content.slice(-80))

fire(ctx, longSession)
await tick()
check('同一会话不重复推送', requests.length === beforeCount + 1, `${requests.length}`)

const shortSession = makeSession('session-short', now - 3 * 60000, now)
fire(ctx, shortSession)
await tick()
check('未达阈值不推送', requests.length === beforeCount + 1, `${requests.length}`)

const subSession = makeSession('session-sub', now - 30 * 60000, now, { origin: 'subagent' })
fire(ctx, subSession)
await tick()
check('子代理默认不推送', requests.length === beforeCount + 1, `${requests.length}`)

const errSession = makeSession('session-err', now - 15 * 60000, now, { kind: 'error' })
fire(ctx, errSession)
await tick()
check('错误结束也推送（默认开启）', requests.length === beforeCount + 2, `${requests.length}`)

const failCtx = makeCtx()
apply(failCtx, { minMinutes: 1, webhookEnabled: true, webhookUrl: `${base}/hook`, oncePerSession: true })
await tick()
failNext = 1
const retrySession = makeSession('session-retry', now - 5 * 60000, now)
const retryBefore = requests.length
fire(failCtx, retrySession)
await tick()
check('失败会发起请求', requests.length === retryBefore + 1, `${requests.length}`)
fire(failCtx, retrySession)
await tick()
check('失败后下轮重试', requests.length === retryBefore + 2, `${requests.length}`)

const longText = '很长'.repeat(500)
const limitCtx = makeCtx()
apply(limitCtx, { minMinutes: 1, webhookEnabled: true, webhookUrl: `${base}/hook`, maxChars: 50, includeMeta: false })
await tick()
const limitSession = makeSession('session-limit', now - 5 * 60000, now, { opening: longText })
fire(limitCtx, limitSession)
await tick()
const limited = JSON.parse(requests.at(-1).body)
check('maxChars 生效', Array.from(limited.content).length === 50, Array.from(limited.content).length)
check('截断带省略号', limited.content.endsWith('…'))

// ---- 等待回应 ----
console.log('question')
const sampleQuestions = [{ header: '确认', question: '要现在重启吗？', options: [{ label: '是' }, { label: '否' }] }]
check('questionText 拼接标题/问题/选项', questionText(sampleQuestions) === '【确认】要现在重启吗？\n· 是\n· 否', questionText(sampleQuestions))
check('questionText 可去掉选项', !questionText(sampleQuestions, false).includes('· 是'))
check('questionText 过滤空问题', questionText([{ question: '   ' }, { question: '保留' }]) === '保留')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dialogSession = (id, events) => ({
  id,
  header: { id, createdAt: Date.now(), origin: 'session' },
  seq: events.length,
  eventAt: (index) => events[index],
  events,
})
const callEvent = (callId, questions) => ({
  type: 'tool/call',
  time: Date.now(),
  data: { turn: 1, step: 1, callId, name: 'ask_user_question', arguments: JSON.stringify({ questions }) },
})
const resultEvent = (callId, value) => ({
  type: 'tool/result',
  time: Date.now(),
  data: {
    turn: 1,
    step: 1,
    message: { role: 'tool', source: { callId, toolName: 'ask_user_question' }, content: [{ type: 'text', text: JSON.stringify(value) }] },
  },
})
const approvalAsked = (id, reason) => ({ type: 'approval/asked', time: Date.now(), data: { id, toolName: 'pwsh', reason } })
const approvalDecided = (id, outcome) => ({ type: 'approval/decided', time: Date.now(), data: { id, outcome } })
const answerEvent = (callId) => ({
  type: 'user/message',
  time: Date.now(),
  data: { role: 'user', content: [{ type: 'text', text: '是' }], source: { kind: 'answer_to_pending_question', callId } },
})
const turnEndEvent = () => ({ type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })

const questionCtx = makeCtx()
apply(questionCtx, {
  questionTimeoutMinutes: 0.02,
  webhookEnabled: true,
  webhookUrl: `${base}/hook`,
  maxChars: 300,
})
await tick()

let dialogBefore = requests.length
const timeoutSession = dialogSession('dlg-timeout', [callEvent('c1', sampleQuestions)])
fire(questionCtx, timeoutSession, 0)
await wait(1700)
check('提问超时推送', requests.length === dialogBefore + 1, `${dialogBefore} → ${requests.length}`)
const questionPush = JSON.parse(requests.at(-1).body)
check('等待推送标题', questionPush.title === 'DSH等待回应中', questionPush.title)
check('等待推送正文含问题与选项', questionPush.content.includes('要现在重启吗？') && questionPush.content.includes('· 是'), questionPush.content.slice(0, 80))

dialogBefore = requests.length
const answeredSession = dialogSession('dlg-answered', [
  callEvent('c2', [{ question: '继续？' }]),
  resultEvent('c2', { answers: [{ id: 'q1', selected: ['是'] }] }),
])
fire(questionCtx, answeredSession, 0)
fire(questionCtx, answeredSession, 1)
await wait(1700)
check('及时回答不推送', requests.length === dialogBefore, `${dialogBefore} → ${requests.length}`)

dialogBefore = requests.length
const pendingSession = dialogSession('dlg-pending', [
  callEvent('c3', [{ question: '还在吗？' }]),
  resultEvent('c3', { pending: true, callId: 'c3', message: 'No answer batch arrived before the timeout.' }),
])
fire(questionCtx, pendingSession, 0)
fire(questionCtx, pendingSession, 1)
await wait(1700)
check('pending 结果仍会推送', requests.length === dialogBefore + 1, `${dialogBefore} → ${requests.length}`)

dialogBefore = requests.length
const lateAnswerSession = dialogSession('dlg-late', [
  callEvent('c4', [{ question: '选哪个？' }]),
  resultEvent('c4', { pending: true, callId: 'c4' }),
  answerEvent('c4'),
])
for (let i = 0; i < 3; i += 1) fire(questionCtx, lateAnswerSession, i)
await wait(1700)
check('事后回答取消等待推送', requests.length === dialogBefore, `${dialogBefore} → ${requests.length}`)

dialogBefore = requests.length
const approvalSession = dialogSession('dlg-approval', [approvalAsked('ap-1', '允许执行 pwsh 命令？')])
fire(questionCtx, approvalSession, 0)
await wait(1700)
check('审批超时推送', requests.length === dialogBefore + 1, `${dialogBefore} → ${requests.length}`)
check('审批正文取说明', JSON.parse(requests.at(-1).body).content.includes('允许执行 pwsh 命令？'), JSON.parse(requests.at(-1).body).content)

dialogBefore = requests.length
const decidedSession = dialogSession('dlg-approval-ok', [
  approvalAsked('ap-2', '允许写文件？'),
  approvalDecided('ap-2', 'allowed-once'),
])
fire(questionCtx, decidedSession, 0)
fire(questionCtx, decidedSession, 1)
await wait(1700)
check('已审批不推送', requests.length === dialogBefore, `${dialogBefore} → ${requests.length}`)

dialogBefore = requests.length
const turnedSession = dialogSession('dlg-turnend', [callEvent('c7', [{ question: '要结束吗？' }]), turnEndEvent()])
fire(questionCtx, turnedSession, 0)
fire(questionCtx, turnedSession, 1)
await wait(1700)
check('本轮结束取消等待推送', requests.length === dialogBefore, `${dialogBefore} → ${requests.length}`)

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
