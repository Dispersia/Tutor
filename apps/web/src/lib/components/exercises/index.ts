import type { Component } from 'svelte'
import Converse from './Converse.svelte'
import Grammar from './Grammar.svelte'
import Introduce from './Introduce.svelte'
import MultipleChoice from './MultipleChoice.svelte'
import SentenceBuild from './SentenceBuild.svelte'
import SpeakWord from './SpeakWord.svelte'
import Translate from './Translate.svelte'
import TypeListen from './TypeListen.svelte'

/**
 * Frontend half of the exercise registry (DESIGN §11.2): `id -> component`.
 * Adding an exercise = a new component + a line here + a backend def.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const map: Record<string, Component<any>> = {
  introduce: Introduce,
  'translate.front_to_back': Translate,
  'translate.back_to_front': Translate,
  multiple_choice: MultipleChoice,
  type_listen: TypeListen,
  speak_word: SpeakWord,
  converse: Converse,
  sentence_build: SentenceBuild,
  grammar_cloze: Grammar,
}

export function componentFor(exerciseId: string): Component<any> {
  return map[exerciseId] ?? Translate
}

export const exerciseIds = Object.keys(map)
