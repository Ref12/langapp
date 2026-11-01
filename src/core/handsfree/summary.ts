/** "Added 5 words and 1 grammar pattern to your knowledge set", from the refs a completed run added. */
export function addedLine(refs: readonly string[] | undefined) {
  const words = refs?.filter(ref => !ref.startsWith('grammar:') && !ref.startsWith('phrase:')).length ?? 0
  const grammar = refs?.filter(ref => ref.startsWith('grammar:')).length ?? 0
  const parts = [words ? `${words} ${words === 1 ? 'word' : 'words'}` : '', grammar ? `${grammar} grammar ${grammar === 1 ? 'pattern' : 'patterns'}` : ''].filter(Boolean)
  return parts.length ? `Added ${parts.join(' and ')} to your knowledge set` : ''
}

