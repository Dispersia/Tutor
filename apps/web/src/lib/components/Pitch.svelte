<script lang="ts">
  import type { PitchContour, PitchLevel } from '#lib/types'

  /**
   * Renders a language-agnostic pitch contour over a word (docs/DESIGN.md §11.1)
   * as a step line: the line sits high over high moras and low over low ones, with
   * a vertical step where the level changes. Japanese pitch accent is the first
   * user; tone contours draw the same way.
   */
  let {
    contour,
    fallback = '',
    size = 'md',
  }: { contour?: PitchContour; fallback?: string; size?: 'sm' | 'md' } = $props()

  // Prefer the explicit mora split; otherwise one level per character.
  const moras = $derived(contour?.syllables?.length ? contour.syllables : [...(fallback ?? '')])
  const levels = $derived(contour?.levels ?? [])
  const text = $derived(size === 'sm' ? 'text-sm' : 'text-base')

  const levelAt = (i: number): PitchLevel => levels[i] ?? levels[levels.length - 1] ?? 'L'
</script>

{#if contour && moras.length}
  <span class="inline-flex items-end leading-none" aria-label="pitch accent">
    {#each moras as mora, i (i)}
      {@const level = levelAt(i)}
      {@const next = i + 1 < moras.length ? levelAt(i + 1) : level}
      <span class="flex flex-col items-center">
        <span class="relative h-3 w-full">
          <!-- the line for this mora: high (top) or low (bottom) -->
          <span
            class="absolute inset-x-0 h-[2px] rounded-full bg-seal-300"
            class:top-0={level === 'H'}
            class:bottom-0={level !== 'H'}
          ></span>
          <!-- a step between this mora and the next, when the level changes -->
          {#if next !== level}
            <span class="absolute top-0 bottom-0 -right-px w-[2px] bg-seal-300"></span>
          {/if}
        </span>
        <span class="display {text} mt-1">{mora}</span>
      </span>
    {/each}
  </span>
{/if}
