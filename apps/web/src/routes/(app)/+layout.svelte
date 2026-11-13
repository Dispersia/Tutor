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
    { href: '/home', label: 'Home' },
    { href: '/learn', label: 'Learn' },
    { href: '/skills', label: 'Skills' },
    { href: '/chat', label: 'Chat' },
    { href: '/history', label: 'History' },
    { href: '/settings', label: 'Settings' },
  ]
  const active = $derived(stripBase(page.url.pathname))
</script>

<div class="flex min-h-dvh flex-col">
  <main class="mx-auto w-full max-w-2xl flex-1 px-4 pt-safe">
    {@render children()}
  </main>

  <nav
    class="sticky bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur pb-safe"
  >
    <ul class="mx-auto grid max-w-2xl grid-cols-6">
      {#each tabs as t (t.href)}
        <li>
          <a
            href={href(t.href)}
            class="flex flex-col items-center gap-1 py-2 text-xs {active.startsWith(t.href)
              ? 'text-emerald-400'
              : 'text-neutral-500'}"
          >
            <span
              class="h-1.5 w-1.5 rounded-full {active.startsWith(t.href)
                ? 'bg-emerald-400'
                : 'bg-transparent'}"
            ></span>
            {t.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</div>
