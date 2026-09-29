import { isAlias, isCollection, isPair, isScalar, parseAllDocuments } from 'yaml'

const INVALID_YAML = 'Invalid YAML. Use one document without duplicate keys, tags, anchors, or aliases.'

function checkNode(node: unknown, depth = 0): void {
  if (depth > 40 || isAlias(node)) throw new Error(INVALID_YAML)
  if (isPair(node)) {
    if (!isScalar(node.key) || typeof node.key.value !== 'string') throw new Error(INVALID_YAML)
    checkNode(node.key, depth + 1)
    checkNode(node.value, depth + 1)
  } else if (isCollection(node) || isScalar(node)) {
    if (node.tag || node.anchor) throw new Error(INVALID_YAML)
    if (isCollection(node)) for (const item of node.items) checkNode(item, depth + 1)
  }
}

export function parsePlainYaml(text: string): unknown {
  try {
    const documents = parseAllDocuments(text, {
      version: '1.2', schema: 'core', uniqueKeys: true, strict: true, prettyErrors: false,
    })
    if (documents.length !== 1) throw new Error(INVALID_YAML)
    const document = documents[0]
    if (document.errors.length || document.warnings.length) throw new Error(INVALID_YAML)
    checkNode(document.contents)
    return document.toJS({ maxAliasCount: 0 })
  } catch {
    // YAML diagnostics can include private source text.
    throw new Error(INVALID_YAML)
  }
}
