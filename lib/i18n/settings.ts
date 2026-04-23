// Settings translations - Chinese (Simplified)
export const settingsZhCN = {
  general: '常规设置',
  system: '系统设置',
  language: '语言',
  languageDescription: '选择界面语言',
  theme: '主题',
  themeDescription: '选择主题模式',
  themeLight: '浅色',
  themeDark: '深色',
  themeSystem: '跟随系统',
  save: '保存',
  saveSuccess: '保存成功',
  saveFailed: '保存失败',
  cancel: '取消',
  close: '关闭',
  delete: '删除',
  edit: '编辑',
  add: '添加',
  reset: '重置',
  confirm: '确认',
  loading: '加载中...',
  error: '错误',
  success: '成功',
  warning: '警告',
  info: '提示',
  required: '必填',
  optional: '选填',

  // API Keys and Configuration
  apiConfiguration: 'API 配置',
  apiKey: 'API 密钥',
  apiKeyDescription: '配置您的 API 密钥',
  apiKeyPlaceholder: '输入 API 密钥',
  apiKeyRequired: 'API 密钥不能为空',
  baseUrl: 'Base URL',
  baseUrlDescription: 'API 请求地址',
  baseUrlPlaceholder: '输入 Base URL',

  // Model Settings
  modelSettings: '模型设置',
  selectModel: '选择模型',
  defaultModel: '默认模型',
  modelName: '模型名称',
  modelId: '模型 ID',
  modelCapabilities: '模型能力',
  visionCapability: '视觉',
  toolsCapability: '工具',
  streamingCapability: '流式',
  contextWindow: '上下文窗口',
  maxOutputTokens: '最大输出',

  // TTS Settings
  ttsSettings: '语音合成设置',
  ttsProvider: 'TTS 提供商',
  ttsVoice: '音色',
  ttsSpeed: '语速',
  ttsLanguage: '语言',
  ttsTestText: '测试文本',
  ttsTest: '测试',
  ttsEnabled: '启用语音合成',
  ttsEnabledDescription: '开启后，课程生成时将自动合成语音',

  // ASR Settings
  asrSettings: '语音识别设置',
  asrProvider: 'ASR 提供商',
  asrLanguage: '识别语言',
  asrEnabled: '启用语音识别',
  asrEnabledDescription: '开启后，学生可使用麦克风进行语音输入',

  // Image Settings
  imageSettings: '图像生成设置',
  imageProvider: '图像提供商',
  imageEnabled: '启用图像生成',
  imageEnabledDescription: '开启后，课程生成时将自动生成配图',

  // Video Settings
  videoSettings: '视频生成设置',
  videoProvider: '视频提供商',
  videoEnabled: '启用视频生成',
  videoEnabledDescription: '开启后，课程生成时将自动生成视频',

  // Agent Settings
  agentSettings: '智能体设置',
  agentMode: '智能体模式',
  singleAgentMode: '单智能体模式',
  multiAgentMode: '多智能体模式',
  agentCount: '智能体数量',

  // Connection Test
  testConnection: '测试连接',
  testing: '测试中...',
  connectionSuccess: '连接成功',
  connectionFailed: '连接失败',

  // Provider names
  providerOpenAI: 'OpenAI',
  providerAnthropic: 'Claude',
  providerGoogle: 'Google Gemini',
  providerDeepSeek: 'DeepSeek',
  providerQwen: '通义千问',
  providerKimi: 'Kimi',
  providerMiniMax: 'MiniMax',
  providerGLM: 'GLM',
  providerDoubao: '豆包',
  providerOllama: 'Ollama（本地）',

  // Danger Zone
  dangerZone: '危险操作',
  clearCache: '清空缓存',
  clearCacheConfirm: '确认清空',

  // Misc
  noResults: '无结果',
  notConfigured: '未配置',
  configured: '已配置',
  enabled: '已启用',
  disabled: '已禁用',
};

