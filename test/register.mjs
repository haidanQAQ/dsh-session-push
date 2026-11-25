// 测试专用的模块解析钩子：把插件源码里的 `@deepseek-ai/schemastery`
// 指向 test/fixtures/schemastery.mjs，使测试不依赖宿主安装的包。
import { registerHooks } from 'node:module'

const stub = new URL('./fixtures/schemastery.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: stub, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
