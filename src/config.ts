import { Config } from "effect"

export interface MemoryCliConfig {
  readonly rootDir: string
  readonly templateDir: string
}

export const memoryCliConfig: Config.Config<MemoryCliConfig> = Config.all({
  rootDir: Config.string("MEMORY_DIR").pipe(Config.withDefault("memory-data")),
  templateDir: Config.string("MEMORY_TEMPLATE_DIR").pipe(Config.withDefault("templates")),
})

export const loadMemoryCliConfig = Config.unwrap(memoryCliConfig)
