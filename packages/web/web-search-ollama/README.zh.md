# @deepseek-ai/dsh-web-search-ollama

[English](README.md) | 中文

基于 [Ollama](https://ollama.com) 的 `WebSearchProvider`，挂载到 harness 的[网络能力接缝](../web/README.zh.md)（`ctx.web`）。它调用 Ollama web search API（`POST https://ollama.com/api/web_search`，Bearer 认证），并把 `{ results: [{ url, title, content }] }` 响应体映射为接缝归一化的 `WebSearchResult`。

这是一个**实现**包：向 `ctx.web` 注册 provider，每次搜索通过可选的 `ctx.credentials` 接缝解析凭据，拥有一个 Settings 命名空间（`web-search-ollama`，含启用开关与可选代理），不注册面向模型的工具。与 `@deepseek-ai/dsh-web-search-deepseek` 一样，它是函数/命名空间插件（`inject: ['web']`）。

## 安装（Installation）

合入上游后为 in-box：`dsh-base` 已携带 `web-search-ollama` 行，所有 web profile 默认挂载——无需安装。

树外（发布前或第三方 profile）：本包声明了 bundle（`dsh.bundle` → `cordis.patch.yml`），一条命令即可装入任意 profile：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-web-search-ollama     # npm (after publish)
dsh plugin --profile web add ./dsh-web-search-ollama-<version>.tgz  # tarball (pnpm pack)
```

`dsh plugin` 自动把该包追加进 profile 的 `dsh.profile.bundles` 层栈；移除依赖即自动出栈。随包的 patch 是 id 定向 **upsert** 而非 insert：base 已有该行时是无害 no-op（同一 id 出现在两层 = upsert）；base 没有该行时告警并跳过，而不是挂载一个本就无法激活的行。

**要求 dsh 发布版本包含 seam API** —— `ctx.web.setSearchProviderId` / `getSearchProviderId` 不在已发布的 0.1.1-rc.2 中，随本包所属的上游 PR 一起落地。在 stock dsh 上挂载该行（例如手动 insert 进 profile patch）会以 `TypeError` 激活失败；dsh 其余功能不受影响。

git 托管安装（`dsh plugin add github:user/repo`）不是本包的可行渠道：pnpm git 依赖没有子目录语法，且本 monorepo 根是 private、只能在 workspace 内构建——若要走 git，需要独立的单包仓库加自包含 `prepare` 脚本。首选 npm 或 tarball。

## 选择固定（selection pinning）

部署在启动时为接缝配置搜索提供方（base 组合钉死 `deepseek-official`）。本包在其静态配置之上拥有一个运行时开关：当本包设置段**启用**且 `OLLAMA_API_KEY` 凭据已配置时，通过 `ctx.web.setSearchProviderId` 把接缝固定到 `ollama`；两者任一失效（或插件卸载）时恢复部署自己的选择（挂载时捕获的原值）。任何表面写入密钥——设置卡片、外部编辑凭据文档——都通过 `credentials/reference-updated` 事件即时重钉或恢复，无需重启。

provider 的 `available()` 报告同一合取（启用且已配置密钥），因此被关掉或未配密钥的 Ollama 会自动退出自动选择，而不是让未固定时的自动选择变得歧义。

## HTTP：每次搜索一个辅助进程

请求通过 `ctx.subprocess` 服务派生的一次性 `node -e` 辅助进程发出，而不是本进程自己的 fetch。原因在于可选代理：Node 的 fetch 遵循 `HTTPS_PROXY`/`HTTP_PROXY`，但那是进程级全局事实；若经 `process.env` 路由，用户为搜索配置的代理会泄漏到 harness 内所有其他 fetch（包括 LLM 流量）。辅助进程只在自己的环境里收到本次请求的代理解析，隔离是精确的。辅助进程带 55s 兜底超时，低于部署给 `web_search` 工具的 60s 预算；调用方取消会触发子进程服务的整树终止升级，并以 `WEB_ABORTED` 呈现。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 已配置密钥时把 `web_search` 路由到 Ollama。作为设置段的 base 层；`$DSH_HOME/settings.yaml` 的用户层优先。 |
| `proxy` | 省略 | 搜索辅助进程的可选 HTTP(S) 代理，如 `http://127.0.0.1:7890`。留空表示直连。 |

```yaml
- id: web-search-ollama
  name: '@deepseek-ai/dsh-web-search-ollama'
  config:
    proxy: http://127.0.0.1:7890
```

密钥本身从不进入配置：它存储在固定的凭据引用 `OLLAMA_API_KEY` 下（在 <https://ollama.com/settings/keys> 创建），每次搜索通过凭据域解析；无凭据接缝时回落到启动进程环境。缺少密钥时调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，且 provider 保持不可用，因此永远不会赢得自动选择。

## 映射

`sources[]` 来自 `results[]`：`url` ← `url`，`title` ← `title`，`snippet` ← `content`。没有可用 `url` 的条目被跳过；接缝通过截断 `sources[]` 并置 `truncated` 来执行 `maxResults`。API 每次请求最多接受 10 条结果，provider 据此封顶自己的 `max_results`。

提供方失败以 `WEB_PROVIDER_ERROR` 呈现，响应体携带细节时一并附上；密钥被拒（HTTP 401）会指向 <https://ollama.com/settings/keys>，网络层失败附带代理提示。调用方取消以 `WEB_ABORTED` 呈现。

## Model Experience（模型体验）

### 辅助 Ollama 搜索请求

#### 模型看到什么

Ollama 收到的 POST 体恰好是 `{ query: <query>, max_results: <1..10> }` 加 Bearer 密钥；会话上下文的任何内容都不上线。返回的结果项映射为接缝归一化的 sources，即 `web_search` 工具渲染回模型的内容。

#### Token 影响

该请求不消耗会话模型的 token；响应仅以渲染后的 sources（url/title/snippet）计入工具结果。
