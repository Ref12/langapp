// A deliberately small, authored map: these are not official HSK tier assignments.
const learningTier = { id: 'hsk2', label: 'HSK 2', language: 'Mandarin' }
const learningUnits = [
  { id: 'introductions', title: 'Getting acquainted', lessons: ['greetings', 'introductions'], targets: ['hello', 'thanks', 'name', 'person'] },
  { id: 'exchanges', title: 'Everyday exchanges', lessons: ['questions', 'family'], targets: ['question', 'number', 'family', 'possession'] },
  { id: 'requests', title: 'Everyday requests', lessons: ['request', 'again'], targets: ['tea', 'want', 'cup', 'again'] },
  { id: 'plans', title: 'Making plans', lessons: ['plans', 'time-order'], targets: ['tomorrow', 'go', 'park', 'time-order'] },
  { id: 'places', title: 'Finding places', lessons: ['directions', 'nearby'], targets: ['station', 'where', 'location', 'nearby'] },
  { id: 'conversation', title: 'Keeping a conversation going', lessons: ['repeat', 'slower'], targets: ['understand', 'repeat', 'slower', 'clarify'] },
]
const learningObjectives = new Map([
  ['hello', 'A greeting', 'Vocabulary', '\u4f60\u597d', 'hello'],
  ['thanks', 'A polite thank-you', 'Vocabulary', '\u8c22\u8c22', 'thank you'],
  ['name', 'Introduce your name', 'Grammar', '\u6211\u53eb\u5c0f\u6797\u3002', 'My name is Xiaolin.'],
  ['person', 'Identify a person', 'Grammar', '\u6211\u662f\u5b66\u751f\u3002', 'I am a student.'],
  ['question', 'Ask a yes/no question', 'Grammar', '\u4f60\u559d\u8336\u5417\uff1f', 'Do you drink tea?'],
  ['number', 'Recognize a small number', 'Vocabulary', '\u4e09', 'three'],
  ['family', 'Talk about family', 'Vocabulary', '\u5bb6\u4eba', 'family members'],
  ['possession', 'Express possession', 'Grammar', '\u6211\u7684\u5bb6\u4eba', 'my family members'],
  ['tea', 'Name a familiar drink', 'Vocabulary', '\u8336', 'tea'],
  ['want', 'Say what you would like', 'Grammar', '\u6211\u60f3\u559d\u8336\u3002', 'I would like to drink tea.'],
  ['cup', 'Use a cup measure word', 'Grammar', '\u4e00\u676f\u8336', 'a cup of tea'],
  ['again', 'Ask for something again', 'Grammar', '\u518d\u559d\u4e00\u676f\u8336', 'drink another cup of tea'],
  ['tomorrow', 'Talk about tomorrow', 'Vocabulary', '\u660e\u5929', 'tomorrow'],
  ['go', 'Describe going somewhere', 'Vocabulary', '\u53bb', 'go'],
  ['park', 'Name a destination', 'Vocabulary', '\u516c\u56ed', 'park'],
  ['time-order', 'Place time before the action', 'Grammar', '\u6211\u660e\u5929\u53bb\u516c\u56ed\u3002', 'I am going to the park tomorrow.'],
  ['station', 'Name a station', 'Vocabulary', '\u8f66\u7ad9', 'station'],
  ['where', 'Ask where a place is', 'Grammar', '\u8f66\u7ad9\u5728\u54ea\u91cc\uff1f', 'Where is the station?'],
  ['location', 'Describe a location', 'Grammar', '\u6211\u5728\u8f66\u7ad9\u3002', 'I am at the station.'],
  ['nearby', 'Say something is nearby', 'Vocabulary', '\u9644\u8fd1', 'nearby'],
  ['understand', 'Say you did not understand', 'Grammar', '\u6211\u6ca1\u542c\u61c2\u3002', 'I did not understand what I heard.'],
  ['repeat', 'Ask for a repetition', 'Grammar', '\u8bf7\u518d\u8bf4\u4e00\u904d\u3002', 'Please say it again.'],
  ['slower', 'Ask someone to slow down', 'Grammar', '\u8bf7\u8bf4\u6162\u4e00\u70b9\u3002', 'Please speak a little more slowly.'],
  ['clarify', 'Ask what something means', 'Grammar', '\u8fd9\u662f\u4ec0\u4e48\u610f\u601d\uff1f', 'What does this mean?'],
].map(([id, label, kind, native, meaning]) => [id, { id, label, kind, native, meaning }]))

