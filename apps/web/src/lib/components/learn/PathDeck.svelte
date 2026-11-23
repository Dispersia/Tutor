<script lang="ts">
  /** One deck in the Learn path: its progress, next step, review and grow controls. */

  import { ACCENT, accentStyle } from '#lib/theme'
  import { deckAccent, isDeckDone, nextLesson } from '#lib/learnview'
  import CharCell from '#lib/components/CharCell.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { CurriculumDeck } from '#lib/curriculum'

  interface Props {
    d: CurriculumDeck
    actionId: string
    activeDeckId: string | null
    growing: string
    practiceHref: (params: { lesson?: string; deck?: string }) => string
    onSetActive: (deckId: string) => void
    /** Both resolve true when the growth worked, so this deck can clear its topic. */
    onGrow: (d: CurriculumDeck, topic: string) => Promise<boolean>
    onFinish: (d: CurriculumDeck, topic: string) => Promise<boolean>
    onSettings: (d: CurriculumDeck) => void
    onEdit: (d: CurriculumDeck) => void
  }

  let {
    d,
    actionId,
    activeDeckId,
    growing,
    practiceHref,
    onSetActive,
    onGrow,
    onFinish,
    onSettings,
    onEdit,
  }: Props = $props()

  const acc = $derived(deckAccent(d.level ?? ''))
  const next = $derived(nextLesson(d))
  const progress = $derived(d.cardCount > 0 ? (d.learned / d.cardCount) * 100 : 0)

  /** This deck's own topic: typing here must not fill every other deck's field. */
  let growTopic = $state('')

  async function run(action: Props['onGrow']) {
    if (await action(d, growTopic)) growTopic = ''
  }
</script>

<section class="panel panel-accent mb-5 p-4" style={accentStyle(acc)}>
  <div class="flex items-baseline justify-between gap-3">
    <h2 class="display min-w-0 truncate text-lg" style="color: {acc}">{d.name}</h2>
    <div class="flex shrink-0 items-center gap-2">
      {#if d.deckId === activeDeckId}
        <span class="chip" style="--accent: {ACCENT.jade}">Studying</span>
      {/if}
      <span class="text-xs text-ink-400">{d.learned}/{d.cardCount} learned</span>
    </div>
  </div>
  <div class="bar mt-2">
    <i style="width: {progress}%"></i>
  </div>

  {#if d.settings?.building}
    {@const built = d.settings.cursor ?? 0}
    {@const total = d.settings.buildTotal ?? 0}
    <div class="mt-2">
      <div class="flex items-baseline justify-between text-xs text-ink-400">
        <span class="flex items-center gap-1.5">
          <Spinner size={12} label="Generating cards" /> Generating cards…
        </span>
        <span>{built}{total > 0 ? ` / ${total}` : ''} words</span>
      </div>
      <div class="bar mt-1">
        <i style="width: {total > 0 ? (built / total) * 100 : 0}%"></i>
      </div>
    </div>
  {:else if d.settings?.buildError}
    <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">
      Generation stopped: {d.settings.buildError}
    </p>
  {/if}

  {#if d.settings?.instruction}
    <p class="mt-2 line-clamp-2 text-xs text-ink-400" title={d.settings.instruction}>
      Prompt · {d.settings.instruction}
    </p>
  {/if}

  {#if next}
    {#if next.newWord}
      <div class="mt-3 flex justify-center">
        <CharCell
          word={next.newWord}
          reading={next.reading && next.reading !== next.newWord ? next.reading : ''}
          lang={d.targetLang}
          size="sm"
          wordish={next.newWord.length > 1}
          accent={acc}
        />
      </div>
    {/if}
    {#if actionId}
      <a
        href={practiceHref({ lesson: next.id })}
        onclick={() => onSetActive(d.deckId)}
        class="btn btn-primary mt-3 w-full py-3"
      >
        {d.learned > 0 ? 'Next' : 'Start'} · {next.newWord ?? next.title}
      </a>
    {:else}
      <button disabled class="btn btn-ghost mt-3 w-full py-3">
        Select a profession to start
      </button>
    {/if}
    {#if next.newWord}
      <p class="mt-1.5 text-center text-xs text-ink-400">new word · {next.description}</p>
    {:else if next.description}
      <p class="mt-1.5 text-center text-xs text-ink-400">{next.description}</p>
    {/if}
    {#if next.cards > 1}
      <p class="mt-1.5 text-center text-xs text-ink-400">
        {next.learned}/{next.cards} in this lesson
      </p>
    {/if}
  {:else}
    <p class="mt-3 text-center text-sm text-ink-400">Course complete</p>
  {/if}

  {#if d.due > 0}
    {#if actionId}
      <a
        href={practiceHref({ deck: d.deckId })}
        onclick={() => onSetActive(d.deckId)}
        class="btn btn-ghost mt-2 w-full"
      >
        Review {d.due} due
      </a>
    {:else}
      <button disabled class="btn btn-ghost mt-2 w-full">Select a profession to review</button>
    {/if}
  {/if}

  {#if isDeckDone(d)}
    <p class="mt-2 text-center text-xs text-jade-400">All words learned ✓</p>
  {/if}

  {#if !d.settings?.building && (d.remaining ?? 0) > 0}
    <button
      type="button"
      onclick={() => run(onFinish)}
      disabled={Boolean(growing)}
      class="btn btn-ghost mt-3 w-full py-3"
    >
      {#if growing === d.deckId}
        <Spinner size={13} label="Finishing the deck" /> Finishing…
      {:else}
        Finish importing · {d.remaining} left
      {/if}
    </button>
  {/if}

  <div class="mt-3 flex items-center gap-2">
    <input
      bind:value={growTopic}
      placeholder="grow on a topic (optional)"
      aria-label="Topic to grow {d.name} on (optional)"
      class="field min-w-0 flex-1 text-xs"
    />
    <button
      type="button"
      onclick={() => run(onGrow)}
      disabled={Boolean(growing) || Boolean(d.settings?.building)}
      class="btn btn-ghost px-3 py-2 text-xs"
    >
      {#if growing === d.deckId}<Spinner size={13} label="Growing the deck" /> Growing…{:else}Grow{/if}
    </button>
  </div>
  <div class="mt-3 flex items-center justify-center gap-4">
    <button type="button" onclick={() => onSettings(d)} class="link link-btn text-xs">
      Deck settings
    </button>
    <button type="button" onclick={() => onEdit(d)} class="link link-btn text-xs">
      Card metadata
    </button>
  </div>
</section>
