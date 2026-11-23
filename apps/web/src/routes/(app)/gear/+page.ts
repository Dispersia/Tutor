import { redirect } from '@sveltejs/kit'
import { href } from '#lib/paths'

/** The old Gear screen became Inventory. Keep links working. */
export function load() {
  redirect(307, href('/inventory'))
}
