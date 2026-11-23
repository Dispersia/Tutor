/**
 * Content-addressed clip storage for pre-recorded card audio (DESIGN §12).
 *
 * A clip's file name is the sha1 of `(voiceId, language, text)`, so every card
 * with the same `back` text **in the same language** shares one file and one
 * `audio_blobs` row — no matter how many decks carry that word. Files live under `$TUTOR_DATA_DIR/audio/<hash>.wav`
 * so the DB stays small and audio can be pruned on its own.
 */

import type { UserId } from '../ids'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { audioBlobs } from '../db/schema'

/**
 * Stable key for one (voice, language, text) clip. The language is part of it:
 * Mandarin, Japanese and Cantonese share written words (先生, 時間, 水), and each
 * must be read aloud in its own language.
 */
export function clipHash(text: string, voiceId: string, language: string): string {
  return sha1(voiceId, language, text)
}

/**
 * The key clips had before the language was part of it. Only read to adopt an
 * old recording (see `adoptLegacyClip` in the service), never written.
 */
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

/** Removes a clip's file and row. */
export function removeClip(db: Db, dataDir: string, hash: string): void {
  rmSync(clipPath(dataDir, hash), { force: true })
  db.delete(audioBlobs).where(eq(audioBlobs.hash, hash)).run()
}

/** True when the row and its file both exist (a row without a file is useless). */
export function hasClip(db: Db, dataDir: string, hash: string): boolean {
  return Boolean(findClip(db, hash)) && existsSync(clipPath(dataDir, hash))
}
