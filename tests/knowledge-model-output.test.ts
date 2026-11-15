// @vitest-environment node
import { expect, it } from 'vitest'
import { parseKnowledgeModelOutput } from '../electron/knowledge/model-output'
it('repairs only redundant closing braces while preserving every value and rejecting truncation or prose', () => {
  const raw = '{"candidates":[{"answer":"不是防水件🛠️ }", "field":"fact"}}]}'
  expect(parseKnowledgeModelOutput(raw)).toEqual({
    value: { candidates: [{ answer: '不是防水件🛠️ }', field: 'fact' }] },
    repaired: '{"candidates":[{"answer":"不是防水件🛠️ }", "field":"fact"}]}',
  })
  for (const bad of [
    '{"candidates":[{"answer":"未完整',
    '{"candidates":[{"answer":"完整"}',
    '说明\n{"candidates":[]}',
    '{candidates:[]}',
    '{"candidates":[{"answer":}]}',
  ])
    expect(() => parseKnowledgeModelOutput(bad)).toThrow()
  expect(parseKnowledgeModelOutput('```json\n{"candidates":[]}\n```').value).toEqual({
    candidates: [],
  })
})
