// magpie-gateway — magpie 插件
//
// 只做一件事：把一个 OpenAI 兼容网关桥接成 magpie 的 provider `mgw`。
// 管理 / 检测 / 部署 / 隧道这些 SSH 相关的事已拆到 qoder-ssh 插件。
//
// 页面 sandbox 是 connect-src 'none'，不能发网络请求；这里提供的是一个纯
// provider 插件（没有页面），网关地址与 key 通过 plugin options 或环境变量配置。
//
// 配置优先级：plugin options > 环境变量 > 默认值
//   options: {"url":"http://<gateway-host>:3425","key":"magpie"}
//   env:     MAGPIE_GATEWAY_URL / MAGPIE_GATEWAY_KEY

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PROVIDER = "mgw"
const SELF_NAME = "magpie-gateway"
const ENV_BASE = process.env.MAGPIE_GATEWAY_URL || "http://127.0.0.1:3425"
const ENV_KEY = process.env.MAGPIE_GATEWAY_KEY || "magpie"

function stripSlash(u) {
  return String(u || "").replace(/\/+$/, "")
}

// 网关 /v1/models → magpie 的模型形状：上下文、输出、思考档位、工具、视觉
function modelShape(m) {
  const id = m.id
  const context = Number(m.context_window || m.context_length || 1000000)
  const output = Number(m.max_output_tokens || 32000)
  let levels = Array.isArray(m.reasoning_levels)
    ? m.reasoning_levels
    : (m.supported_reasoning_levels || []).map((x) => x && x.effort).filter(Boolean)
  levels = levels.filter((lv) => String(lv).toLowerCase() !== "none")
  const inputs = (m.modalities && m.modalities.input) || []
  const variants = {}
  for (const lv of levels) variants[String(lv)] = {}

  return {
    id,
    name: m.display_name || m.name || id,
    limit: { context, output },
    capabilities: {
      reasoning: levels.length > 0,
      toolcall: !!m.tool_call,
      input: {
        text: true,
        image: inputs.includes("image"),
        video: inputs.includes("video"),
        pdf: inputs.includes("pdf"),
      },
    },
    ...(levels.length ? { variants } : {}),
  }
}

function magpieConfigDir() {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "magpie")
    : join(homedir(), ".config", "magpie")
}

// 读本插件在 plugins.json 里的 options
function readOwnOptions() {
  const p = join(magpieConfigDir(), "plugins.json")
  if (!existsSync(p)) return {}
  try {
    const d = JSON.parse(readFileSync(p, "utf8"))
    const e = (d.plugins || []).find(
      (x) => typeof x.spec === "string" && x.spec.startsWith(SELF_NAME)
    )
    return (e && e.options) || {}
  } catch {
    return {}
  }
}

// 本机网关端口：从 gateway.json 的 addr 里取，取不到返回 0
function localGatewayPort() {
  try {
    const p = join(magpieConfigDir(), "gateway.json")
    if (existsSync(p)) {
      const d = JSON.parse(readFileSync(p, "utf8"))
      const m = String(d && d.addr ? d.addr : "").match(/:(\d+)\s*$/)
      if (m) return Number(m[1])
    }
  } catch {}
  return 0
}

// 是否指向本机自己（自己包自己没有意义，还多一跳）
function isSelfGateway(url) {
  const u = String(url || "").replace(/\/+$/, "")
  const m = u.match(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/)
  if (!m) return false
  const port = Number(m[2])
  const own = localGatewayPort()
  return port === own || port === 3425 || port === 3426
}

export const MagpieGateway = async (_ctx, options = {}) => {
  const explicitUrl = options && options.url
  const DEFAULT_BASE = stripSlash(explicitUrl || ENV_BASE) || "http://127.0.0.1:3425"
  const DEFAULT_KEY = (options && options.key) || ENV_KEY

  // 没显式配置 url、且默认地址就是本机网关 → 不注册 provider
  if (!explicitUrl && isSelfGateway(DEFAULT_BASE)) {
    console.log("magpie-gateway: gateway is this machine, provider not registered (avoids self-loop)")
    return {}
  }

  const config = async (cfg) => {
    cfg.provider ??= {}
    if (!cfg.provider[PROVIDER]) {
      cfg.provider[PROVIDER] = {
        name: "Magpie Gateway",
        npm: "@ai-sdk/openai-compatible",
        api: stripSlash(DEFAULT_BASE) + "/v1",
        models: {},
      }
    }
    return cfg
  }

  const auth = {
    provider: PROVIDER,
    methods: [{ type: "api", label: "Magpie gateway key", placeholder: DEFAULT_KEY }],
    async loader(getAuth) {
      const a = await getAuth()
      const key = (a && (a.key || a.apiKey)) || DEFAULT_KEY
      const base = stripSlash(DEFAULT_BASE)
      return {
        baseURL: base + "/v1",
        async fetch(input, init) {
          const headers = new Headers(init && init.headers ? init.headers : {})
          if (!headers.has("authorization")) {
            headers.set("authorization", `Bearer ${key}`)
          }
          headers.set("x-magpie-gateway", "1.0.0")
          return fetch(input, { ...(init || {}), headers })
        },
      }
    },
  }

  const provider = {
    id: PROVIDER,
    async models(provider, { auth: accountAuth } = {}) {
      const base = stripSlash(DEFAULT_BASE)
      const key = (accountAuth && (accountAuth.key || accountAuth.apiKey)) || DEFAULT_KEY
      try {
        const res = await fetch(base + "/v1/models", {
          headers: { authorization: `Bearer ${key}` },
        })
        if (!res.ok) return provider.models
        const data = await res.json()
        const list = Array.isArray(data && data.data) ? data.data : []
        if (!list.length) return provider.models
        const out = {}
        for (const m of list) {
          if (!m || !m.id) continue
          out[m.id] = modelShape(m)
        }
        return out
      } catch {
        return provider.models
      }
    },
  }

  return { config, auth, provider }
}
