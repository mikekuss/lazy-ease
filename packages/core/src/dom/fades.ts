/**
 * Whether the controller carries the reveal, the transparent fade-out and
 * `keepImage`. The self-starting scripts, whose markup can ask for none of
 * them, are built with this module replaced by one that exports `false`, so
 * the minifier drops these paths from them; everywhere else it inlines `true`.
 */
export const fades = true
