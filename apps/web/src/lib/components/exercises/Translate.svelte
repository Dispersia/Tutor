<script lang="ts">
  import type { Instance } from '#lib/exercises'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let answer = $state('')

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <input
    bind:value={answer}
    autocomplete="off"
    autocapitalize="off"
    class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 text-lg outline-none focus:border-emerald-500"
    placeholder="Type your answer…"
  />
  <button
    type="submit"
    disabled={busy || !answer.trim()}
    class="w-full rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-40"
  >
    Check
  </button>
</form>
