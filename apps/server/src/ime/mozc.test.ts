import { describe, expect, test } from 'bun:test'
import { responseWords } from './mozc'

const WINDOW =
  '((emacs-event-id . 2)(emacs-session-id . 1)(output . ((id . "1")(preedit . ((cursor . 3)(segment ((annotation . underline)(value . "あなた")(value-length . 3)(key . "あなた")))))(candidate-window . ((size . 2)(candidate ((index . 0)(value . "あなた")(id . 0))((index . 1)(value . "貴方")(id . 1)))(position . 0))))))'

const WORDS =
  '((emacs-event-id . 3)(emacs-session-id . 1)(output . ((preedit . ((cursor . 6)(segment ((annotation . highlight)(value . "あなたは")(value-length . 4)))))(all-candidate-words . ((focused-index . 0)(candidates ((id . 0)(index . 0)(value . "あなたは"))((id . 1)(index . 1)(value . "貴方は"))))))))'

describe('mozc responses', () => {
  test('candidates come out of the candidate window', () => {
    expect(responseWords(WINDOW)).toEqual(['あなた', '貴方'])
  })

  test('candidates come out of the all-candidate-words list', () => {
    expect(responseWords(WORDS)).toEqual(['あなたは', '貴方は'])
  })

  test('an empty output has no candidates', () => {
    expect(responseWords('((output . ()))')).toEqual([])
  })
})
