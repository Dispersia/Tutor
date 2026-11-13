<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { session } from '#lib/session.svelte'
  import { href, stripBase } from '#lib/paths'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()

  $effect(() => {
    if (session.loaded && !session.user) void goto(href('/login'))
  })

  const tabs = [
    { href: '/home', label: 'Home', icon: '🏠' },
    { href: '/learn', label: 'Learn', icon: '📖' },
    { href: '/skills', label: 'Skills', icon: '⚒️' },
    { href: '/chat', label: 'Chat', icon: '💬' },
    { href: '/history', label: 'History', icon: '📜' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
  ]
  const active = $derived(stripBase(page.url.pathname))
</script>

<div class="flex min-h-dvh flex-col">
  <main class="mx-auto w-full max-w-2xl flex-1 px-4 pt-safe">
    {@render children()}
  </main>

  <nav class="sticky bottom-0 z-10 border-t border-ink-700 bg-ink-950/90 backdrop-blur-md pb-safe">
    <ul class="mx-auto grid max-w-2xl grid-cols-6">
      {#each tabs as t (t.href)}
        {@const on = active.startsWith(t.href)}
        <li>
          <a
            href={href(t.href)}
            class="group flex justify-center py-1.5 text-[11px] transition-colors {on
              ? 'text-gold-300'
              : 'text-ink-400 hover:text-ink-300'}"
          >
            <span
              class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 {on
                ? 'bg-gold-500/15'
                : ''}"
            >
              <span
                class="text-base leading-none transition-transform {on
                  ? 'scale-110'
                  : 'opacity-75 group-hover:opacity-100'}">{t.icon}</span
              >
              <span class="font-medium">{t.label}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</div>
