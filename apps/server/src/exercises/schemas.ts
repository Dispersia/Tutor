export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    correct: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['score', 'correct', 'feedback'],
  additionalProperties: false,
}

export const PRON_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    correct: { type: 'boolean' },
    summary: { type: 'string' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          ok: { type: 'boolean' },
          tip: { type: 'string' },
        },
        required: ['text', 'ok', 'tip'],
        additionalProperties: false,
      },
    },
  },
  required: ['score', 'correct', 'summary', 'words'],
  additionalProperties: false,
}
