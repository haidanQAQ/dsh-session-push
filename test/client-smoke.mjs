// 冒烟测试：在 Node 里跑一遍 lib/client.js 的模块外壳与 apply()，
// 不渲染组件（需要真实 React），只验证导出、槽位注册与默认值读取路径。
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const file = process.argv[2]
const source = readFileSync(file, 'utf8')

let exportsRef
const registrations = []
const calls = []

const fakeForm = {
  getSnapshot: () => ({ status: 'ready', value: { enabled: true, minMinutes: 10 }, user: undefined, writable: true }),
  subscribe: (cb) => {
    calls.push('form.subscribe')
    return () => {}
  },
  set: (k, v) => {
    calls.push('form.set:' + k)
    return Promise.resolve(true)
  },
  unset: (k) => {
    calls.push('form.unset:' + k)
    return Promise.resolve(true)
  },
}

function makeCtx() {
  return {
    effect: (fn, label) => {
      calls.push('effect:' + label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      bind: () => (key) => 't:' + key,
      register: (ns, dict) => {
        calls.push('locale.register:' + ns)
        return () => {}
      },
    },
    configForms: {
      get: (ns) => {
        calls.push('configForms.get:' + ns)
        return fakeForm
      },
    },
    slots: {
      inject: (name, fn) => {
        calls.push('slots.inject:' + name)
        return fn()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
}

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(99) }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

const sandbox = {
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        calls.push('load:' + id)
        exportsRef = factory((spec) => {
          if (spec === 'react') return fakeReact
          throw new Error('unexpected require: ' + spec)
        })
      },
    },
  },
  console,
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: file })

const assert = (cond, message) => {
  if (!cond) throw new Error('FAIL: ' + message)
  console.log('ok - ' + message)
}

assert(exportsRef && typeof exportsRef.apply === 'function', 'exports.apply 存在')
assert(exportsRef.name === 'dsh-session-push', 'exports.name 正确')
assert(Array.isArray(exportsRef.inject) && exportsRef.inject.includes('slots'), 'exports.inject 含 slots/configForms/locale')

exportsRef.apply(makeCtx())

assert(calls.some((c) => c === 'locale.register:session-push'), '注册了 locale 字典')
assert(calls.some((c) => c === 'configForms.get:session-push'), '经 configForms 读取 session-push 命名空间')
const section = registrations.find((r) => r.options.name === 'settings.section')
assert(section !== undefined, '注册了 settings.section（主导航设置页）')
assert(section.options.id === 'session-push', 'section id = session-push')
assert(typeof section.options.order === 'number', 'section order 是数字')
assert(typeof section.component === 'function', 'section 组件是函数')
assert(section.options.inject().form === fakeForm, 'section inject() 传入 form 控制器')
assert(section.options.label() === 't:tab', 'section 标签走 locale')
const tab = registrations.find((r) => r.options.name === 'settings.plugins.tab')
assert(tab !== undefined, '注册了 settings.plugins.tab')
assert(tab.options.id === 'session-push', 'tab id = session-push')
assert(typeof tab.options.order === 'number', 'tab order 是数字')
assert(typeof tab.component === 'function', 'tab 组件是函数')
const injected = tab.options.inject()
assert(injected.form === fakeForm, 'inject() 传入 form 控制器')
assert(tab.options.label() === 't:tab', '标签走 locale')

// 真正渲染一次组件：模块里的 t / 样式 / 字段定义只要有一处引用错，这里就会抛错。
for (const entry of [section, tab]) {
  const tree = entry.component(entry.options.inject())
  const text = JSON.stringify(tree)
  assert(tree && typeof tree === 'object', entry.options.name + ' 组件可渲染')
  assert(text.includes('t:title'), entry.options.name + ' 标题走 locale')
  assert(text.includes('t:sectionBark'), entry.options.name + ' 含 Bark 分组')
  assert(text.includes('barkKey'), entry.options.name + ' 含 barkKey 字段')
}
console.log('ALL PASS (' + calls.length + ' calls)')
