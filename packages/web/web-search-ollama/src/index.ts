/**
 * Register an Ollama-backed provider in `ctx.web` and pin the seam's search
 * selection to it while this package's settings section is enabled and its API
 * key is configured. Whenever Ollama is not active (or the plugin unloads) the
 * seam returns to exactly the deployment's own selection, captured at attach.
 * @module @deepseek-ai/dsh-web-search-ollama
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { WebError } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-web'
import { OllamaSearchProvider, OLLAMA_API_KEY_REF, OLLAMA_PROVIDER_ID, dispatchOllamaSearch, type SubprocessSpawnFace } from './provider.ts'

export {
  OllamaSearchProvider,
  OLLAMA_API_KEY_REF,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_HELPER_SCRIPT,
  OLLAMA_HELPER_TIMEOUT_MS,
  OLLAMA_KEY_REJECTED_HINT,
  OLLAMA_PROXY_HINT,
  dispatchOllamaSearch,
  mapOllamaResponse,
} from './provider.ts'
export type {
  OllamaHelperVerdict,
  OllamaSearchProviderOptions,
  SubprocessSpawnFace,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ollama'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Settings namespace carrying this provider's enable switch and proxy. */
export const WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE = settingsNamespace('web-search-ollama')

/** Plugin config (all optional — `apply` fills schema defaults). */
export interface Config {
  /** Route web_search through Ollama while a key is configured. Defaults to true. */
  enabled?: boolean
  /** Optional HTTP(S) proxy for the search helper, e.g. http://127.0.0.1:7890. */
  proxy?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  proxy: z.string(),
})

/** Re-check cadence while the credentials plane is still settling at boot. */
const CONVERGENCE_INTERVAL_MS = 250

/** Give up on attach-time convergence after this; later writes are covered by the reference-updated event. */
const CONVERGENCE_WINDOW_MS = 10_000

/**
 * Register the Ollama search provider with `ctx.web` and pin the seam's
 * selection to it while the section is enabled and a key is configured.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  const state = { keyConfigured: false }
  let disposed = false

  // The deployment's own choice (boot config or environment), captured before
  // this plugin may write the field: whenever Ollama is not active the seam
  // returns to exactly that, never to a guess.
  const originalSelection = ctx.web.getSearchProviderId()

  // Pin 'ollama' while active; restore the deployment's selection otherwise.
  // A no-op after disposal so a recheck that outlives teardown cannot re-pin
  // an unregistered provider.
  const applySelection = (): void => {
    if (disposed) return
    const section = current()
    ctx.web.setSearchProviderId((section.enabled ?? true) && state.keyConfigured ? OLLAMA_PROVIDER_ID : originalSelection)
  }

  // Refresh the key state, then re-apply the selection.
  const recheck = (): void => {
    void refreshKeyState(ctx, state).then(applySelection)
  }

  installSettingsSection(ctx, WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: recheck,
  })

  const provider = new OllamaSearchProvider(() => ({
    active: (current().enabled ?? true) && state.keyConfigured,
    proxy: current().proxy ?? '',
    resolveApiKey: () => resolveApiKey(ctx),
    dispatch: (input, request, signal) => dispatchOllamaSearch(subprocessOf(ctx), input, request, signal),
  }))
  ctx.web.registerSearchProvider(provider)

  // A key written from any surface (the settings card, an external edit) re-pins
  // or clears the selection without a settings write.
  ctx.on('credentials/reference-updated', (ref) => {
    if (String(ref) === OLLAMA_API_KEY_REF) recheck()
  })

  // Restore the deployment's selection on unload: with the provider
  // unregistered, a stale 'ollama' pin would fail every search as
  // WEB_PROVIDER_CONFIGURED_MISSING.
  ctx.effect(() => () => {
    disposed = true
    ctx.web.setSearchProviderId(originalSelection)
  }, 'web-search-ollama: restore selection')

  // Boot convergence: the credentials service (when present) registers at
  // construction and loads its document asynchronously afterwards, so the
  // attach-time read can observe an empty snapshot — or no service at all when
  // it has not even been constructed yet. Neither state is distinguishable from
  // "unkeyed" by a single read, and the initial load emits no event, so re-check
  // on a short interval until the first positive answer or the window closes;
  // afterwards writes are covered by the reference-updated listener above.
  let timer: ReturnType<typeof setTimeout> | undefined
  ctx.effect(() => () => {
    if (timer !== undefined) clearTimeout(timer)
  }, 'web-search-ollama: convergence timer')
  void (async () => {
    const startedAt = Date.now()
    for (;;) {
      await refreshKeyState(ctx, state)
      applySelection()
      if (disposed || state.keyConfigured || Date.now() - startedAt >= CONVERGENCE_WINDOW_MS) return
      await new Promise<void>((resolve) => { timer = setTimeout(resolve, CONVERGENCE_INTERVAL_MS) })
    }
  })()
}

/** The subprocess service this package's helper runs on; a deployment without one fails per search. */
function subprocessOf(ctx: Context): SubprocessSpawnFace {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new WebError('ollama web search requires the subprocess service; this deployment does not mount one', 'WEB_PROVIDER_ERROR')
  }
  return subprocess
}

/** Resolve the current key: the credentials domain, or the launch environment without it. */
async function resolveApiKey(ctx: Context): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return (await credentials.resolve(credentialRef(OLLAMA_API_KEY_REF)))?.value
  // Without the seam the environment is the whole credential plane.
  const ambient = launchEnvironmentOf(ctx).get(OLLAMA_API_KEY_REF)
  return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
}

/** Read whether a key stands for this provider's reference, from whichever plane supplies it. */
async function refreshKeyState(ctx: Context, state: { keyConfigured: boolean }): Promise<void> {
  try {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      const ambient = launchEnvironmentOf(ctx).get(OLLAMA_API_KEY_REF)
      state.keyConfigured = ambient !== undefined && ambient.value.length > 0
      return
    }
    const info = await credentials.describe(credentialRef(OLLAMA_API_KEY_REF))
    state.keyConfigured = Boolean(info?.configured)
  } catch (_readFailure) {
    // A read failure keeps the last known state; the next event or search re-checks.
  }
}
