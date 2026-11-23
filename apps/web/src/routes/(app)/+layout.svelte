<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { logout, session } from '#lib/session.svelte'
  import { activeDeck, loadActiveDeck, setActiveDeck } from '#lib/activeDeck.svelte'
  import { href, stripBase } from '#lib/paths'
  import { htmlLang } from '#lib/lang'
  import { startRigAlerts } from '#lib/rigAlerts'
  import { reportTimezone } from '#lib/timezone'
  import Icon from '#lib/components/Icon.svelte'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()

  $effect(() => {
    if (session.loaded && !session.user) void goto(href('/login'))
  })

  // Label the document with the language its content is written in — the
  // learner's own language (prompts, meanings and feedback use it). No browser
  // can switch the OS keyboard for us; this is the best-effort hint (DESIGN
  // §14.2). Target-language text is tagged per element instead.
  $effect(() => {
    if (typeof document === 'undefined') return
    const tag = htmlLang(session.user?.nativeLang ?? 'en')
    if (tag) document.documentElement.lang = tag
  })

  onMount(() => {
    // The deck chosen everywhere (free practice, Learn) lives in the profile
    // menu; load it once so every screen shares the same choice.
    void loadActiveDeck()
    // The server rolls the day over at the member's own midnight.
    void reportTimezone(session.user?.id)
    // Rig alerts are per device; the timer checks the switch on each tick.
    return startRigAlerts()
  })

  // Three destinations stay in the thumb zone on a phone; the tutor, inventory,
  // the bank, the archive and the account sit behind the profile stamp in the
  // title bar. On desktop the same destinations move into a persistent left
  // rail — the dictionary's spine — and both bars disappear.
  const tabs = [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/skills', label: 'Skills', icon: 'skills' },
    { href: '/learn', label: 'Learn', icon: 'learn' },
  ]
  const account = [
    { href: '/chat', label: 'Chat', icon: 'chat' },
    { href: '/inventory', label: 'Inventory', icon: 'shield' },
    { href: '/bank', label: 'Bank', icon: 'bank' },
    { href: '/history', label: 'History', icon: 'history' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ]

  const active = $derived(stripBase(page.url.pathname))
  /** On an account screen the stamp reads as active, like a selected tab. */
  const inAccount = $derived(account.some((m) => active.startsWith(m.href)))

  let open = $state(false)
  const initial = $derived(
    (session.user?.handle || session.user?.username || '?').trim().charAt(0).toUpperCase(),
  )

  // A new route always closes the menu (a link tap navigates, then this runs).
  $effect(() => {
    void active
    open = false
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false
  }

  /** Choosing a deck in the profile menu sets it for the whole app. */
  function onDeckChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value
    void setActiveDeck(value || null)
  }

  async function signOut() {
    open = false
    await logout().catch(() => {})
    void goto(href('/login'))
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-dvh flex-col lg:pl-64">
  <!-- desktop rail: the spine of the book, all destinations in one column -->
  <aside
    class="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-ink-700/70 lg:bg-ink-950/70 lg:backdrop-blur-xl"
    aria-label="Primary"
  >
    <div class="px-5 pt-6 pb-5">
      <a
        href={href('/home')}
        class="display inline-flex min-h-11 items-center text-2xl leading-none font-bold text-ink-100"
        >Tutor</a
      >
    </div>

    <nav class="flex-1 overflow-y-auto px-3">
      <ul class="space-y-0.5">
        {#each tabs as t (t.href)}
          {@const on = active.startsWith(t.href)}
          <li>
            <a
              href={href(t.href)}
              aria-current={on ? 'page' : undefined}
              class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors {on
                ? 'bg-seal-400/15 text-seal-300 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-seal-400)_25%,transparent)]'
                : 'text-ink-300 hover:bg-ink-800/70 hover:text-ink-100'}"
            >
              <Icon name={t.icon} size={17} cls={on ? '' : 'text-ink-400'} />
              {t.label}
            </a>
          </li>
        {/each}
      </ul>

      <ul class="mt-3 space-y-0.5 border-t border-ink-700 pt-3">
        {#each account as m (m.href)}
          {@const on = active.startsWith(m.href)}
          <li>
            <a
              href={href(m.href)}
              aria-current={on ? 'page' : undefined}
              class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors {on
                ? 'bg-seal-400/15 text-seal-300 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-seal-400)_25%,transparent)]'
                : 'text-ink-300 hover:bg-ink-800/70 hover:text-ink-100'}"
            >
              <Icon name={m.icon} size={17} cls={on ? '' : 'text-ink-400'} />
              {m.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="border-t border-ink-700 p-3">
      {#if activeDeck.decks.length}
        <label class="mb-2 block px-1.5">
          <span class="eyebrow text-ink-400">Studying</span>
          <select value={activeDeck.id ?? ''} onchange={onDeckChange} class="field mt-1 text-xs">
            <option value="">All decks</option>
            {#each activeDeck.decks as d (d.id)}
              <option value={d.id}>{d.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      <div class="flex items-center gap-2.5 px-1.5 py-1">
        <span
          class="display grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border text-sm font-bold transition-colors {inAccount
            ? 'border-seal-400 text-seal-300'
            : 'border-ink-600 text-ink-200'}"
        >
          {initial}
        </span>
        <div class="min-w-0">
          <div class="display truncate text-sm text-ink-100">{session.user?.handle}</div>
          <div class="truncate text-xs text-ink-400">@{session.user?.username}</div>
        </div>
      </div>
      <button
        type="button"
        onclick={signOut}
        class="mt-2 flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-sm font-medium text-ember-300 transition-colors hover:bg-ember-950/60"
      >
        <Icon name="logout" size={17} cls="text-ember-400" />
        Sign out
      </button>
    </div>
  </aside>

  <!-- title bar (phone): the app mark, and the account behind a personal stamp -->
  <header
    class="sticky top-0 z-20 border-b border-ink-700/60 bg-ink-950/75 pt-safe backdrop-blur-xl lg:hidden"
  >
    <div class="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 pb-1.5">
      <a
        href={href('/home')}
        class="display inline-flex min-h-11 items-center text-xl leading-none font-bold text-ink-100"
        >Tutor</a
      >

      <div class="relative">
        <button
          type="button"
          onclick={() => (open = !open)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          class="display grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border text-sm font-bold transition-colors {open ||
          inAccount
            ? 'border-seal-400 text-seal-300'
            : 'border-ink-600 text-ink-200 hover:border-ink-500'}"
        >
          {initial}
        </button>

        {#if open}
          <button
            type="button"
            tabindex="-1"
            aria-label="Close account menu"
            onclick={() => (open = false)}
            class="fixed inset-0 z-20 cursor-default"
          ></button>
          <div class="rise panel absolute right-0 z-30 mt-2 w-56" role="menu">
            <div class="border-b border-ink-700 px-3 py-2.5">
              <div class="display truncate text-sm text-ink-100">{session.user?.handle}</div>
              <div class="truncate text-xs text-ink-400">@{session.user?.username}</div>
            </div>
            {#if activeDeck.decks.length}
              <div class="border-b border-ink-700 px-3 py-2.5">
                <label class="eyebrow block text-ink-400" for="profile-deck">Studying</label>
                <select
                  id="profile-deck"
                  value={activeDeck.id ?? ''}
                  onchange={onDeckChange}
                  class="field mt-1 text-xs"
                >
                  <option value="">All decks</option>
                  {#each activeDeck.decks as d (d.id)}
                    <option value={d.id}>{d.name}</option>
                  {/each}
                </select>
              </div>
            {/if}
            {#each account as m (m.href)}
              {@const on = active.startsWith(m.href)}
              <a
                href={href(m.href)}
                role="menuitem"
                aria-current={on ? 'page' : undefined}
                class="flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-ink-800 {on
                  ? 'text-seal-300'
                  : 'text-ink-200'}"
              >
                <Icon name={m.icon} size={16} cls={on ? 'text-seal-400' : 'text-ink-400'} />
                {m.label}
              </a>
            {/each}
            <button
              type="button"
              onclick={signOut}
              role="menuitem"
              class="flex min-h-11 w-full items-center gap-3 border-t border-ink-700 px-3 py-2.5 text-left text-sm text-ember-300 transition-colors hover:bg-ink-800"
            >
              <Icon name="logout" size={16} cls="text-ember-400" />
              Sign out
            </button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <main class="mx-auto w-full max-w-2xl flex-1 px-4 lg:max-w-6xl lg:px-10 lg:py-8">
    {@render children()}
  </main>

  <nav
    class="sticky bottom-0 z-10 border-t border-ink-700/60 bg-ink-950/80 pb-safe backdrop-blur-xl lg:hidden"
    aria-label="Primary"
  >
    <ul class="mx-auto grid max-w-2xl grid-cols-3 gap-1 px-2 pt-1.5">
      {#each tabs as t (t.href)}
        {@const on = active.startsWith(t.href)}
        <li>
          <a
            href={href(t.href)}
            aria-current={on ? 'page' : undefined}
            class="flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-xs leading-none font-medium transition-colors {on
              ? 'bg-seal-400/15 text-seal-300'
              : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'}"
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</div>
