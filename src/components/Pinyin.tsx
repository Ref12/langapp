import { usePinyinFormatter } from './pinyin-context'

export function Pinyin({ text }: { text: string }) {
  return <>{usePinyinFormatter()(text)}</>
}
