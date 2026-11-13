<script lang="ts">
  import { goto } from '$app/navigation'
  import { session } from '#lib/session.svelte'

  $effect(() => {
    if (session.loaded) void goto(session.user ? '/home' : '/login')
  })
</script>

<div class="grid h-dvh place-items-center text-neutral-500">Loading…</div>
