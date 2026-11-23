import { redirect } from '@sveltejs/kit'
import { href } from '#lib/paths'

export function load() {
  redirect(307, href('/inventory'))
}
