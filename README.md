# DSH Ollama Web Search

Install an **Ollama web search provider** into a DeepSeek Harness (dsh) deployment with one command. When enabled and keyed, the `web_search` tool routes through Ollama's search API (`POST https://ollama.com/api/web_search`) instead of the deployment's default provider; when disabled or unkeyed it restores exactly the deployment's own choice.

## Install (one command)

```sh
dsh plugin <profile> add https://raw.githubusercontent.com/88888888github/DSH-ollama-web-search/main/dist/deepseek-ai-dsh-web-search-ollama-0.1.1-rc.2.tgz
```

What happens, automatically:

1. pnpm installs the prebuilt package into the profile (no build, no code execution at install time).
2. The package declares `dsh.bundle`, so dsh appends it to the profile's bundle layer stack (`dsh.profile.bundles`) — one line in, one line out on removal.
3. On next restart, Settings → Plugins shows an **Ollama web search** card below the DeepSeek card: an `enabled` checkbox and an optional proxy field.

Then configure the key (https://ollama.com/settings/keys) from the card or `.credentials.yaml` (`OLLAMA_API_KEY`). Pinning is live: key written → `web_search` routes through Ollama immediately, no restart, no approval; key removed or section disabled → the deployment's original provider selection is restored.

### Requirements

- A dsh **built from source containing the web seam API** (`ctx.web.setSearchProviderId` / `getSearchProviderId`) — i.e. this repo's `feat/web-search-ollama` branch (see *Build from source* below). Released dsh 0.1.1-rc.2 does not have that API: installing there is a safe no-op (one warning, row unmounted, nothing else affected).
- Node 25 / pnpm 11.x for the `dsh` CLI itself.

### Verify after install

```sh
dsh --profile <profile> --dump-config   # expect zero stderr; composition contains:
#   - id: web-search-ollama
#     name: '@deepseek-ai/dsh-web-search-ollama'
```

## Build from source (fresh deployment, feature in-box)

This repo's `feat/web-search-ollama` branch is the full dsh monorepo with the feature built into the base bundle — no plugin install needed at all:

```sh
git clone https://github.com/88888888github/DSH-ollama-web-search && cd DSH-ollama-web-search
git checkout feat/web-search-ollama
pnpm install
npm run build:lib:host
npm run build:lib:client
node apps/cli/lib/bin.js web --port 0 --no-open   # smoke boot; kill afterwards
```

## Behavior contract

| Condition | Seam selection |
|---|---|
| section enabled **and** `OLLAMA_API_KEY` configured | pinned to `ollama` |
| either falls away, or plugin unloads | the deployment's own boot-time choice (captured at attach) |

- Boot convergence: the credentials document loads asynchronously after service registration, so key state is re-checked every 250 ms for up to 10 s after attach; afterwards writes are covered by the `credentials/reference-updated` event.
- HTTP: one one-shot `node -e` helper per search on the subprocess service (the host has no fetch); per-request proxy isolation via the helper's own environment; 55 s backstop under the 60 s tool budget; caller cancellation surfaces as `WEB_ABORTED`.
- Data lives in `$DSH_HOME/settings.yaml` (`web-search-ollama:` section) and `.credentials.yaml` (`OLLAMA_API_KEY`) — zero migration, nothing is migrated by this package.

## Repo layout

| Path | What it is |
|---|---|
| `main` (this branch) | Install hub: this guide + the prebuilt bundle under `dist/` |
| `feat/web-search-ollama` | Full dsh monorepo, feature in-box (2 commits over upstream 0.1.1-rc.2: provider + settings card + seam pinning; boot-convergence fix) |

## 中文速览

一条命令安装（需要 dsh 从本仓库 `feat/web-search-ollama` 分支构建）：

```sh
dsh plugin <profile> add https://raw.githubusercontent.com/88888888github/DSH-ollama-web-search/main/dist/deepseek-ai-dsh-web-search-ollama-0.1.1-rc.2.tgz
```

重启后 Settings → Plugins 出现 Ollama 卡片；配好 key（ollama.com/settings/keys）+ 勾选 enabled，`web_search` 立即走 Ollama，无需批准、无需重启。被禁用或删 key 时恢复部署原有选择。全新部署可直接 `git checkout feat/web-search-ollama` + `pnpm install` + 两条构建链，功能开箱即用（见上方 Build from source）。
