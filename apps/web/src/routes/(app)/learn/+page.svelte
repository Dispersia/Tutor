<script lang="ts">
  import { onMount } from 'svelte'
  import { href } from '#lib/paths'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'
  import { ACCENT, accentStyle } from '#lib/theme'

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

  const deckAccent = (level: string) =>
    level === 'n5' ? ACCENT.level : level === 'hsk1' ? ACCENT.arcane : ACCENT.streak

  const unlocked = (d: CurriculumDeck, i: number) => i === 0 || d.lessons[i - 1]!.complete

  const nextLesson = (d: CurriculumDeck) =>
    d.lessons.find((l) => !l.complete && unlocked(d, l.index)) ?? d.lessons[0]
</script>

<div class="flex items-center justify-between pt-5 pb-4">
  <div>
    <p class="eyebrow">Your path</p>
    <h1 class="display text-2xl text-gold-200">Learn</h1>
    <p class="text-xs text-ink-400">A guided path, one small lesson at a time.</p>
  </div>
  {#if stats}
    <div class="text-right">
      <div class="display text-2xl {stats.due > 0 ? 'text-amber-300' : 'text-gold-200'}">
        {stats.due}
      </div>
      <div class="eyebrow">due · {stats.learned}/{stats.total} learned</div>
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}

{#if loading}
  <p class="text-sm text-ink-400">Loading…</p>
{:else}
  {#each decks as d (d.deckId)}
    {@const next = nextLesson(d)}
    {@const acc = deckAccent(d.level ?? '')}
    <section class="panel panel-accent mb-5 p-4" style={accentStyle(acc)}>
      <div class="flex items-baseline justify-between">
        <h2 class="display text-lg" style="color: {acc}">{d.name}</h2>
        <span class="text-xs text-ink-400">{d.learned}/{d.cardCount} learned</span>
      </div>
      <div class="bar mt-2">
        <i style="width: {d.cardCount > 0 ? (d.learned / d.cardCount) * 100 : 0}%"></i>
      </div>

      {#if next}
        <a
          href={href(`/practice?lesson=${encodeURIComponent(next.id)}`)}
          class="btn btn-primary mt-3 w-full py-3"
        >
          {d.learned > 0 ? 'Continue' : 'Start'} · {next.title}
        </a>
      {/if}

      <ul class="mt-3 space-y-1.5">
        {#each d.lessons as l, i (l.id)}
          {@const open = unlocked(d, i)}
          <li>
            {#if open}
              <a
                href={href(`/practice?lesson=${encodeURIComponent(l.id)}`)}
                class="flex items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-900/40 px-2.5 py-2 hover:border-ink-600"
              >
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold {l.complete
                    ? 'bg-emerald-500 text-ink-950'
                    : 'text-ink-200'}"
                  style={l.complete ? '' : `border: 1px solid ${acc}88; background: ${acc}1f`}
                >
                  {l.complete ? '✓' : i + 1}
                </span>
                <span class="flex-1">
                  <span class="flex items-baseline justify-between">
                    <span class="display text-sm text-ink-300">{l.title}</span>
                    <span class="text-[11px] text-ink-400">{l.learned}/{l.cards}</span>
                  </span>
                  <span class="block text-[11px] text-ink-400">{l.description}</span>
                </span>
                {#if l.due > 0}
                  <span class="chip" style="--accent: #ef9d45">{l.due} due</span>
                {/if}
              </a>
            {:else}
              <div class="flex items-center gap-3 rounded-xl px-2.5 py-2 opacity-45">
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-800 text-xs"
                  >🔒</span
                >
                <span class="flex-1">
                  <span class="display text-sm text-ink-300">{l.title}</span>
                  <span class="block text-[11px] text-ink-400">
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
          class="btn mt-3 w-full"
          style="color:#2a1d03; background: linear-gradient(180deg, #f4d98d, #d0a13a); border: 1px solid #a37a24"
        >
          Review {d.due} due on {d.name}
        </a>
      {/if}
    </section>
  {/each}
{/if}
<div class="h-4"></div>
