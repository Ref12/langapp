// @vitest-environment node
import { describeImpliedSubject } from './implied-subject.shared'

describeImpliedSubject({
  language: 'ko',
  flagged: ['공부해요?', '중국어를 공부해요.'],
  stated: ['저는 공부해요.', '학생은 공부해요.', '선생님은 중국어를 공부해요.'],
  timeTopic: { zh: '내일은 일요일이에요.', en: 'Tomorrow is Sunday.' },
  question: { zh: '조금 추워요.', en: 'I feel a little cold.', shown: '(I) feel a little cold.' },
  dropped: '공부해요.',
  twin: '우리는 조금 추워요.',
  allowed: '대학생은 조금 추워요.',
  bracketed: { zh: '중국어를 공부해요.', en: 'I am learning Chinese.', shown: '(I) am learning Chinese.' },
})
