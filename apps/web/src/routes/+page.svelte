<script lang="ts">
  import { href } from '#lib/paths'
  import { goto } from '$app/navigation'
  import { session } from '#lib/session.svelte'

  $effect(() => {
    if (session.loaded) void goto(href(session.user ? '/home' : '/login'))
  })
</script>

<div class="grid h-dvh place-items-center text-ink-400">Loading…</div>
