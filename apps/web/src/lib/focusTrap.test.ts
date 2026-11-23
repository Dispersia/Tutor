import { expect, test } from 'bun:test'
import { wrapTarget } from './focusTrap'

test('Tab wraps from the last control to the first, Shift+Tab the other way', () => {
  const items = ['a', 'b', 'c']
  expect(wrapTarget(items, 'c', false)).toBe('a')
  expect(wrapTarget(items, 'a', true)).toBe('c')
})

test('Tab in the middle is left to the browser', () => {
  expect(wrapTarget(['a', 'b', 'c'], 'b', false)).toBeUndefined()
  expect(wrapTarget(['a', 'b', 'c'], 'b', true)).toBeUndefined()
})

test('focus outside the controls (the dialog itself, or the page) is pulled in', () => {
  expect(wrapTarget(['a', 'b'], null, false)).toBe('a')
  expect(wrapTarget(['a', 'b'], null, true)).toBe('b')
  expect(wrapTarget([], null, false)).toBeUndefined()
})
