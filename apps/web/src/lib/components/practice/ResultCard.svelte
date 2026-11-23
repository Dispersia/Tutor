<script lang="ts">
  import { ACCENT } from '#lib/theme'
  import { reviewLabel } from '#lib/practiceview'
  import type { Grade, SrsOutcome, WordFeedback } from '#lib/exercises'

  interface Props {
    result: Grade
    words: WordFeedback[]
    srs: SrsOutcome | null
    canRetry: boolean
    attempt: number
  }

  let { result, words, srs, canRetry, attempt }: Props = $props()
</script>

<div class="panel panel-accent p-5" style="--accent: {result.correct ? ACCENT.jade : ACCENT.brass}">
  <div class="flex items-baseline justify-between">
    <span class="display text-lg {result.correct ? 'text-jade-300' : 'text-brass-300'}">
      {result.correct ? '✓ Correct' : '✗ Not quite'}
    </span>
    <span class="text-sm text-ink-300">{result.score}/100</span>
  </div>
  {#if result.expected}
    <p class="mt-2 text-sm text-ink-300">
      Answer: <span class="display text-lg text-ink-100">{result.expected}</span>
    </p>
  {/if}
  {#if result.feedback}
    <p class="mt-1 text-sm text-ink-400">{result.feedback}</p>
  {/if}
  {#if words.length}
    <div class="mt-3 flex flex-wrap gap-2">
      {#each words as w, i (i)}
        <span class="chip" style="--accent: {w.ok ? ACCENT.jade : ACCENT.ember}">
          {w.text}{w.tip ? ` · ${w.tip}` : ''}
        </span>
      {/each}
    </div>
  {/if}
  {#if srs}
    <p class="mt-3 text-xs text-ink-400">
      Next review <span class="gold">{reviewLabel(srs)}</span> · stability
      {srs.stability.toFixed(1)}d · difficulty {srs.difficulty.toFixed(1)}
    </p>
  {/if}
  {#if canRetry}
    <p class="mt-3 text-xs text-ink-400">
      Attempt {attempt} · say it again until it lands, or move on.
    </p>
  {/if}
</div>
