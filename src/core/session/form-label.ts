import { getPack } from '../language'
import type { Form } from './types'

/** What the learner reads for an exercise form in this build: the language pack's label (Chinese: FORM_LABEL of types.ts). */
export const formLabel = (form: Form): string => getPack().practiceWording.formLabels[form]
