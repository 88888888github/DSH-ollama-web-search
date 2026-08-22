/**
 * Ollama web search through `POST https://ollama.com/api/web_search` with Bearer auth.
 *
 * HTTP goes through a one-shot node helper spawned on the subprocess service
 * rather than this process's own fetch: the optional proxy is a per-request
 * fact, and routing it through process environment would leak into every other
 * fetch in the harness (including LLM traffic). The helper receives only this
 * request's proxy entries, so the isolation is exact.
 * @module @deepseek-ai/dsh-web-search-ollama/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Stable id this provider registers under. */
export const OLLAMA_PROVIDER_ID = 'ollama'

/** Credential reference holding the Ollama API key. Fixed rather than configurable: one reference addresses the whole capability. */
export const OLLAMA_API_KEY_REF = 'OLLAMA_API_KEY'

/** The public Ollama web search endpoint (fixed: the API has one). */
export const OLLAMA_DEFAULT_ENDPOINT = 'https://ollama.com/api/web_search'

/** Upper bound on results the Ollama API accepts per request. */
const OLLAMA_MAX_RESULTS_CAP = 10

/** Helper backstop, kept below the deployment's 60s web_search tool budget. */
export const OLLAMA_HELPER_TIMEOUT_MS = 55000

/** Hint attached to network-failure diagnostics. */
export const OLLAMA_PROXY_HINT = 'If this machine cannot reach ollama.com directly, fill in a local proxy URL (for example http://127.0.0.1:7890) in the ollama web search settings card and retry.'

/** Hint attached to rejected-key diagnostics. */
export const OLLAMA_KEY_REJECTED_HINT = 'The key was rejected; rebuild it at ollama.com/settings/keys.'

/** The subprocess surface this package uses; structural so tests can script it. */
export interface SubprocessSpawnFace {
  resolveExecutable(command: string): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/** Resolved provider options (the plugin's `apply` supplies section and credential defaults). */
export interface OllamaSearchProviderOptions {
  /**
   * Whether this provider may serve searches right now: the section enabled AND a key configured. The cheap local check
   * behind available() — a switched-off or unkeyed provider must drop out of auto-selection rather than make it ambiguous.
   */
  readonly active: boolean
  /** The section's proxy for this operation, empty for a direct connection. */
  readonly proxy: string
  /** Resolve the current Ollama API key for one search operation. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Run one search request end to end (helper HTTP + mapping); supplied by the plugin, which owns the subprocess service. */
  readonly dispatch: (
    input: { readonly key: string; readonly proxy: string }, request: WebSearchRequest, signal?: AbortSignal,
  ) => Promise<WebSearchResult>
}

/** The Ollama-backed search provider; every failure surfaces as {@link WebError}. */
export class OllamaSearchProvider implements WebSearchProvider {
  readonly id = OLLAMA_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry new state would
   * make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => OllamaSearchProviderOptions) {}

