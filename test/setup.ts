import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

export const TESTING_ROOT = resolve(import.meta.dir, "..", "testing")

// testing/ is wiped by the `test` npm script before workers start (see
// package.json). Each worker process just makes sure the dir exists.
mkdirSync(TESTING_ROOT, { recursive: true })
