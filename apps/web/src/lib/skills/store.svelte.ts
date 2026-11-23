/**
 * The one shared skills board (`GET /api/skills`).
 *
 * Home, Skills, Bank, Combat, Practice and Learn all read the same big payload;
 * each used to fetch it and rebuild the same indexes. They now share this store:
 * one copy of the board, the indexes derived once, and one `refresh()` — two
 * screens asking together share a request, and a late answer never overwrites a
 * newer one (see `lib/resource.svelte.ts`).
 */
import { cachedAt, writeCache } from '../cache'
import { clock } from '../clock.svelte'
import { anyRigActive } from '../idle'
import { Resource } from '../resource.svelte'
import type { ItemDTO, SkillDTO, SkillsResponse } from './types'

const SKILLS_PATH = '/api/skills'

/** A lookup by id, rebuilt (never mutated) whenever its rows change. */
const byId = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]))

class SkillsStore extends Resource<SkillsResponse> {
  /** Every profession on the board ([] until it loads). */
  readonly skills = $derived<SkillDTO[]>(this.data?.skills ?? [])
  /** The item catalogue. */
  readonly items = $derived<ItemDTO[]>(this.data?.items ?? [])
  /** The bank rows: how many of each item the member holds. */
  readonly inventory = $derived(this.data?.inventory ?? [])
  readonly itemMap = $derived(byId(this.items))
  readonly skillMap = $derived(byId(this.skills))

  constructor() {
    super(SKILLS_PATH)
  }

  /**
   * The wall clock the live counters extrapolate to from `fetchedAt`. It ticks
   * (shared clock) only while a rig runs, so its counter climbs in place
   * (§13.5.1); otherwise it is re-read with each new board.
   */
  get now(): number {
    return anyRigActive(this.skills) ? clock.now : Date.now()
  }

  /**
   * Takes a board a mutation already returned, instead of refetching. It is
   * written to the read cache too, so the next screen seeds from it.
   */
  override set(board: SkillsResponse): void {
    writeCache(SKILLS_PATH, board)
    super.set(board)
    this.fetchedAt = cachedAt(SKILLS_PATH)
  }

  /** Merges the part of the board a mutation returned (`{ skills, rigs, … }`). */
  patch(part: Partial<SkillsResponse>): void {
    if (this.data) this.set({ ...this.data, ...part })
  }
}

export type { SkillsStore }

export const skillsStore = new SkillsStore()

/**
 * The shared board for a screen. Call it during component init: it adopts what
 * the cache holds now (nothing after a sign-out, so accounts never share a
 * board) and clears the last screen's error. The screen then calls `refresh()`
 * when it mounts, and again after a mutation that changes the board.
 */
export function useSkills(): SkillsStore {
  skillsStore.reseed()
  return skillsStore
}