const learningAuthoredLessons = {
  greetings: {
    title: 'Greet someone and say thanks', objective: 'Begin a brief exchange politely.',
    native: '\u4f60\u597d\uff01\u8c22\u8c22\u4f60\u3002', romanization: 'N\u01d0 h\u01ceo! Xi\u00e8xie n\u01d0.', meaning: 'Hello! Thank you.',
    pattern: '\u4f60\u597d is a greeting. \u8c22\u8c22\u4f60 directly thanks the person you are speaking to.',
    usage: 'Try the greeting at the beginning of an exchange and the thank-you after someone helps you.',
    words: [['\u4f60\u597d', 'n\u01d0 h\u01ceo', 'hello'], ['\u8c22\u8c22', 'xi\u00e8xie', 'thank you']],
  },
  introductions: {
    title: 'Introduce yourself', objective: 'Give your name and say a little about yourself.',
    native: '\u6211\u53eb\u5c0f\u6797\u3002\u6211\u662f\u5b66\u751f\u3002', romanization: 'W\u01d2 ji\u00e0o Xi\u01ceol\u00edn. W\u01d2 sh\u00ec xu\u00e9sheng.', meaning: 'My name is Xiaolin. I am a student.',
    pattern: '\u6211\u53eb + name introduces your name. \u6211\u662f + role describes who you are.',
    usage: 'Use your own name in the first pattern. The student example is a sample identity, not your profile.',
    words: [['\u53eb', 'ji\u00e0o', 'be called'], ['\u5b66\u751f', 'xu\u00e9sheng', 'student']],
  },
  questions: {
    title: 'Ask a small question', objective: 'Use a yes/no question and recognize a small quantity.',
    native: '\u4f60\u559d\u8336\u5417\uff1f\u6211\u6709\u4e09\u676f\u8336\u3002', romanization: 'N\u01d0 h\u0113 ch\u00e1 ma? W\u01d2 y\u01d2u s\u0101n b\u0113i ch\u00e1.', meaning: 'Do you drink tea? I have three cups of tea.',
    pattern: 'Add \u5417 to a statement to make a yes/no question. \u4e09 means three.',
    usage: 'Notice that the number comes before the measure word and the drink.',
    words: [['\u5417', 'ma', 'yes/no question particle'], ['\u4e09', 's\u0101n', 'three']],
  },
  family: {
    title: 'Talk about your family', objective: 'Name your family and connect it to yourself.',
    native: '\u8fd9\u662f\u6211\u7684\u5bb6\u4eba\u3002', romanization: 'Zh\u00e8 sh\u00ec w\u01d2 de ji\u0101r\u00e9n.', meaning: 'These are my family members.',
    pattern: '\u6211\u7684 + noun means my + noun. \u7684 connects the person to what follows.',
    usage: 'Use this sentence when introducing family members or showing a photograph.',
    words: [['\u5bb6\u4eba', 'ji\u0101r\u00e9n', 'family members'], ['\u7684', 'de', 'possessive particle']],
  },
  again: {
    title: 'Ask for one more', objective: 'Extend a familiar request to ask for another cup.',
    native: '\u6211\u60f3\u518d\u559d\u4e00\u676f\u8336\u3002', romanization: 'W\u01d2 xi\u01ceng z\u00e0i h\u0113 y\u00ec b\u0113i ch\u00e1.', meaning: 'I would like to drink another cup of tea.',
    pattern: 'Place \u518d before the action: \u518d\u559d means drink again.',
    usage: 'The same request pattern now expresses repetition. Previously covered words do not count twice.',
    words: [['\u518d', 'z\u00e0i', 'again'], ['\u559d', 'h\u0113', 'drink']],
  },
  'time-order': {
    title: 'Put a plan in time', objective: 'Place tomorrow before the main action.',
    native: '\u6211\u660e\u5929\u53bb\u516c\u56ed\u3002', romanization: 'W\u01d2 m\u00edngti\u0101n q\u00f9 g\u014dngyu\u00e1n.', meaning: 'I am going to the park tomorrow.',
    pattern: 'Person + time + action: \u6211 + \u660e\u5929 + \u53bb\u516c\u56ed.',
    usage: 'The time word gives the sentence its future context. The verb itself does not need a future ending.',
    words: [['\u660e\u5929', 'm\u00edngti\u0101n', 'tomorrow'], ['\u53bb', 'q\u00f9', 'go']],
  },
  nearby: {
    title: 'Describe where you are', objective: 'Locate yourself and recognize nearby.',
    native: '\u6211\u5728\u8f66\u7ad9\u3002\u516c\u56ed\u5728\u9644\u8fd1\u3002', romanization: 'W\u01d2 z\u00e0i ch\u0113zh\u00e0n. G\u014dngyu\u00e1n z\u00e0i f\u00f9j\u00ecn.', meaning: 'I am at the station. The park is nearby.',
    pattern: 'Person or place + \u5728 + location describes where something is.',
    usage: 'Contrast a location statement with the earlier question using where.',
    words: [['\u5728', 'z\u00e0i', 'at / located at'], ['\u9644\u8fd1', 'f\u00f9j\u00ecn', 'nearby']],
  },
  repeat: {
    title: 'Ask to hear it again', objective: 'Keep an exchange going when you did not understand.',
    native: '\u6211\u6ca1\u542c\u61c2\u3002\u8bf7\u518d\u8bf4\u4e00\u904d\u3002', romanization: 'W\u01d2 m\u00e9i t\u012bngd\u01d2ng. Q\u01d0ng z\u00e0i shu\u014d y\u00ed bi\u00e0n.', meaning: 'I did not understand what I heard. Please say it again.',
    pattern: '\u6ca1\u542c\u61c2 describes not having understood. \u8bf7 makes the repetition request polite.',
    usage: 'This is a useful way to ask for help without ending the conversation.',
    words: [['\u542c\u61c2', 't\u012bngd\u01d2ng', 'understand what is heard'], ['\u4e00\u904d', 'y\u00ed bi\u00e0n', 'one time through']],
  },
  slower: {
    title: 'Slow down and clarify', objective: 'Ask for a slower pace or the meaning of something.',
    native: '\u8bf7\u8bf4\u6162\u4e00\u70b9\u3002\u8fd9\u662f\u4ec0\u4e48\u610f\u601d\uff1f', romanization: 'Q\u01d0ng shu\u014d m\u00e0n y\u00ecdi\u01cen. Zh\u00e8 sh\u00ec sh\u00e9nme y\u00ecsi?', meaning: 'Please speak a little more slowly. What does this mean?',
    pattern: '\u6162\u4e00\u70b9 means a little slower. \u4ec0\u4e48\u610f\u601d asks what something means.',
    usage: 'Use either request when needed; you do not need to finish the path before using these phrases.',
    words: [['\u6162', 'm\u00e0n', 'slow'], ['\u610f\u601d', 'y\u00ecsi', 'meaning']],
  },
  'cafe-request': {
    ...lessonPreviews.request, title: 'Order a drink at a cafe', source: false,
    objective: 'Use a familiar request to order tea at a cafe.',
  },
  preferences: {
    title: 'Order without sugar', objective: 'Make your drink order fit your preferences.',
    native: '\u8bf7\u4e0d\u8981\u52a0\u7cd6\u3002', romanization: 'Q\u01d0ng b\u00fa y\u00e0o ji\u0101 t\u00e1ng.', meaning: 'Please do not add sugar.',
    pattern: '\u4e0d\u8981 + action asks someone not to do something. \u52a0\u7cd6 means add sugar.',
    usage: 'This extends your personal cafe goal beyond the objectives in this small sample tier.',
    words: [['\u52a0', 'ji\u0101', 'add'], ['\u7cd6', 't\u00e1ng', 'sugar']],
  },
}
Object.assign(lessonPreviews, learningAuthoredLessons)

