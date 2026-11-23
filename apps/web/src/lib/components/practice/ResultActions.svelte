<script lang="ts">
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import ResultCard from '#lib/components/practice/ResultCard.svelte'
  import type { Grade, SrsOutcome, WordFeedback } from '#lib/exercises'

  interface Props {
    result: Grade
    words: WordFeedback[]
    srs: SrsOutcome | null
    canRetry: boolean
    attempt: number
    lessonCompleted: boolean
    nextLessonId: string | undefined
    nextLessonTitle: string
    advancing: boolean
    onRetry: () => void
    onNext: () => void
  }

  let {
    result,
    words,
    srs,
    canRetry,
    attempt,
    lessonCompleted,
    nextLessonId,
    nextLessonTitle,
    advancing,
    onRetry,
    onNext,
  }: Props = $props()
</script>

<ResultCard {result} {words} {srs} {canRetry} {attempt} />
{#if canRetry}
  <div class="mt-4 flex flex-col gap-2">
    <button onclick={onRetry} class="btn btn-primary w-full py-3">
      <Icon name="mic" size={15} /> Try again
    </button>
    <button onclick={onNext} disabled={advancing} class="btn btn-ghost w-full py-3">
      {#if advancing}<Spinner size={15} label="Loading the next card" />{:else}Next →{/if}
    </button>
  </div>
{:else if lessonCompleted && nextLessonId}
  <button onclick={onNext} disabled={advancing} class="btn btn-primary mt-4 w-full py-3">
    {#if advancing}<Spinner size={15} label="Loading the next lesson" />{:else}Next lesson →
      {nextLessonTitle ? ` ${nextLessonTitle}` : ''}{/if}
  </button>
{:else if !lessonCompleted}
  <button onclick={onNext} disabled={advancing} class="btn btn-primary mt-4 w-full py-3">
    {#if advancing}<Spinner size={15} label="Loading the next card" />{:else}Next →{/if}
  </button>
{/if}
