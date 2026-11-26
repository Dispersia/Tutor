import { expect, setSystemTime, test } from 'bun:test'
import type { CardId, UserId } from '../../ids'
import { noteIssued, wasIssued } from './issued'

const user = (id: string) => id as UserId
const card = (id: string) => id as CardId

test('a member with no issued drills on record fails open', () => {
  expect(wasIssued(user('issued-never-seen'), card('c1'), 'multiple_choice')).toBe(true)
})

test('once a member has been issued a drill only that drill passes the guard', () => {
  const id = user('issued-guard-user')
  noteIssued(id, { cardId: 'c1', exerciseId: 'multiple_choice' })
  expect(wasIssued(id, card('c1'), 'multiple_choice')).toBe(true)
  expect(wasIssued(id, card('c2'), 'multiple_choice')).toBe(false)
  expect(wasIssued(id, card('c1'), 'type_listen')).toBe(false)
})

test('an expired issued drill fails closed', () => {
  const id = user('issued-expired-user')
  noteIssued(id, { cardId: 'c1', exerciseId: 'multiple_choice' })
  setSystemTime(Date.now() + 61 * 60_000)
  try {
    expect(wasIssued(id, card('c1'), 'multiple_choice')).toBe(false)
  } finally {
    setSystemTime()
  }
})
