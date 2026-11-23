<script lang="ts">
  import { accentStyle, ACCENT } from '#lib/theme'
  import { alertsEnabled, disableRigAlerts, enableRigAlerts, testRigAlert } from '#lib/rigAlerts'
  import { pushSupported } from '#lib/push'
  import { onMount } from 'svelte'

  const canNotify = pushSupported()
  let alertsOn = $state(false)
  let alertsBusy = $state(false)
  let alertsMsg = $state('')
  let alertsErr = $state('')

  onMount(() => {
    alertsOn = alertsEnabled()
  })

  async function toggle() {
    if (alertsBusy) return
    alertsBusy = true
    alertsMsg = ''
    alertsErr = ''
    try {
      if (alertsOn) await turnOff()
      else await turnOn()
    } catch (e) {
      alertsErr = (e as Error).message
      alertsOn = alertsEnabled()
    } finally {
      alertsBusy = false
    }
  }

  async function turnOff() {
    await disableRigAlerts()
    alertsOn = false
    alertsMsg = 'Rig alerts are off on this device.'
  }

  async function turnOn() {
    const res = await enableRigAlerts()
    if (!res.ok) {
      alertsErr = res.error ?? 'Could not enable notifications.'
      alertsOn = false
      return
    }
    alertsOn = true
    alertsMsg = 'Rig alerts are on for this device.'
  }

  async function sendTest() {
    alertsMsg = ''
    alertsErr = ''
    try {
      await testRigAlert()
      alertsMsg = 'Test notification sent.'
    } catch (e) {
      alertsErr = (e as Error).message
    }
  }
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.jade)}>
  <h2 class="display text-sm text-ink-100">Rig alerts</h2>
  <p class="mt-1 text-xs text-ink-400">
    A notification when a rig's run drops under 30 minutes, so you can drill once more and keep it
    going. This switch is per device: turn it on for your phone and your computer separately.
  </p>
  {#if !canNotify}
    <p class="mt-3 text-xs text-ink-400">This browser cannot show notifications.</p>
  {:else}
    <label class="mt-3 flex min-h-11 items-center justify-between gap-3">
      <span class="text-sm">Notify me on this device</span>
      <input
        type="checkbox"
        checked={alertsOn}
        disabled={alertsBusy}
        onchange={toggle}
        class="h-4 w-4 accent-seal-400"
      />
    </label>
    {#if alertsOn}
      <button onclick={sendTest} class="btn btn-ghost mt-2 px-3 py-2 text-xs">Send a test</button>
    {/if}
    <p class="mt-2 text-xs text-ink-500">
      On Android, install the app to your home screen first; iOS needs it installed too.
    </p>
  {/if}
  {#if alertsMsg}<p class="mt-2 text-xs text-jade-300">{alertsMsg}</p>{/if}
  {#if alertsErr}<p class="mt-2 text-xs text-ember-300">{alertsErr}</p>{/if}
</section>
