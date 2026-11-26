import { cachedAt, writeCache } from '../cache'
import { clock } from '../clock.svelte'
import { anyRigActive } from '../idle'
import { Resource } from '../resource.svelte'
import type { DistillConfigDTO, ItemDTO, SkillDTO, SkillsResponse } from './types'

const SKILLS_PATH = '/api/skills'

const byId = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]))

class SkillsStore extends Resource<SkillsResponse> {
  readonly skills = $derived<SkillDTO[]>(this.data?.skills ?? [])
  readonly items = $derived<ItemDTO[]>(this.data?.items ?? [])
  readonly inventory = $derived(this.data?.inventory ?? [])
  readonly itemMap = $derived(byId(this.items))
  readonly skillMap = $derived(byId(this.skills))
  readonly distill = $derived<DistillConfigDTO>(
    this.data?.distill ?? { mode: 'max-value', allow: [] },
  )

  constructor() {
    super(SKILLS_PATH)
  }

  get now(): number {
    return anyRigActive(this.skills) ? clock.now : Date.now()
  }

  override set(board: SkillsResponse): void {
    writeCache(SKILLS_PATH, board)
    super.set(board)
    this.fetchedAt = cachedAt(SKILLS_PATH)
  }

  patch(part: Partial<SkillsResponse>): void {
    if (this.data) this.set({ ...this.data, ...part })
  }
}

export type { SkillsStore }

export const skillsStore = new SkillsStore()

export function useSkills(): SkillsStore {
  skillsStore.reseed()
  return skillsStore
}
