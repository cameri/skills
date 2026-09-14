/**
 * Atomic file writes.
 *
 * The whole point of this module: a crash must never leave a half-written state
 * file behind. `cronjobs` wrote its job store with a bare `writeFileSync`, so a
 * crash or a full disk mid-write truncated every job on the host. Every state
 * file this plugin owns goes through here instead.
 *
 * Sequence: write a sibling temp file → fsync it → rename over the target →
 * fsync the directory. The rename is atomic within a filesystem, so a reader
 * sees either the old file or the new one, never a partial one; the two fsyncs
 * are what make that survivable across a machine crash rather than only across
 * a process crash.
 *
 * `writeTemp` and `commitTemp` are exported separately so a test can stop in
 * the middle — the window a crash would hit — and prove the real file is
 * untouched there.
 */

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Sibling temp path for `file` — same directory, so the rename cannot cross a filesystem. */
export function tempPathFor(file: string): string {
  return join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
}

/**
 * Write `data` to a fresh temp file next to `file`, fsynced and closed.
 * Returns the temp path; nothing is visible at `file` yet.
 */
export function writeTemp(file: string, data: string): string {
  const temp = tempPathFor(file);
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temp;
}

/** Move a temp file into place and make the rename durable. */
export function commitTemp(temp: string, file: string): void {
  renameSync(temp, file);
  // A rename is only durable once the directory entry itself is synced.
  // Unsupported on some filesystems — never worth failing a write over.
  try {
    const dirFd = openSync(dirname(file), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    /* directory fsync unavailable; the rename is still atomic */
  }
}

/** Write a state file atomically. */
export function writeFileAtomic(file: string, data: string): void {
  commitTemp(writeTemp(file, data), file);
}

/** Remove a file, ignoring "it was already gone". */
export function unlinkQuiet(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}
