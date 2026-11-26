<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { typingAttrs } from '#lib/lang'
  import { haptics } from '#lib/haptics.svelte'
  import { tapGuard } from '#lib/tapGuard.svelte'
  import { BACKSPACE, ENTER, SPACE, display, emptyState, imeFor, type ImeState } from '#lib/ime'
  import ImeKeyboard from './ImeKeyboard.svelte'

  let {
    value = $bindable(''),
    lang,
    variant,
    placeholder = 'Type your answer…',
    rows = 0,
    enter = 'go',
    disabled = false,
    onkeydown,
  }: {
    value?: string
    lang?: string
    variant?: string
    placeholder?: string
    rows?: number
    enter?: 'go' | 'done' | 'next'
    disabled?: boolean
    onkeydown?: (event: KeyboardEvent) => void
  } = $props()

  const engine = $derived(imeFor(lang, { variant }))
  const attrs = $derived(typingAttrs(lang, { enter }))
  let store = $state<{ id: string; ime: ImeState } | null>(null)
  let touch = $state(false)
  let enabled = $state(true)
  let showKeys = $state(false)
  let height = $state(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let wasOpen = false
  let field = $state<HTMLElement | null>(null)
  const composition = $derived(
    engine && store?.id === engine.id ? store.ime : (engine?.initial() ?? emptyState()),
  )
  const on = $derived(Boolean(engine) && enabled)
  const driven = $derived(Boolean(engine && enabled && (showKeys || Boolean(engine.physical))))
  const room = $derived(
    height > 0
      ? height
      : engine
        ? Math.max(engine.rows.length, engine.symbols?.length ?? 0) * 48 + 120
        : 0,
  )

  onMount(() => {
    touch = window.matchMedia('(pointer: coarse)').matches
    showKeys = touch
    void haptics.ensure()
  })

  $effect(() => {
    if (driven) value = display(composition)
  })

  $effect(() => {
    if (typeof document === 'undefined') return
    const spacer = document.createElement('div')
    spacer.setAttribute('aria-hidden', 'true')
    spacer.style.height = showKeys ? `${room}px` : '0px'
    document.body.appendChild(spacer)
    return () => spacer.remove()
  })

  $effect(() => {
    if (showKeys) {
      wasOpen = true
      return
    }
    if (wasOpen) {
      wasOpen = false
      window.scrollTo({ top: document.documentElement.scrollHeight })
    }
  })

  $effect(() => {
    const busy = disabled
    untrack(() => {
      if (busy) close()
    })
  })

  function close() {
    if (!showKeys) return
    showKeys = false
    tapGuard.arm()
  }

  function press(key: string) {
    const current = engine
    if (!current || disabled) return
    haptics.pulse()
    store = { id: current.id, ime: current.press(composition, key) }
    schedule(current)
  }

  function pick(candidate: string) {
    const current = engine
    if (!current) return
    haptics.pulse()
    const ime = { value: composition.value + candidate, preedit: '', buffer: '', candidates: [] }
    store = { id: current.id, ime }
  }

  function hide() {
    close()
    if (touch) enabled = false
  }

  function onPhysical(e: KeyboardEvent) {
    if (!driven || !engine || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Backspace') return consume(e, BACKSPACE)
    if (e.key === 'Enter') return enterAction(e)
    if (e.key === ' ') return consume(e, SPACE)
    if (e.key.length !== 1) return
    let symbol = engine.physical?.[e.key.toLowerCase()]
    if (symbol && e.shiftKey && engine.shift?.[symbol]) symbol = engine.shift[symbol]
    if (symbol) return consume(e, symbol)
    if (engine.symbols?.flat().includes(e.key)) consume(e, e.key)
  }

  function enterAction(e?: Event) {
    if (composition.preedit || composition.candidates.length) {
      e?.preventDefault()
      return press(ENTER)
    }
    const form =
      e?.currentTarget instanceof HTMLElement
        ? e.currentTarget.closest('form')
        : (field?.closest('form') ?? null)
    if (!form) return
    e?.preventDefault()
    haptics.pulse()
    close()
    form.requestSubmit()
  }

  function consume(e: KeyboardEvent, key: string) {
    e.preventDefault()
    press(key)
  }

  function schedule(current: NonNullable<typeof engine>) {
    if (timer) clearTimeout(timer)
    if (!current.lookup || !composition.preedit.trim()) return
    const snapshot = { ...composition }
    timer = setTimeout(async () => {
      const list = await current.lookup!(snapshot)
      if (composition.preedit !== snapshot.preedit) return
      store = { id: current.id, ime: { ...composition, candidates: list } }
    }, 120)
  }
</script>

{#if driven}
  <input
    readonly
    inputmode="none"
    value={display(composition)}
    bind:this={field}
    onkeydown={onPhysical}
    class="field text-lg"
    aria-label={placeholder}
    {placeholder}
  />
{:else if rows}
  <textarea
    bind:value
    {...attrs}
    {placeholder}
    {rows}
    {disabled}
    {onkeydown}
    aria-label={placeholder}
    class="field"
  ></textarea>
{:else}
  <input
    bind:value
    {...attrs}
    {placeholder}
    {disabled}
    {onkeydown}
    aria-label={placeholder}
    class="field text-lg"
  />
{/if}

{#if engine && on && showKeys}
  <div
    class="fixed inset-x-0 bottom-0 z-50 pb-[env(safe-area-inset-bottom)]"
    bind:clientHeight={height}
  >
    <ImeKeyboard
      {engine}
      candidates={composition.candidates}
      {disabled}
      onkey={press}
      onpick={pick}
      onenter={enterAction}
      onhide={hide}
    />
  </div>
{/if}

{#if engine && (!on || !showKeys)}
  <div class="flex gap-3">
    <button
      type="button"
      class="link link-btn text-xs"
      onclick={() => {
        enabled = true
        showKeys = true
      }}
    >
      {engine.label} keyboard
    </button>
    {#if on}
      <button type="button" class="link link-btn text-xs" onclick={() => (enabled = false)}>
        system keyboard
      </button>
    {/if}
  </div>
{/if}
