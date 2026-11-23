/** Server-global settings, per-user settings and per-user LLM roles. */

import type { UserId } from '../../ids'
import { and, eq } from 'drizzle-orm'
import type { Role } from '../../env'
import type { Db } from '../client'
import { settings, userSettings } from '../schema'

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function getUserSetting(db: Db, userId: UserId, key: string): string | undefined {
  return db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .get()?.value
}

export function setUserSetting(db: Db, userId: UserId, key: string, value: string): void {
  db.insert(userSettings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value } })
    .run()
}

export function allUserSettings(db: Db, userId: UserId): Record<string, string> {
  return Object.fromEntries(
    db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .all()
      .map((r) => [r.key, r.value]),
  )
}

export function getRoles(
  db: Db,
  userId: UserId,
  defaults: Record<Role, string>,
): Record<Role, string> {
  const raw = getUserSetting(db, userId, 'roles')
  if (!raw) return { ...defaults }
  try {
    return { ...defaults, ...(JSON.parse(raw) as Record<Role, string>) }
  } catch {
    return { ...defaults }
  }
}

export function setRole(
  db: Db,
  userId: UserId,
  defaults: Record<Role, string>,
  role: Role,
  model: string,
): Record<Role, string> {
  const next = { ...getRoles(db, userId, defaults), [role]: model }
  setUserSetting(db, userId, 'roles', JSON.stringify(next))
  return next
}
