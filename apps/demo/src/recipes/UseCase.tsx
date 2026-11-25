import { useState, type ReactNode } from 'react'

/**
 * One use case: a title, one short line, its own controls if it has any, the
 * demo, and the props it passes. Replay remounts the demo; `children` gets
 * the replay count, so the case can put it into its URLs and start from the
 * placeholder again.
 */
export function UseCase({ id, title, note, controls, props, html, replayable = true, children }: {
  id: string
  title: string
  note: ReactNode
  controls?: ReactNode
  props: string
  /** The same as HTML for the vanilla script, where there is one: React and HTML tabs then. */
  html?: string
  /** False where loading again shows nothing new, so there is no Replay. */
  replayable?: boolean
  children: (replay: number) => ReactNode
}) {
  const [replay, setReplay] = useState(0)
  return (
    <section className="usecase" id={id}>
      <header>
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
        {html !== undefined && (
          <div className="flavors" role="group" aria-label="Code">
            <button type="button" data-flavor-pick="react">React</button>
            <button type="button" data-flavor-pick="html">HTML</button>
          </div>
        )}
        {replayable && (
          <button type="button" onClick={() => setReplay((value) => value + 1)} title="Load again with new URLs">
            ↻ Replay
          </button>
        )}
      </header>
      {controls && <div className="usecase-bar">{controls}</div>}
      <div className="usecase-stage" key={replay}>
        {children(replay)}
      </div>
      {[props, html].map(
        (code, i) =>
          code !== undefined && (
            <div key={i} className={html === undefined ? 'copyable' : `copyable ${i ? 'flavor-html' : 'flavor-react'}`}>
              <code className="usecase-props">{code}</code>
              <button type="button" className="copy light" onClick={() => void navigator.clipboard?.writeText(code)}>
                Copy
              </button>
            </div>
          ),
      )}
    </section>
  )
}

/** A labelled select for a bar. */
export function Choice<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find(([key]) => String(key) === e.target.value)![0])}>
        {options.map(([key, text]) => (
          <option key={String(key)} value={String(key)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
