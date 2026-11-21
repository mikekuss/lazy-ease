/**
 * Whether the controller carries the reveal and the transparent fade-out.
 * The self-starting scripts, whose markup can ask for neither, are built
 * with this module replaced by one that exports `false`, so the minifier
 * drops both paths from them; everywhere else it inlines `true`.
 */
export const fades = true