  available(): boolean {
    return this.resolveOptions().active
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfSearchAborted(signal)
    const options = this.resolveOptions()
    let key: string | undefined
    try {
      key = await abortable(options.resolveApiKey(), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`ollama web search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throwIfSearchAborted(signal)
    if (key === undefined || key.length === 0) {
      throw new WebError(
        `ollama web search has no API key for "${OLLAMA_API_KEY_REF}"; set it in Settings > Plugins > ollama web search`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    return options.dispatch({ key, proxy: options.proxy }, request, signal)
  }
}

/** The verdict the helper writes to stdout. */
export interface OllamaHelperVerdict {
  readonly ok?: boolean
  readonly status?: number
  readonly body?: unknown
  readonly error?: string
}

/**
 * One-shot helper script: read one request from stdin, POST it with Bearer
 * auth, and emit a JSON verdict. Runs in its own node process so the optional
 * proxy environment (HTTPS_PROXY/HTTP_PROXY, honored by Node's fetch) applies
 * to exactly this request and nothing else.
 */
export const OLLAMA_HELPER_SCRIPT = 'let buf=\'\';process.stdin.setEncoding(\'utf8\');process.stdin.on(\'data\',(c)=>{buf+=c});process.stdin.on(\'end\',async()=>{const emit=(o)=>{try{process.stdout.write(JSON.stringify(o))}catch(e){}};try{const req=JSON.parse(buf);const res=await fetch(req.url,{method:\'POST\',headers:{authorization:\'Bearer \'+req.key,\'content-type\':\'application/json\',accept:\'application/json\',\'user-agent\':\'deepseek-harness-ollama-search/1.0\'},body:JSON.stringify({query:req.query,max_results:req.maxResults}),signal:AbortSignal.timeout(req.timeoutMs)});const text=await res.text();let body;try{body=JSON.parse(text)}catch(e){body=undefined}emit({ok:res.ok,status:res.status,body:body!==undefined?body:{raw:String(text).slice(0,2000)}});}catch(e){emit({ok:false,error:String((e&&e.message)||e)})}});'

/**
 * Map one Ollama response body to a normalized search result. Items without a
 * usable url are skipped; `content` becomes the snippet. The web service owns
 * the final maxResults truncation, so truncated is always false here.
 * @param body - the parsed response body (or its raw-string fallback).
 * @returns the normalized result.
 */
export function mapOllamaResponse(body: unknown): WebSearchResult {
  const results = body !== null && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)
    ? (body as { results: readonly unknown[] }).results
    : []
  const sources: WebSearchSource[] = []
  for (const item of results) {
    if (item === null || typeof item !== 'object') continue
    const url = (item as { url?: unknown }).url
    if (typeof url !== 'string' || url.length === 0) continue
    const title = (item as { title?: unknown }).title
    const content = (item as { content?: unknown }).content
    sources.push({
      url,
      ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
      ...(typeof content === 'string' && content.length > 0 ? { snippet: content } : {}),
    })
  }
  return { sources, truncated: false }
}

/**
 * Run one search through the helper and map its verdict. The subprocess face
 * is passed in rather than injected so this step stays testable without a live
 * process tree.
 * @param subprocess - the spawn face (the service or a scripted double).
 * @param input - the resolved key and the section's proxy for this request.
 * @param request - the query and optional result limit.
 * @param signal - cancellation; starts the helper's terminate escalation.
 * @returns the mapped result.
 */
export async function dispatchOllamaSearch(
  subprocess: SubprocessSpawnFace,
  input: { readonly key: string; readonly proxy: string },
  request: WebSearchRequest,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  throwIfSearchAborted(signal)
  const maxResults = Math.min(Math.max(1, request.maxResults ?? 5), OLLAMA_MAX_RESULTS_CAP)
  let nodePath: string
  try {
    nodePath = await subprocess.resolveExecutable('node')
  } catch (error: unknown) {
    throw new WebError(`ollama web search cannot find a node executable on PATH: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  let handle: SubprocessHandle
  try {
    handle = subprocess.spawn({
      argv: [nodePath, '-e', OLLAMA_HELPER_SCRIPT],
      cwd: process.cwd(),
      stdio: {
        stdin: {
          data: JSON.stringify({
            url: OLLAMA_DEFAULT_ENDPOINT, key: input.key, query: request.query, maxResults, timeoutMs: OLLAMA_HELPER_TIMEOUT_MS,
          }),
        },
        stdout: { maxBytes: 512000 },
        stderr: { maxBytes: 32000 },
      },
      graceMs: 1500,
      ...(input.proxy.length > 0 ? { env: { HTTPS_PROXY: input.proxy, HTTP_PROXY: input.proxy } } : {}),
      ...(signal !== undefined ? { signal } : {}),
    })
  } catch (error: unknown) {
    throw new WebError(`ollama web search failed to start its helper process: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  let spawnFailure: string | undefined
  // The sentinel never reads: a spawn-level failure throws before it is used.
  let outcome: SubprocessOutcome = { exitCode: null, signal: null }
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    // A spawn-level failure rejects `done`; everything else settles through the exit facts.
    spawnFailure = String(error)
  }
  if (signal?.aborted === true) {
    try { handle.terminate() } catch (_terminateFailure) {}
    throw searchAborted(signal)
  }
  if (spawnFailure !== undefined) {
    throw new WebError(`ollama web search helper failed to start: ${spawnFailure}`, 'WEB_PROVIDER_ERROR')
  }
  let text = ''
  try { text = handle.collected.stdout?.readFrom(0).text ?? '' } catch (_readFailure) {}
  let parsed: OllamaHelperVerdict | null
  try {
    parsed = JSON.parse(String(text).trim()) as OllamaHelperVerdict | null
  } catch (_parseFailure) {
    throw new WebError(`ollama web search helper produced no readable output (exit ${String(outcome.exitCode ?? outcome.signal)})`, 'WEB_PROVIDER_ERROR')
  }
  if (parsed !== null && parsed.ok === true) return mapOllamaResponse(parsed.body)

  let detail: string | undefined
  if (parsed !== null && parsed.body !== null && typeof parsed.body === 'object') {
    const body = parsed.body as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.length > 0) detail = body.error
    else if (typeof body.message === 'string' && body.message.length > 0) detail = body.message
  }
  const status = parsed !== null && typeof parsed.status === 'number' ? parsed.status : '?'
  let message = `Ollama API error (HTTP ${String(status)}): ${detail ?? 'request failed'}`
  if (parsed !== null && typeof parsed.error === 'string' && /fetch failed|timeout|ECONN/i.test(parsed.error)) {
    message += ` — ${OLLAMA_PROXY_HINT}`
  } else if (status === 401) {
    message += ` ${OLLAMA_KEY_REJECTED_HINT}`
  }
  throw new WebError(message, 'WEB_PROVIDER_ERROR')
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal: AbortSignal | undefined, fallback?: unknown): WebError {
  return new WebError('Ollama search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
