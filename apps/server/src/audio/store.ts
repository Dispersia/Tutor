import type { UserId } from '../ids'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { audioBlobs } from '../db/schema'

export function clipHash(text: string, voiceId: string, language: string): string {
  return sha1(voiceId, language, text)
}

export function legacyClipHash(text: string, voiceId: string): string {
  return sha1(voiceId, text)
}

function sha1(...parts: string[]): string {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex')
}

export function audioDir(dataDir: string): string {
  return join(dataDir, 'audio')
}

export function clipPath(dataDir: string, hash: string): string {
  return join(audioDir(dataDir), `${hash}.wav`)
}

export function findClip(db: Db, hash: string) {
  return db.select().from(audioBlobs).where(eq(audioBlobs.hash, hash)).get()
}

export function readClip(db: Db, dataDir: string, hash: string): Uint8Array | undefined {
  if (!findClip(db, hash)) return undefined
  const path = clipPath(dataDir, hash)
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return undefined
  }
}

export function writeClip(
  db: Db,
  dataDir: string,
  userId: UserId,
  hash: string,
  bytes: Uint8Array,
): void {
  const path = clipPath(dataDir, hash)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  const size = { bytes: bytes.length, mime: 'audio/wav', seconds: null }
  db.insert(audioBlobs)
    .values({ hash, userId, path, ...size, createdAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

export function removeClip(db: Db, dataDir: string, hash: string): void {
  rmSync(clipPath(dataDir, hash), { force: true })
  db.delete(audioBlobs).where(eq(audioBlobs.hash, hash)).run()
}

export function hasClip(db: Db, dataDir: string, hash: string): boolean {
  return Boolean(findClip(db, hash)) && existsSync(clipPath(dataDir, hash))
}
