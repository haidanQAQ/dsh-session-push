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

const sandbox = {
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        calls.push('load:' + id)
        exportsRef = factory((spec) => {
          if (spec === 'react') return { createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {} }
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
const tab = registrations.find((r) => r.options.name === 'settings.plugins.tab')
assert(tab !== undefined, '注册了 settings.plugins.tab')
assert(tab.options.id === 'session-push', 'tab id = session-push')
assert(typeof tab.options.order === 'number', 'tab order 是数字')
assert(typeof tab.component === 'function', 'tab 组件是函数')
const injected = tab.options.inject()
assert(injected.form === fakeForm, 'inject() 传入 form 控制器')
assert(tab.options.label() === 't:tab', '标签走 locale')
console.log('ALL PASS (' + calls.length + ' calls)')
