import type { Card, ExerciseContext, ExerciseDef, ExerciseInstance } from '@tutor/core'
import { registry } from './index'
import { payloadString } from './payload'
import { answerRepeatsPrompt, promptEndsAtBlank } from './shared'

const CHECKABLE = new Set([
  'multiple_choice',
  'grammar_cloze',
  'sentence_build',
  'translate.front_to_back',
  'translate.back_to_front',
  'type_listen',
])

export interface CardVerdict {
  ok: boolean
  failures: string[]
}

export async function verifyCard(ctx: ExerciseContext): Promise<CardVerdict> {
  const failures: string[] = []
  for (const def of drillsFor(ctx)) {
    const failure = await drillFails(def, ctx)
    if (failure) failures.push(`${def.id}: ${failure}`)
  }
  return { ok: failures.length === 0, failures }
}

export async function drillFails(
  def: ExerciseDef<unknown>,
  ctx: ExerciseContext,
): Promise<string | undefined> {
  if (def.id === 'grammar_cloze' && blankRepeatsAnswer(ctx.card))
    return 'the answer repeats the prompt'
  if (def.id === 'grammar_cloze' && promptEndsAtBlank(grammarPrompt(ctx.card)))
    return 'the prompt ends at the blank'
  const instance = await generateOrFail(def, ctx)
  if (typeof instance === 'string') return instance
  const expected = expectedAnswer(def.id, ctx.card, instance)
  if (!offersAnswer(instance, expected)) return 'the right answer is not offered'
  const graded = await def.grade(ctx, instance, expected as never)
  return graded.correct ? undefined : 'the right answer grades wrong'
}

function blankRepeatsAnswer(card: Card): boolean {
  const answer = payloadString(card, 'answer') ?? card.back
  return answerRepeatsPrompt(grammarPrompt(card), answer)
}

function grammarPrompt(card: Card): string {
  return payloadString(card, 'prompt') ?? card.front
}

function generateOrFail(
  def: ExerciseDef<unknown>,
  ctx: ExerciseContext,
): Promise<ExerciseInstance | string> {
  return def.generate(ctx).catch(() => 'the drill could not be built')
}

function drillsFor(ctx: ExerciseContext): ExerciseDef<unknown>[] {
  return registry
    .forCard(ctx.card, ctx.learner)
    .filter((def) => CHECKABLE.has(def.id) && (!def.available || def.available(ctx)))
}

function expectedAnswer(id: string, card: Card, instance: ExerciseInstance): unknown {
  if (id === 'sentence_build') return (instance.data.tokens as string[] | undefined) ?? []
  if (id === 'grammar_cloze') return payloadString(card, 'answer') ?? card.back
  if (id === 'translate.back_to_front') return card.front
  return card.back
}

function offersAnswer(instance: ExerciseInstance, expected: unknown): boolean {
  const choices = instance.data.options ?? instance.data.choices
  if (Array.isArray(choices) && !choices.includes(answerOf(expected))) return false
  if (!Array.isArray(expected)) return true
  const bank = instance.data.bank
  return !Array.isArray(bank) || expected.every((token) => bank.includes(token))
}

function answerOf(expected: unknown): string {
  return Array.isArray(expected) ? expected.join('') : String(expected ?? '')
}
