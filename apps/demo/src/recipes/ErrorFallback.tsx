import { type ImageLoader } from '@lazy-ease/react'
import { useState } from 'react'
import { DemoImage } from '../DemoImage'

/**
 * What a failed load looks like, three ways, all with what the library has
 * today: the box keeps its size and the placeholder goes, the image gets
 * `data-state="error"`. The source does not exist, so every load fails.
 */
const MISSING = { src: '/missing-photo.jpg', srcWidth: 1600, srcHeight: 1067, width: 240, height: 160, placeholder: '#a8a29e' }

export function ErrorFallback({ loader }: { loader: ImageLoader }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="errors">
      <div>
        <DemoImage {...MISSING} loader={loader} alt="A photo that is not there" wrapperClassName="reserved" label="Default: the layout holds" />
        <code className="variant-code">data-state="error"</code>
      </div>
      <div>
        <DemoImage {...MISSING} loader={loader} alt="A photo that is not there" wrapperClassName="fallback" label="Styled with CSS" />
        <code className="variant-code">[data-le][data-state="error"] {"{ … }"}</code>
      </div>
      <div className="own-fallback">
        <DemoImage
          {...MISSING}
          loader={loader}
          alt="A photo that is not there"
          onStateChange={(state) => setFailed(state === 'error')}
          label="Your own UI"
        />
        <code className="variant-code">onStateChange={'{(state) => …}'}</code>
        {failed && (
          <div className="own-fallback-ui" role="status">
            <b>Photo unavailable</b>
            <span>Click to try again.</span>
          </div>
        )}
      </div>
    </div>
  )
}
