<script lang="ts">
  import '../app.css'
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
</script>

{#if !session.loaded}
  <div class="grid h-dvh place-items-center text-neutral-500">Loading tutor…</div>
{:else}
  {@render children()}
{/if}
