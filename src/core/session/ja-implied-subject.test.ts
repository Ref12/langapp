// @vitest-environment node
import { describeImpliedSubject } from './implied-subject.shared'

describeImpliedSubject({
  language: 'ja',
  flagged: ['勉強します。', '中国語を勉強します。', '家で勉強します。'],
  stated: ['私は勉強します。', '学生は勉強します。', '先生は勉強します。'],
  timeTopic: { zh: '木曜日は勉強します。', en: 'I study on Thursdays.' },
  question: { zh: '勉強します。', en: 'You study.', shown: '(You) study.' },
  dropped: '勉強します。',
  twin: '私は勉強します。',
  allowed: '学生は勉強します。',
  bracketed: { zh: '家で勉強します。', en: 'I study at home.', shown: '(I) study at home.' },
})
