<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { loadUser, session } from '#lib/session.svelte'
  import { href, stripBase } from '#lib/paths'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()

  $effect(() => {
    void loadUser()
  })

  $effect(() => {
    if (!session.loaded) return
    const path = stripBase(page.url.pathname)
    const onLogin = path.startsWith('/login')
    if (!session.user && !onLogin) void goto(href('/login'))
    else if (session.user && onLogin) void goto(href('/home'))
  })

  // Pick up new deploys: ask for a service-worker update, and reload once the new
  // worker takes over (only when one was already controlling the page).
  onMount(() => {
    if (!('serviceWorker' in navigator)) return
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      location.reload()
    })
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {})
  })
</script>

{#if !session.loaded}
  <div class="grid h-dvh place-items-center text-ink-400">Loading Tutor…</div>
{:else}
  {@render children()}
{/if}