// Settings translations - English
export const settingsEnUS = {
  general: 'General',
  system: 'System',
  language: 'Language',
  languageDescription: 'Select interface language',
  theme: 'Theme',
  themeDescription: 'Select theme mode',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  save: 'Save',
  saveSuccess: 'Saved successfully',
  saveFailed: 'Failed to save',
  cancel: 'Cancel',
  close: 'Close',
  delete: 'Delete',
  edit: 'Edit',
  add: 'Add',
  reset: 'Reset',
  confirm: 'Confirm',
  loading: 'Loading...',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  info: 'Info',
  required: 'Required',
  optional: 'Optional',

  // API Keys and Configuration
  apiConfiguration: 'API Configuration',
  apiKey: 'API Key',
  apiKeyDescription: 'Configure your API key',
  apiKeyPlaceholder: 'Enter API key',
  apiKeyRequired: 'API key is required',
  baseUrl: 'Base URL',
  baseUrlDescription: 'API request URL',
  baseUrlPlaceholder: 'Enter Base URL',

  // Model Settings
  modelSettings: 'Model Settings',
  selectModel: 'Select Model',
  defaultModel: 'Default Model',
  modelName: 'Model Name',
  modelId: 'Model ID',
  modelCapabilities: 'Capabilities',
  visionCapability: 'Vision',
  toolsCapability: 'Tools',
  streamingCapability: 'Streaming',
  contextWindow: 'Context Window',
  maxOutputTokens: 'Max Output',

  // TTS Settings
  ttsSettings: 'Text-to-Speech Settings',
  ttsProvider: 'TTS Provider',
  ttsVoice: 'Voice',
  ttsSpeed: 'Speed',
  ttsLanguage: 'Language',
  ttsTestText: 'Test Text',
  ttsTest: 'Test',
  ttsEnabled: 'Enable TTS',
  ttsEnabledDescription: 'Enable automatic speech synthesis during course generation',

  // ASR Settings
  asrSettings: 'Speech Recognition Settings',
  asrProvider: 'ASR Provider',
  asrLanguage: 'Language',
  asrEnabled: 'Enable ASR',
  asrEnabledDescription: 'Enable microphone input for students',

  // Image Settings
  imageSettings: 'Image Generation Settings',
  imageProvider: 'Image Provider',
  imageEnabled: 'Enable Image Generation',
  imageEnabledDescription: 'Enable automatic image generation during course generation',

  // Video Settings
  videoSettings: 'Video Generation Settings',
  videoProvider: 'Video Provider',
  videoEnabled: 'Enable Video Generation',
  videoEnabledDescription: 'Enable automatic video generation during course generation',

  // Agent Settings
  agentSettings: 'Agent Settings',
  agentMode: 'Agent Mode',
  singleAgentMode: 'Single Agent Mode',
  multiAgentMode: 'Multi-Agent Mode',
  agentCount: 'Agent Count',

  // Connection Test
  testConnection: 'Test Connection',
  testing: 'Testing...',
  connectionSuccess: 'Connection successful',
  connectionFailed: 'Connection failed',

  // Provider names
  providerOpenAI: 'OpenAI',
  providerAnthropic: 'Claude',
  providerGoogle: 'Google Gemini',
  providerDeepSeek: 'DeepSeek',
  providerQwen: 'Qwen',
  providerKimi: 'Kimi',
  providerMiniMax: 'MiniMax',
  providerGLM: 'GLM',
  providerDoubao: 'Doubao',
  providerOllama: 'Ollama (Local)',

  // Danger Zone
  dangerZone: 'Danger Zone',
  clearCache: 'Clear Cache',
  clearCacheConfirm: 'Confirm Clear',

  // Misc
  noResults: 'No results',
  notConfigured: 'Not configured',
  configured: 'Configured',
  enabled: 'Enabled',
  disabled: 'Disabled',
};
