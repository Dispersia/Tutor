<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import { beforeNavigate, goto } from '$app/navigation'
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

  let stale = false
  beforeNavigate(({ willUnload, to }) => {
    if (stale && !willUnload && to?.url) location.href = to.url.href
  })
  onMount(() => {
    if (!('serviceWorker' in navigator)) return
    const hadController = Boolean(navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) stale = true
    })
    document.addEventListener('visibilitychange', () => {
      if (stale && document.visibilityState === 'hidden') location.reload()
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
