// T8 单测夹具：导出 activate() 的合法第三方插件入口
/** @param {{a: number, b: number}} n */
async function add(n) {
  return { sum: n.a + n.b }
}

export function activate() {
  return { 'third.add': add }
}
