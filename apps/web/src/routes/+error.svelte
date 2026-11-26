<script lang="ts">
  import { page } from '$app/state'
  import { href } from '#lib/paths'
  import { ACCENT } from '#lib/theme'
</script>

<div class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
  <div class="panel w-full p-6" style="--accent: {ACCENT.ember}">
    <p class="display text-4xl text-ink-100">{page.status}</p>
    <h1 class="display mt-2 text-lg text-ink-200">
      {page.error?.message ?? 'Something went wrong'}
    </h1>
    <p class="mt-3 text-sm text-ink-400">
      The page could not be loaded. Try again, or head back home.
    </p>
    <div class="mt-5 flex justify-center gap-2">
      <button type="button" class="btn btn-ghost px-3 py-2 text-sm" onclick={() => history.back()}>
        Go back
      </button>
      <a href={href('/home')} class="btn btn-primary px-4 py-2 text-sm">Home</a>
    </div>
  </div>
</div>
