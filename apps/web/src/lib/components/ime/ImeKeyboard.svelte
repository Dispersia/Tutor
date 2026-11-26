<script lang="ts">
  import { BACKSPACE, SPACE, type ImeEngine } from '#lib/ime'

  let {
    engine,
    candidates = [],
    disabled = false,
    onkey,
    onpick,
    onenter,
    onhide,
  }: {
    engine: ImeEngine
    candidates?: string[]
    disabled?: boolean
    onkey: (key: string) => void
    onpick: (candidate: string) => void
    onenter: () => void
    onhide: () => void
  } = $props()

  const KEY =
    'flex h-11 items-center justify-center rounded-[6px] border border-white/20 bg-ink-850 text-lg text-ink-100 active:bg-ink-700 disabled:opacity-40'
  const SPECIAL =
    'flex h-11 items-center justify-center rounded-[6px] border border-white/20 text-sm text-ink-300 active:bg-ink-700 disabled:opacity-40'

  let shift = $state(false)

  const units = $derived(engine.columns * 2)
  const grid = $derived(`display:grid;grid-template-columns:repeat(${units},minmax(0,1fr));gap:4px`)
  const rows = $derived(
    engine.rows.map((row) =>
      row.map((key) => (shift && engine.shift ? (engine.shift[key] ?? key) : key)),
    ),
  )

  function padOf(row: string[], last: boolean): number {
    const specials = last && engine.shift ? 6 : 0
    return Math.max(0, (units - row.length * 2 - specials) / 2)
  }
</script>

<div class="border-t border-ink-700 bg-ink-900 pt-1.5">
  {#if candidates.length}
    <div class="flex gap-1.5 overflow-x-auto px-2 pb-1.5">
      {#each candidates as candidate (candidate)}
        <button
          type="button"
          onclick={() => onpick(candidate)}
          class="shrink-0 rounded-[8px] bg-ink-850 px-3 py-1.5 text-base text-ink-50 active:bg-ink-700"
          {disabled}
        >
          {candidate}
        </button>
      {/each}
    </div>
  {/if}

  <div class="space-y-1 px-1.5">
    {#each rows as row, i (i)}
      {@const last = i === rows.length - 1}
      {@const pad = padOf(row, last)}
      <div style={grid}>
        {#if pad > 0}<span style="grid-column: span {pad}"></span>{/if}
        {#if last && engine.shift}
          <button
            type="button"
            class="{SPECIAL} {shift ? 'bg-ink-700' : 'bg-ink-800'}"
            style="grid-column: span 3"
            aria-pressed={shift}
            {disabled}
            onclick={() => (shift = !shift)}
          >
            ⇧
          </button>
        {/if}
        {#each row as key (key)}
          <button
            type="button"
            class={KEY}
            style="grid-column: span 2"
            {disabled}
            onclick={() => onkey(key)}
          >
            {key}
          </button>
        {/each}
        {#if last && engine.shift}
          <button
            type="button"
            class="{SPECIAL} bg-ink-800"
            style="grid-column: span 3"
            aria-label="Backspace"
            {disabled}
            onclick={() => onkey(BACKSPACE)}
          >
            ⌫
          </button>
        {/if}
        {#if pad > 0}<span style="grid-column: span {pad}"></span>{/if}
      </div>
    {/each}

    <div style={grid}>
      <button
        type="button"
        class="{SPECIAL} bg-ink-800"
        style="grid-column: span 3"
        aria-label="Hide keyboard"
        onclick={onhide}
      >
        ⌄
      </button>
      {#if engine.shift}
        <button
          type="button"
          class={KEY}
          style="grid-column: span 14"
          {disabled}
          onclick={() => onkey(SPACE)}
        >
          space
        </button>
        <button
          type="button"
          class="{SPECIAL} bg-ink-800"
          style="grid-column: span 3"
          aria-label="Enter"
          {disabled}
          onclick={onenter}
        >
          ↵
        </button>
      {:else}
        <button
          type="button"
          class={KEY}
          style="grid-column: span 10"
          {disabled}
          onclick={() => onkey(SPACE)}
        >
          space
        </button>
        <button
          type="button"
          class="{SPECIAL} bg-ink-800"
          style="grid-column: span 3"
          aria-label="Backspace"
          {disabled}
          onclick={() => onkey(BACKSPACE)}
        >
          ⌫
        </button>
        <button
          type="button"
          class="{SPECIAL} bg-ink-800"
          style="grid-column: span 6"
          aria-label="Enter"
          {disabled}
          onclick={onenter}
        >
          ↵
        </button>
      {/if}
    </div>
  </div>
</div>
