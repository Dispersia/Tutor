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
export { answerText } from './grading'

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
    disabled: Boolean(d.temporarilyDisabled),
    template: templateForExercise(d.id)?.kind,
  }))
}
