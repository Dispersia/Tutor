<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { api } from '#lib/api'
  import { session } from '#lib/session.svelte'
  import { href, stripBase } from '#lib/paths'
  import { setVoicePrefs, type VoicePrefs } from '#lib/voices'
  import { htmlLang } from '#lib/lang'
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

  // Voice choices are per account and must reach every playback path, not just
  // the Settings screen that saved them.
  onMount(() => {
    api<{ voice?: VoicePrefs }>('/api/settings')
      .then((s) => setVoicePrefs(s.voice))
      .catch(() => {})
  })

  /** Tab icons are drawn, one stroke and weight, never emoji. */
  const ICONS: Record<string, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5M5 9.5V20h5v-5h4v5h5V9.5" />',
    learn:
      '<path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2M12 6.5c2-1.5 4.5-2 8-2v13c-3.5 0-6 .5-8 2M12 6.5v13" />',
    skills: '<path d="m14.5 5.5 4 4M3 21l6.5-6.5M11.5 3.5l9 9-3 3-9-9zM6 14l4 4" />',
    chat: '<path d="M4 5h16v11H9l-5 4z" />',
    history: '<path d="M12 7v5l3.5 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4h4" />',
    settings:
      '<path d="M4 6h5M13 6h7M4 12h11M19 12h1M4 18h7M15 18h5" /><circle cx="11" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="13" cy="18" r="2" />',
  }

  const tabs = [
    { href: '/home', label: 'Home', icon: ICONS.home },
    { href: '/learn', label: 'Learn', icon: ICONS.learn },
    { href: '/skills', label: 'Skills', icon: ICONS.skills },
    { href: '/chat', label: 'Chat', icon: ICONS.chat },
    { href: '/history', label: 'History', icon: ICONS.history },
    { href: '/settings', label: 'Settings', icon: ICONS.settings },
  ]
  const active = $derived(stripBase(page.url.pathname))
</script>

<div class="flex min-h-dvh flex-col">
  <main class="mx-auto w-full max-w-2xl flex-1 px-4 pt-safe">
    {@render children()}
  </main>

  <nav
    class="sticky bottom-0 z-10 border-t border-ink-700 bg-ink-950/90 pb-safe backdrop-blur-md"
    aria-label="Primary"
  >
    <ul class="mx-auto grid max-w-2xl grid-cols-6">
      {#each tabs as t (t.href)}
        {@const on = active.startsWith(t.href)}
        <li>
          <a
            href={href(t.href)}
            aria-current={on ? 'page' : undefined}
            class="flex justify-center py-1.5 text-[11px] font-medium transition-colors {on
              ? 'text-seal-300'
              : 'text-ink-400 hover:text-ink-200'}"
          >
            <span
              class="flex flex-col items-center gap-1 rounded-[4px] px-3 py-1 {on
                ? 'bg-seal-400/12'
                : ''}"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-[18px] w-[18px] {on ? '' : 'opacity-80'}"
                aria-hidden="true"
              >
                {@html t.icon}
              </svg>
              <span>{t.label}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</div>
