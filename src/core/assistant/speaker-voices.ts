import { isEdgeVoice, type SpeechVoicePreference } from './contracts'
import { browserVoiceMatches, selectedSpeechVoice, type SpeechOptions } from './speech'

// A female and a male voice for a two-speaker conversation. Order of preference: when the learner chose an Edge voice, the Edge Mandarin voice of each gender; else a browser
// Chinese voice whose name says its gender (a different one per gender); else the one chosen/default voice at a lower and a higher pitch, so the speakers still sound different.

export type Gender = 'female' | 'male'
const FEMALE = /xiaoxiao|xiaoyi|xiaobei|huihui|yaoyao|tingting|ting-ting|meijia|mei-jia|sinji|hsiao|xiaochen|female|woman|婷|慧|晓|曉|美/i
const MALE = /yunxi|yunyang|yunjian|kangkang|zhiwei|danny|male|man\b|云|雲|康/i
export const PITCH: Record<Gender, number> = { female: 1.3, male: 0.7 }

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'voiceURI' | 'lang' | 'localService'>
const genderOf = (voice: VoiceLike): Gender | undefined => /\bfemale\b/i.test(voice.name) || (FEMALE.test(voice.name) && !/\bmale\b/i.test(voice.name)) ? 'female' : MALE.test(voice.name) ? 'male' : undefined

/** The voice options of a speaker: `voices` is the browser's list (empty when it has none yet), `selected` the learner's Settings choice. Pure, so it can be tested. */
export function voiceFor(gender: Gender, voices: readonly VoiceLike[], selected?: SpeechVoicePreference): SpeechOptions {
  if (isEdgeVoice(selected)) return { voice: { provider: 'edge', voice: gender === 'female' ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunxiNeural' } }
  const chinese = voices.filter(voice => browserVoiceMatches(voice, 'zh-Hans'))
  const mine = chinese.find(voice => genderOf(voice) === gender)
  const other = chinese.find(voice => genderOf(voice) === (gender === 'female' ? 'male' : 'female'))
  // Use a voice of this gender only when the device has voices of both genders to tell apart; otherwise the pitch does the work.
  if (mine && other) return { voice: { voiceURI: mine.voiceURI, name: mine.name, lang: mine.lang, localService: mine.localService } }
  return { pitch: PITCH[gender] }
}

export function speakerOptions(gender: Gender): SpeechOptions {
  const voices = typeof window !== 'undefined' && window.speechSynthesis ? (() => { try { return window.speechSynthesis.getVoices() } catch { return [] } })() : []
  return voiceFor(gender, voices, selectedSpeechVoice('zh-Hans'))
}