// Mapping is separate from lesson objects so imported/generated fixture copies cannot inherit tier credit.
const learningLessonTargets = new Map([
  ['greetings', ['hello', 'thanks']], ['introductions', ['name', 'person']],
  ['questions', ['question', 'number']], ['family', ['family', 'possession']],
  ['request', ['tea', 'want', 'cup']], ['cafe-request', ['tea', 'want', 'cup']], ['again', ['again']],
  ['plans', ['tomorrow', 'go', 'park']], ['time-order', ['time-order']],
  ['directions', ['station', 'where']], ['nearby', ['location', 'nearby']],
  ['repeat', ['understand', 'repeat']], ['slower', ['slower', 'clarify']],
])
const learningGoals = new Map([
  ['cafe', { id: 'cafe', title: 'Order at a cafe', request: 'Order a drink, ask for another, and explain how I like it.', lessonIds: ['cafe-request', 'again', 'preferences'] }],
  ['weekend', { id: 'weekend', title: 'Plan a day out', request: 'Talk about tomorrow and ask where the station is.', lessonIds: ['plans', 'directions'] }],
])
const learningCovered = new Set([...learningObjectives.keys()].slice(0, 9))
const learningCompletedLessons = new Set(['greetings', 'introductions', 'questions', 'family'])
const learningDemonstrated = new Set(['hello', 'thanks', 'name', 'person'])
const learningReview = new Set(['question', 'number', 'possession'])
const learningCheckpoints = new Map([['introductions', { correct: ['hello', 'thanks', 'name', 'person'], total: 4 }]])
for (const id of learningCovered) recordReadingEvidence(objectiveKnowledgeOwner(learningObjectives.get(id)), 'Introduced', 'Seeded sample reading exposure.')
for (const id of learningDemonstrated) recordReadingEvidence(objectiveKnowledgeOwner(learningObjectives.get(id)), 'Practicing', 'Seeded sample reading checkpoint recognition.')
