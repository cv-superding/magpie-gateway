# magpie-gateway

![magpie-gateway banner](docs/assets/banner-magpie-gateway.png)

<img src="https://img.shields.io/badge/license-MIT-blue" alt="license"> <img src="https://img.shields.io/badge/magpie-plugin-brightgreen" alt="magpie"> <img src="https://img.shields.io/badge/provider-mgw-purple" alt="provider"> <img src="https://img.shields.io/badge/node-%3E%3D22-grey" alt="node"> <img src="https://img.shields.io/badge/PRs-welcome-orange" alt="PRs">

<img src="docs/assets/icon-magpie-gateway.png" alt="magpie-gateway icon" width="96" align="right">


一个把 **OpenAI 兼容网关**桥接成 magpie provider `mgw` 的插件。

这个插件只做一件事：让 magpie 里的所有 agent 能用网关里的模型。它**没有管理页面**，不碰 SSH，不管服务器——那些事在配套的 [qoder-ssh](https://github.com/cv-superding/magpie-qoder-ssh) 插件里。

## 它解决什么问题

magpie 默认只认识各家官方 provider。如果你自己跑着一个 OpenAI 兼容网关（比如 `127.0.0.1:3425`，里面聚合了多个上游模型），需要一种方式把它接进来。这个插件就是那座桥：

- 注册 provider `mgw`，API 指向网关的 `/v1`
- 从网关 `GET /v1/models` **实时拉取模型列表**，不用手工维护
- 把网关的模型能力翻译成 magpie 能懂的形状

## 模型能力映射

网关 `/v1/models` 里的字段会被转换：

| 网关字段 | magpie 字段 | 说明 |
|---|---|---|
| `id` | 模型 id | |
| `display_name` / `name` | 显示名 | |
| `context_window` / `context_length` | `limit.context` | 上下文长度 |
| `max_output_tokens` | `limit.output` | 最大输出 |
| `reasoning_levels` | `variants` + `capabilities.reasoning` | 思考档位（`none` 会被过滤） |
| `supported_reasoning_levels[].effort` | 同上（备用来源） | |
| `tool_call` | `capabilities.toolcall` | 工具调用 |
| `modalities.input` | 视觉 / 视频 / PDF 能力 | |

网关模型列表变了，刷新后自动同步。

## 安装

```bash
magpie plugin add /path/to/magpie-gateway
magpie plugin login mgw          # 填网关 key
magpie provider test mgw         # 验证
```

或者在 magpie 界面：Plugins → Add a plugin → 选本目录。

插件**没有任何 npm 依赖**，只用 Node/Bun 内置模块，按文件夹加载即可。

## 配置

优先级：`plugin options` > `环境变量` > `默认值`

```json
{
  "url": "http://<gateway-host>:3425",
  "key": "magpie"
}
```

| 配置项 | 环境变量 | 默认值 |
|---|---|---|
| `url` | `MAGPIE_GATEWAY_URL` | `http://127.0.0.1:3425` |
| `key` | `MAGPIE_GATEWAY_KEY` | `magpie` |

也可以用 CLI 设置 options：

```bash
magpie plugin options magpie-gateway '{"url":"http://<gateway-host>:3425","key":"magpie"}'
```

## 自环保护

如果 `url` **没有显式配置**，且解析出来就是本机自己的网关（`127.0.0.1` / `localhost` / `[::1]`，端口等于本机网关端口或 3425/3426），插件会**跳过 provider 注册**，日志打印：

```
magpie-gateway: gateway is this machine, provider not registered (avoids self-loop)
```

理由：把网关自己再包一层成 provider，只会多一次转发，没有意义。

显式配置了 `url`（指向另一台机器）时不受此限制——这正是典型用法：在 NAS 上装这个插件，`url` 指向另一台常开机器上的网关。

## 与 qoder-ssh 的关系

| | magpie-gateway | qoder-ssh |
|---|---|---|
| provider `mgw` | ✅ | ❌ |
| SSH 服务器管理 | ❌ | ✅ |
| 连通性检测 | ❌ | ✅ |
| 一键配置 qoderclicn | ❌ | ✅ |
| ssh -R 隧道 | ❌ | ✅ |

两个插件互相独立，可以只装其中一个。

## 开发

```bash
node --check index.mjs
```

发布打包（magpie 自带的 bun）：

```bash
magpie-bun pm pack
```

## License

MIT
