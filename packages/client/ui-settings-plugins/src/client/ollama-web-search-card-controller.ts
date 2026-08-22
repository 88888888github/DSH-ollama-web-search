/**
 * The ollama web search card's staged form over the `web-search-ollama`
 * settings namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the fixed
 * reference the provider resolves. It is still staged with the rest of the
 * form, so one save covers everything the card shows.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  booleanField, textField,
  CardForm,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the Ollama search provider. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const OLLAMA_WEB_SEARCH_NS = 'web-search-ollama'

/** Credential reference the provider resolves; fixed, so the card addresses it directly. */
const OLLAMA_API_KEY_REF = 'OLLAMA_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The ollama web search fields this card edits. */
export interface OllamaWebSearchSettings {
  /** Route web_search through Ollama while a key is configured. */
  enabled?: boolean
  /** Optional proxy URL for the search helper; blank means direct. */
  proxy?: string
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the ollama web search card renders. */
export interface OllamaWebSearchCardState extends CardShell {
  /** The enable switch's staged state. */
  enabled: CardFieldState
  /** The optional proxy URL's staged state. */
  proxy: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the ollama web search card's slot entry injects. */
export interface OllamaWebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useOllamaWebSearchCard. */
    ollamaWebSearchCard: SnapshotStore<OllamaWebSearchCardState>
  }
}

/** Bridges the `web-search-ollama` scope and the credentials domain onto the card. */
export class OllamaWebSearchCardController {
  private readonly form: CardForm<OllamaWebSearchSettings>
  private readonly store: SnapshotStore<OllamaWebSearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-ollama` namespace.
   * @param api - wire face used for the credential the provider references.
   */
  constructor(
    scope: SettingsScope<OllamaWebSearchSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [booleanField('enabled'), textField('proxy')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): OllamaWebSearchCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      proxy: this.form.field('proxy'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the provider's fixed reference.
   *
   * The answer is stored with the reference it describes so a response that
   * settles out of order never publishes a state for a name nobody asked.
   */
  private async readCredential(): Promise<void> {
    const ref = OLLAMA_API_KEY_REF
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      // The card stays usable without this: the key control simply reports the
      // last state it knew, and a write still reaches the Host.
      return
    }
    if (!response.result.ok || ref !== OLLAMA_API_KEY_REF) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — an external edit of the
   * credentials document addresses the same reference — and the settings
   * section does not change when it is, so without this the badge keeps
   * reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== OLLAMA_API_KEY_REF) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): OllamaWebSearchCardFace {
    return { hooks: { ollamaWebSearchCard: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: OLLAMA_API_KEY_REF, value })
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below: the Host is the only
      // authority on whether the key now exists.
    }
    await this.readCredential()
    return this.credential.configured
  }
}
