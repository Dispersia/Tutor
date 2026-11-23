/**
 * The exercise registry: one module per drill, registered here.
 *
 * The drills themselves live in `./defs/*`; the shared helpers (readings, the
 * word view, the payload readers) are in `./shared`, `./payload` and `./seeded`.
 */

import { ExerciseRegistry, templateForExercise } from '@tutor/core'
import { converse } from './defs/converse'
import { grammarCloze } from './defs/grammarCloze'
import { introduce } from './defs/introduce'
import { multipleChoice } from './defs/multipleChoice'
import { sentenceBuild } from './defs/sentenceBuild'
import { speakWord } from './defs/speakWord'
import { translateBackToFront, translateFrontToBack } from './defs/translate'
import { typeListen } from './defs/typeListen'

export { INTRODUCE_ID } from './defs/introduce'

/**
 * The registry. To add an exercise: create the def, `register` it here, and add a
 * matching Svelte component keyed by the same `id` — no core changes (DESIGN §11.2).
 */
export const registry = new ExerciseRegistry()
  .register(introduce)
  .register(translateFrontToBack)
  .register(translateBackToFront)
  .register(multipleChoice)
  .register(typeListen)
  .register(speakWord)
  .register(converse)
  .register(sentenceBuild)
  .register(grammarCloze)

export function exerciseCatalog() {
  return registry.list().map((d) => ({
    id: d.id,
    title: d.title,
    modality: d.modality,
    needsAudio: Boolean(d.needsAudio),
    /** Switched off product-wide for now; the learner cannot turn it on. */
    disabled: Boolean(d.temporarilyDisabled),
    /** The card template this exercise belongs to (vocab, spoken, …). */
    template: templateForExercise(d.id)?.kind,
  }))
}
