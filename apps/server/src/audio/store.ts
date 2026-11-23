/**
 * Content-addressed clip storage for pre-recorded card audio (DESIGN §12).
 *
 * A clip's file name is the sha1 of `(voiceId, text)`, so every card with the
 * same `back` text shares one file and one `audio_blobs` row — no matter how
 * many decks carry that word. Files live under `$TUTOR_DATA_DIR/audio/<hash>.wav`
 * so the DB stays small and audio can be pruned on its own.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { audioBlobs } from '../db/schema'

/** Stable key for one (text, voice) pair. Never include the language: the text
 * itself is the content, and two languages never share a `back` string. */
export function clipHash(text: string, voiceId: string): string {
  return createHash('sha1').update(voiceId).update('\u0000').update(text).digest('hex')
}

export function audioDir(dataDir: string): string {
  return join(dataDir, 'audio')
}

export function clipPath(dataDir: string, hash: string): string {
  return join(audioDir(dataDir), `${hash}.wav`)
}

/** The stored clip's row, if this server has recorded it. */
export function findClip(db: Db, hash: string) {
  return db.select().from(audioBlobs).where(eq(audioBlobs.hash, hash)).get()
}

/** Reads a recorded clip, or undefined when the row/file is missing. */
export function readClip(db: Db, dataDir: string, hash: string): Uint8Array | undefined {
  if (!findClip(db, hash)) return undefined
  const path = clipPath(dataDir, hash)
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return undefined
  }
}

/** Writes a clip to disk and records it. Idempotent: an existing row is kept. */
export function writeClip(db: Db, dataDir: string, userId: string, hash: string, bytes: Uint8Array): void {
  const path = clipPath(dataDir, hash)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  db.insert(audioBlobs)
    .values({
      hash,
      userId,
      path,
      bytes: bytes.length,
      mime: 'audio/wav',
      seconds: null,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run()
}

/** Removes a clip's file and row (used when regeneration is forced). */
export function deleteClip(db: Db, dataDir: string, hash: string): void {
  try {
    rmSync(clipPath(dataDir, hash), { force: true })
  } catch {
    // best effort
  }
  db.delete(audioBlobs).where(eq(audioBlobs.hash, hash)).run()
}

/** True when the row and its file both exist (a row without a file is useless). */
export function hasClip(db: Db, dataDir: string, hash: string): boolean {
  return Boolean(findClip(db, hash)) && existsSync(clipPath(dataDir, hash))
}
