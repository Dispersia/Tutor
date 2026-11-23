<script lang="ts">
  /** Shown when the day's new/review budget is spent and nothing can be served. */

  import { href } from '#lib/paths'
  import { ACCENT } from '#lib/theme'
  import type { SrsStats } from '#lib/curriculum'

  interface Props {
    srsStats: SrsStats | null
    onStudyMore: () => void
  }

  let { srsStats, onStudyMore }: Props = $props()
</script>

<div class="panel panel-accent p-5 text-center" style="--accent: {ACCENT.jade}">
  <p class="display text-lg text-jade-300">That’s everything for now</p>
  <p class="mt-2 text-sm text-ink-300">
    {#if srsStats?.budget}
      {#if !srsStats.budget.newUnlimited}
        {srsStats.budget.newToday}/{srsStats.budget.newPerDay} new
      {/if}
      {#if !srsStats.budget.newUnlimited && !srsStats.budget.reviewsUnlimited}·{/if}
      {#if !srsStats.budget.reviewsUnlimited}
        {srsStats.budget.reviewsToday}/{srsStats.budget.maxReviewsPerDay} reviews
      {/if}
    {/if}
  </p>
  <p class="mt-1 text-xs text-ink-400">Nothing is due and no new words are left in this deck.</p>
  <div class="mt-4 flex flex-col gap-2">
    <button onclick={onStudyMore} class="btn btn-primary w-full py-3">Study more</button>
    <a href={href('/learn')} class="btn btn-ghost w-full py-3">Back to Learn</a>
  </div>
</div>
