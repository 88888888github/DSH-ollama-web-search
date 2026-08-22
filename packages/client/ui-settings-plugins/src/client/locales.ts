/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'
  | 'ollamaWebSearchTitle' | 'ollamaWebSearchDescription'
  | 'ollamaWebSearchEnabled' | 'ollamaWebSearchEnabledHint'
  | 'ollamaWebSearchApiKey' | 'ollamaWebSearchApiKeyHint' | 'ollamaWebSearchApiKeySet' | 'ollamaWebSearchApiKeyUnset'
  | 'ollamaWebSearchProxy' | 'ollamaWebSearchProxyHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
  ollamaWebSearchTitle: 'Ollama web search',
  ollamaWebSearchDescription: 'Routes web_search through the Ollama web search API while enabled and keyed.',
  ollamaWebSearchEnabled: 'Use Ollama for web_search',
  ollamaWebSearchEnabledHint: 'Takes over from the configured route while checked and a key is configured; unchecking returns to it.',
  ollamaWebSearchApiKey: 'Ollama API key',
  ollamaWebSearchApiKeyHint: 'Stored as the OLLAMA_API_KEY credential, outside the settings file. Create a key at ollama.com/settings/keys. Leave blank to keep the current key.',
  ollamaWebSearchApiKeySet: 'A key is configured.',
  ollamaWebSearchApiKeyUnset: 'No key is configured; search stays on the configured route until one is.',
  ollamaWebSearchProxy: 'Proxy URL (optional)',
  ollamaWebSearchProxyHint: 'Leave empty for a direct connection; fill in a local proxy when this machine cannot reach ollama.com directly.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安装的插件。',
  tabs: '插件视图',
  configurableTab: '插件配置',
  empty: '本部署没有开放任何插件设置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  webSearchApiKeySet: '已配置密钥。',
  webSearchApiKeyUnset: '未配置密钥；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空则使用提供方默认地址。',
  webSearchMaxUses: '单次请求最多搜索次数',
  webSearchMaxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
  ollamaWebSearchTitle: 'Ollama 网页搜索',
  ollamaWebSearchDescription: '启用且已配置密钥时，把 web_search 路由到 Ollama 网页搜索 API。',
  ollamaWebSearchEnabled: '使用 Ollama 进行 web_search',
  ollamaWebSearchEnabledHint: '勾选且已配置密钥时接管当前配置的搜索路线；取消勾选即恢复原路线。',
  ollamaWebSearchApiKey: 'Ollama API Key',
  ollamaWebSearchApiKeyHint: '以 OLLAMA_API_KEY 凭据存储，不写入设置文件。在 ollama.com/settings/keys 创建密钥。留空表示保持当前密钥。',
  ollamaWebSearchApiKeySet: '已配置密钥。',
  ollamaWebSearchApiKeyUnset: '未配置密钥；配置之前搜索保持在当前配置的路线上。',
  ollamaWebSearchProxy: '代理地址（可选）',
  ollamaWebSearchProxyHint: '留空表示直连；本机无法直连 ollama.com 时填写本地代理。',
}
