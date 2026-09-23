import { createEmptyProfile, serializeProfileYaml } from './codec'
import { DEFAULT_PROFILE_ID } from './identity'

export const PROFILE_TEMPLATE_FILE = 'profile.template.yaml'

export function createProfileTemplate(): string {
  const snapshot = createEmptyProfile({ id: DEFAULT_PROFILE_ID, name: 'default' })
  snapshot.exportedAt = 0
  const yaml = serializeProfileYaml(snapshot)
  return `# LinguaWeave named profile snapshot (YAML 1.2).
# Browser IndexedDB stays live; this file is only a manual snapshot.
# Copy to default.yaml, or use a UUID filename and matching profile.id.
# Each file includes settings, learning progress, and conversations.
# ALL exports include configured AI/Azure credentials. Keep data/ private.
# profile.name is the display name; do not change profile.id after creation.
# settings.preferences contains the complete browser workspace preferences.
# Optional defaultSpeechRate values: 0.5, 0.75, 1, 1.25.
# Optional speechVoices belong inside settings.preferences.
# No network voice/provider is enabled by this blank template.
${yaml.replace('settings:\n', `settings:
  # Optional AI connection; uncomment only after filling every required value.
  # aiConnection:
  #   apiType: responses # responses or chat-completions
  #   baseUrl: https://provider.example/v1
  #   apiKey: '' # Your private API key; exported without redaction.
  #   model: '' # Provider model/deployment name.
  #   nativeTools: false # Enable only for a compatible provider.
  #   structuredOutput: false # Enable only for a compatible provider.
  #   storageAcknowledged: true # Explicit consent to local credential storage.
  # Optional Azure speech connection; independent from the AI connection.
  # speechConnection:
  #   provider: azure
  #   region: eastus
  #   apiKey: '' # Your private Azure Speech key.
  #   storageAcknowledged: true
`)}
# To select voices, add speechVoices under settings.preferences, for example:
#   speechVoices:
#     zh-Hans: { provider: edge, voice: zh-CN-YunjianNeural }
#     en-US: { provider: edge, voice: en-US-ChristopherNeural }
# Edge/Azure voices contact a cloud service only when explicitly used.
`
}
