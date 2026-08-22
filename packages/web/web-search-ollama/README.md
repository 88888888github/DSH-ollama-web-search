# @deepseek-ai/dsh-web-search-ollama

English | [中文](README.zh.md)

An [Ollama](https://ollama.com)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls the Ollama web search API (`POST https://ollama.com/api/web_search`) with Bearer auth and maps the `{ results: [{ url, title, content }] }` body into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, resolves its credential for each search through the optional `ctx.credentials` seam, owns a Settings section (`web-search-ollama`) with an enable switch and an optional proxy, and does not register a model-facing tool. Like `@deepseek-ai/dsh-web-search-deepseek`, it is a function/namespace plugin (`inject: ['web']`).

## Installation

In-box once the seam PR lands upstream: `dsh-base` carries the `web-search-ollama` row, so every web profile mounts it by default — nothing to install.

Out-of-tree (pre-release or third-party profiles): the package declares a bundle (`dsh.bundle` → `cordis.patch.yml`), so one command installs it into any profile:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-web-search-ollama     # npm (after publish)
dsh plugin --profile web add ./dsh-web-search-ollama-<version>.tgz  # tarball (pnpm pack)
```

`dsh plugin` appends the package to the profile's `dsh.profile.bundles` layer stack automatically; removing the dependency removes the layer. The shipped patch is an id-targeted **upsert**, not an insert: on a dsh whose base already carries the row it is a harmless no-op (the same id in two layers = upsert), and on a dsh without the row it warns and skips rather than mounting a row that could not activate anyway.

**Requires a dsh release that includes the seam API** — `ctx.web.setSearchProviderId` / `getSearchProviderId` are not part of the released 0.1.1-rc.2; they land with the upstream PR this package ships in. On a stock dsh, mounting the row (for example by hand-inserting it into a profile patch) fails activation with a `TypeError`; the rest of dsh is unaffected.

Git-hosted installs (`dsh plugin add github:user/repo`) are not a channel for this package: pnpm git dependencies have no subdirectory spec, and this monorepo's root is private and builds only from its workspace — a standalone single-package repository with a self-contained `prepare` script would be required. Prefer npm or a tarball.

## Selection pinning

The deployment configures the seam's search provider at boot (the base bundle pins `deepseek-official`). This package owns an operational switch on top of that static configuration: while its section is **enabled** and the `OLLAMA_API_KEY` credential is configured, it re-pins the seam to `ollama` through `ctx.web.setSearchProviderId`; when either falls away (or the plugin unloads), it restores exactly the deployment's own selection, captured at attach. A key written from any surface — the settings card, an external edit of the credentials document — re-pins or restores without a restart, through the `credentials/reference-updated` event.

The provider's `available()` reports the same conjunction (enabled AND keyed), so a switched-off or unkeyed Ollama drops out of auto-selection instead of making it ambiguous when no provider is pinned.

## HTTP: one helper process per search

The request goes through a one-shot `node -e` helper spawned on the `ctx.subprocess` service rather than this process's own fetch. The reason is the optional proxy: Node's fetch honors `HTTPS_PROXY`/`HTTP_PROXY`, but those are process-global facts, and routing them through `process.env` would leak the user's search proxy into every other fetch in the harness (including LLM traffic). The helper receives only this request's proxy entries on its own environment, so the isolation is exact. The helper carries a 55s backstop under the deployment's 60s `web_search` tool budget; caller cancellation starts the subprocess service's tree-terminate escalation and surfaces as `WEB_ABORTED`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Route `web_search` through Ollama while a key is configured. The section's base layer; the user layer in `$DSH_HOME/settings.yaml` wins. |
| `proxy` | omitted | Optional HTTP(S) proxy for the search helper, e.g. `http://127.0.0.1:7890`. Empty means a direct connection. |

```yaml
- id: web-search-ollama
  name: '@deepseek-ai/dsh-web-search-ollama'
  config:
    proxy: http://127.0.0.1:7890
```

The key itself never enters configuration: it is stored under the fixed credential reference `OLLAMA_API_KEY` (create one at <https://ollama.com/settings/keys>), resolved per search through the credentials domain, or from the launching environment when that seam is absent. A missing key fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING` and keeps the provider unavailable, so it can never win auto-selection.

## Mapping

`sources[]` comes from `results[]`: `url` ← `url`, `title` ← `title`, `snippet` ← `content`. Items without a usable `url` are skipped; the seam enforces `maxResults` by truncating `sources[]` and setting `truncated`. The API accepts at most 10 results per request, so the provider caps its own `max_results` there.

Provider failures become `WEB_PROVIDER_ERROR` with the API detail when the body carries one; a rejected key (HTTP 401) points at <https://ollama.com/settings/keys>, and network-level failures append a proxy hint. Caller cancellation becomes `WEB_ABORTED`.

## Model Experience

### Auxiliary Ollama search request

#### What the model sees

Ollama receives exactly `{ query: <query>, max_results: <1..10> }` as its POST body with a Bearer key; nothing from the conversation context crosses the wire. The returned result items are mapped to the seam's normalized sources, which is what the `web_search` tool renders back to the model.

#### Token effect

The request costs no tokens of the conversation model; the response contributes only the rendered sources (url/title/snippet) to the tool result.
