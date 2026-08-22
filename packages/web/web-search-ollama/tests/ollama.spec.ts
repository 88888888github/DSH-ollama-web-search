/** The `web-search-ollama` provider: selection pinning, key gating, and the helper dispatch. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  SubprocessRuntime,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
  type SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import WebRuntime, { type WebSearchProvider } from '@deepseek-ai/dsh-web'
import * as ollamaPlugin from '@deepseek-ai/dsh-web-search-ollama'
import {
  OLLAMA_API_KEY_REF,
  WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE,
  mapOllamaResponse,
} from '@deepseek-ai/dsh-web-search-ollama'

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** In-memory credentials provider seeded from plugin config; emits the committed change event. */
class MemoryCredentials extends CredentialProvider {
  private readonly store = new Map<string, string>()
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    for (const [key, value] of Object.entries(seed)) this.store.set(key, value)
  }

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined || value.length === 0
      ? undefined
      : { value, source: 'memory' })
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = this.store.get(ref)
    const configured = value !== undefined && value.length > 0
    return Promise.resolve({
      configured,
      ...configured ? { source: 'memory' } : {},
      writable: true,
    })
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) return Promise.reject(new Error('empty value'))
    this.store.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  unset(ref: CredentialRef): Promise<void> {
    if (this.store.delete(ref)) this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }

  listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    return next
  }

  deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
    return Promise.resolve()
  }
}

/** Scripted subprocess face: every spawn answers with the fixed verdict and records its spec. */
class ScriptedSubprocess extends SubprocessRuntime {
  calls: SubprocessSpawnSpec[] = []

  constructor(ctx: Context, private readonly verdict: string) {
    super(ctx)
  }

  async resolveExecutable(command: string): Promise<string> {
    return command === 'node' ? process.execPath : ''
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.calls.push(spec)
    const verdict = this.verdict
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: { readFrom: () => ({ text: verdict, nextOffset: 0, lossy: false }) } },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  async spawnTerminal(): Promise<SubprocessTerminalHandle> {
    throw new Error('ScriptedSubprocess: spawnTerminal is not used in these tests')
  }
}

/** The deployment's other provider, standing in for `web-search-deepseek`. */
function deepseekProvider(): WebSearchProvider {
  return {
    id: 'deepseek-official',
    available: () => true,
    search: async () => ({ sources: [{ url: 'https://deepseek.test' }], truncated: false }),
  }
}

const ONE_RESULT = JSON.stringify({
  ok: true,
  status: 200,
  body: { results: [{ url: 'https://ollama.test', title: 'Ollama', content: 'snippet' }] },
})

async function boot(seed: Record<string, string> = {}): Promise<{
  ctx: Context
  pluginFiber: Fiber
  subprocess: ScriptedSubprocess
  credentials: MemoryCredentials
}> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-official' })
  const deepseekFiber = ctx.plugin({ name: 'test-deepseek', inject: ['web'], apply(inner: Context) { inner.web.registerSearchProvider(deepseekProvider()) } })
  await deepseekFiber.await()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const credentials = new MemoryCredentials(ctx, seed)
  const subprocess = new ScriptedSubprocess(ctx, ONE_RESULT)
  const pluginFiber = ctx.plugin(ollamaPlugin, {})
  await pluginFiber.await()
  // The initial key read is asynchronous; let the first selection settle.
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  return { ctx, pluginFiber, subprocess, credentials }
}

async function searchSource(ctx: Context): Promise<string> {
  const result = await ctx.web.search({ query: 'anything' })
  return result.sources[0]?.url ?? ''
}

describe('mapOllamaResponse', () => {
  it('maps results to sources, dropping items without a usable url', () => {
    const mapped = mapOllamaResponse({
      results: [
        { url: 'https://a.test', title: 'A', content: 'snippet-a' },
        { url: 'https://b.test' },
        { title: 'no url' },
        null,
        'noise',
      ],
    })
    expect(mapped).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'snippet-a' },
        { url: 'https://b.test' },
      ],
      truncated: false,
    })
  })

  it('returns empty sources for an absent or malformed body', () => {
    expect(mapOllamaResponse(null).sources).toEqual([])
    expect(mapOllamaResponse({}).sources).toEqual([])
    expect(mapOllamaResponse({ results: 'nope' }).sources).toEqual([])
  })
})

describe('web-search-ollama selection pinning', () => {
  it('pins the seam to ollama while enabled and keyed, routing searches through the helper', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')

    const call = bench.subprocess.calls.at(-1)
    expect(call).toBeDefined()
    const stdin = (call?.stdio.stdin as { data: string }).data
    const request = JSON.parse(stdin) as Record<string, unknown>
    expect(request.url).toBe('https://ollama.com/api/web_search')
    expect(request.key).toBe('oll-test-key')
    expect(request.query).toBe('anything')
    await bench.ctx.fiber.dispose()
  })

  it('passes the section proxy to the helper only when configured', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    await bench.ctx.settings.update(WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE, { proxy: 'http://127.0.0.1:7890' })
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')
    const call = bench.subprocess.calls.at(-1)
    expect(call?.env).toEqual({ HTTPS_PROXY: 'http://127.0.0.1:7890', HTTP_PROXY: 'http://127.0.0.1:7890' })
    await bench.ctx.fiber.dispose()
  })

  it('returns to the configured route when the section is disabled', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')

    await bench.ctx.settings.update(WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE, { enabled: false })
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(await searchSource(bench.ctx)).toBe('https://deepseek.test')
    await bench.ctx.fiber.dispose()
  })

  it('returns to the configured route when the key is removed', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')

    await bench.credentials.unset(credentialRef(OLLAMA_API_KEY_REF))
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(await searchSource(bench.ctx)).toBe('https://deepseek.test')
    await bench.ctx.fiber.dispose()
  })

  it('stays on the configured route while unkeyed and pins when a key lands', async () => {
    const bench = await boot({})
    expect(await searchSource(bench.ctx)).toBe('https://deepseek.test')

    await bench.credentials.set(credentialRef(OLLAMA_API_KEY_REF), 'oll-late-key')
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')
    await bench.ctx.fiber.dispose()
  })

  it('fails a keyed-but-disabled section as unavailable rather than ambiguous', async () => {
    const bench = await boot({})
    // No key: ollama is registered but unavailable; auto-selection picks deepseek.
    expect(await searchSource(bench.ctx)).toBe('https://deepseek.test')
    await bench.ctx.fiber.dispose()
  })

  it('releases the provider and clears the pin when the plugin unloads', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    expect(await searchSource(bench.ctx)).toBe('https://ollama.test')

    await bench.pluginFiber.dispose()
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    // The pin is cleared and the provider unregistered: auto-selection finds deepseek.
    expect(await searchSource(bench.ctx)).toBe('https://deepseek.test')
    await bench.ctx.fiber.dispose()
  })

  it('registers its settings namespace on the shared document', async () => {
    const bench = await boot({ [OLLAMA_API_KEY_REF]: 'oll-test-key' })
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-ollama')
    await bench.ctx.fiber.dispose()
  })
})
