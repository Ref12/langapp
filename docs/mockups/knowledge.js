// Legacy fixture flags seed reading only. Live knowledge has four independent skills.
const knowledgeSkills = ['hearing', 'speaking', 'reading', 'writing']
const knowledgeStages = ['Not studied', 'Introduced', 'Practicing', 'Learned', 'Mastered']
const knowledgeProfileOwners = new WeakMap()
const knowledgeVocabulary = new Map()
function knowledgeFor(item) {
  if (!item.skills) {
    item.skills = Object.fromEntries(knowledgeSkills.map((skill) => [skill, {
      state: skill === 'reading' ? item.learned ? 'Learned' : item.tracked ? 'Practicing' : 'Not studied' : 'Not studied',
      evidence: '',
    }]))
  }
  return item.skills
}
function knowledgeSkillLabel(skill) {
  return skill[0].toUpperCase() + skill.slice(1)
}
function wordReadingLearned(word) {
  return ['Learned', 'Mastered'].includes(knowledgeFor(word).reading.state)
}
function vocabularyKnowledgeOwner(native, lang = 'zh-Hans') {
  const word = Object.values(words).find((item) => item.native === native && (item.nativeLanguage || 'zh-Hans') === lang)
  if (word) return word
  const key = `${lang}:${native}`
  if (!knowledgeVocabulary.has(key)) knowledgeVocabulary.set(key, { native })
  return knowledgeVocabulary.get(key)
}
function objectiveKnowledgeOwner(objective) {
  return objective.kind === 'Vocabulary' ? vocabularyKnowledgeOwner(objective.native) : objective
}
function recordReadingEvidence(item, stage, evidence) {
  const reading = knowledgeFor(item).reading
  if (knowledgeStages.indexOf(stage) > knowledgeStages.indexOf(reading.state)) reading.state = stage
  reading.evidence = evidence
}
function renderKnowledgeProfile(profile, item) {
  profile.dataset.knowledgeProfile = ''
  profile.classList.add('knowledge-profile')
  profile.setAttribute('aria-label', 'Separate learning states for hearing, speaking, reading, and writing')
  profile.replaceChildren()
  knowledgeProfileOwners.set(profile, item)
  for (const skill of knowledgeSkills) {
    const status = knowledgeFor(item)[skill]
    const entry = document.createElement('div')
    const label = document.createElement('dt')
    label.textContent = knowledgeSkillLabel(skill)
    const value = document.createElement('dd')
    value.textContent = status.state
    value.dataset.skill = skill
    if (status.evidence) value.title = status.evidence
    entry.append(label, value)
    profile.append(entry)
  }
}
function createKnowledgeProfile(item) {
  const profile = document.createElement('dl')
  renderKnowledgeProfile(profile, item)
  return profile
}
function refreshKnowledgeProfiles() {
  for (const profile of document.querySelectorAll('[data-knowledge-profile]')) renderKnowledgeProfile(profile, knowledgeProfileOwners.get(profile))
}
