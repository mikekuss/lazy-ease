import type { BuildOptions, BuildResult } from 'esbuild'

/** Builds the self-starting script; `options` adds to or overrides the published settings. */
export function buildScript<T extends BuildOptions>(options?: T): Promise<BuildResult<T>>
