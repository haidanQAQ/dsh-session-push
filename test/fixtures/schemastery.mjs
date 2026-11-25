// 仅用于本地测试的 schemastery 替身：提供插件用到的链式 API，不做任何校验。
// 测试通过 test/register.mjs 把 `@deepseek-ai/schemastery` 解析到这里，
// 这样仓库无需依赖宿主（DSH）自带的真实实现即可跑测试。
class Type {
  constructor(kind, args) {
    this.kind = kind
    this.args = args
    this.meta = {}
  }

  default(value) {
    this.meta.default = value
    return this
  }

  volatile() {
    this.meta.volatile = true
    return this
  }

  description(text) {
    this.meta.description = text
    return this
  }

  role(name) {
    this.meta.role = name
    return this
  }

  min(value) {
    this.meta.min = value
    return this
  }

  max(value) {
    this.meta.max = value
    return this
  }

  required() {
    this.meta.required = true
    return this
  }

  hidden() {
    return this
  }
}

const factory = (kind) => (...args) => new Type(kind, args)

export default {
  object: factory('object'),
  boolean: factory('boolean'),
  number: factory('number'),
  string: factory('string'),
  union: factory('union'),
  array: factory('array'),
}
