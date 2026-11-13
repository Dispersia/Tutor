<script lang="ts">
  import { onMount } from 'svelte'
  import { href } from '#lib/paths'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'

  let decks = $state<CurriculumDeck[]>([])
  let stats = $state<SrsStats | null>(null)
  let loading = $state(true)
  let error = $state('')

  onMount(async () => {
    try {
      const [c, s] = await Promise.all([getCurriculum(), getSrsStats()])
      decks = c.decks
      stats = s
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  const unlocked = (d: CurriculumDeck, i: number) => i === 0 || d.lessons[i - 1]!.complete

  const nextLesson = (d: CurriculumDeck) =>
    d.lessons.find((l) => !l.complete && unlocked(d, l.index)) ?? d.lessons[0]
</script>

<div class="flex items-baseline justify-between pt-4 pb-3">
  <div>
    <h1 class="text-lg font-semibold">Learn</h1>
    <p class="text-xs text-neutral-500">A guided path, one small lesson at a time.</p>
  </div>
  {#if stats}
    <div class="text-right text-xs">
      <div class={stats.due > 0 ? 'text-amber-300' : 'text-neutral-400'}>
        {stats.due} due
      </div>
      <div class="text-neutral-500">{stats.learned}/{stats.total} learned</div>
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else}
  {#each decks as d (d.deckId)}
    {@const next = nextLesson(d)}
    <section class="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-medium">{d.name}</h2>
        <span class="text-xs text-neutral-400">{d.learned}/{d.cardCount} learned</span>
      </div>
      <div class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
        <div
          class="h-full rounded-full bg-emerald-500 transition-all"
          style="width: {d.cardCount > 0 ? (d.learned / d.cardCount) * 100 : 0}%"
        ></div>
      </div>

      {#if next}
        <a
          href={href(`/practice?lesson=${encodeURIComponent(next.id)}`)}
          class="mt-3 block rounded-xl bg-emerald-500 px-4 py-3 text-center font-medium text-black"
        >
          {d.learned > 0 ? 'Continue' : 'Start'} · {next.title}
        </a>
      {/if}

      <ul class="mt-3 space-y-1">
        {#each d.lessons as l, i (l.id)}
          {@const open = unlocked(d, i)}
          <li>
            {#if open}
              <a
                href={href(`/practice?lesson=${encodeURIComponent(l.id)}`)}
                class="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-neutral-800/60"
              >
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs {l.complete
                    ? 'bg-emerald-600 text-black'
                    : 'bg-neutral-800 text-neutral-300'}"
                >
                  {l.complete ? '✓' : i + 1}
                </span>
                <span class="flex-1">
                  <span class="flex items-baseline justify-between">
                    <span class="text-sm">{l.title}</span>
                    <span class="text-[11px] text-neutral-500">{l.learned}/{l.cards}</span>
                  </span>
                  <span class="block text-[11px] text-neutral-500">{l.description}</span>
                </span>
                {#if l.due > 0}
                  <span class="rounded-full bg-amber-900/50 px-2 py-0.5 text-[11px] text-amber-200"
                    >{l.due} due</span
                  >
                {/if}
              </a>
            {:else}
              <div class="flex items-center gap-3 rounded-xl px-2 py-2 opacity-50">
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-800 text-xs"
                  >🔒</span
                >
                <span class="flex-1">
                  <span class="text-sm">{l.title}</span>
                  <span class="block text-[11px] text-neutral-500">
                    finish “{d.lessons[i - 1]?.title}” first
                  </span>
                </span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if d.due > 0}
        <a
          href={href(`/practice?deck=${d.deckId}`)}
          class="mt-3 block rounded-xl border border-amber-700/60 px-4 py-2 text-center text-sm text-amber-200"
        >
          Review {d.due} due on {d.name}
        </a>
      {/if}
    </section>
  {/each}
{/if}
