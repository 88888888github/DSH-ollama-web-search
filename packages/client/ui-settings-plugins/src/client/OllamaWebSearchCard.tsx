/**
 * The ollama web search provider's card: its enable switch, its optional
 * proxy, and the key — which is written through the credentials domain, never
 * into the settings section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CheckField, SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { OllamaWebSearchCardFace } from './ollama-web-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the ollama web search card. */
export type OllamaWebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<OllamaWebSearchCardFace>

/**
 * Render the ollama web search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function OllamaWebSearchCard(props: OllamaWebSearchCardProps) {
  const { t } = props
  const state = props.useOllamaWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="ollamaWebSearchTitle"
      descriptionKey="ollamaWebSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <CheckField
        id="plugin-config-ollama-web-search-enabled"
        label={t('ollamaWebSearchEnabled')}
        hint={t('ollamaWebSearchEnabledHint')}
        overridden={state.enabled.overridden}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        checked={state.enabled.text === 'true'}
        disabled={disabled}
        onToggle={(checked) => { props.edit('enabled', String(checked)) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <SecretField
        id="plugin-config-ollama-web-search-key"
        label={t('ollamaWebSearchApiKey')}
        hint={t('ollamaWebSearchApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('ollamaWebSearchApiKeySet') : t('ollamaWebSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-ollama-web-search-proxy"
        label={t('ollamaWebSearchProxy')}
        hint={t('ollamaWebSearchProxyHint')}
        placeholder="http://127.0.0.1:7890"
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.proxy}
        onEdit={(text) => { props.edit('proxy', text) }}
        onReset={() => { props.resetField('proxy') }}
      />
    </PluginCard>
  )
}
