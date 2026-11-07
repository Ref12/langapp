/**
 * The grammar points whose pattern is certain enough to tag a user phrase: precision >= 95% over >= 8 tagged authored catalog examples.
 * grammar-match.test.ts recomputes this from the catalog and fails when the list drifts (run it with UPDATE_GRAMMAR_ENABLED=1 to see the new list).
 */
export const ENABLED_GRAMMAR_PATTERNS: readonly string[] = [
  'grammar:s-ba3-obj-v-gei3-p--transfer',
  'grammar:stmt-ma5--yes-no',
]
