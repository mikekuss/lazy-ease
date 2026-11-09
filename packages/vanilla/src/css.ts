/**
 * The lazy-ease stylesheet, also published as `@lazy-ease/vanilla/lazy-ease.css`.
 * Adopt it in a shadow root, where the document's stylesheets don't reach.
 * Every rule has zero specificity, so any author rule wins. A box is a block
 * whose placeholder covers it, its img fills it and a picture in it adds no
 * box of its own. A deferred image hides its alt text until it errors; the
 * text stays accessible. The controller needs none of this: it sets the
 * fade and the placeholder inline.
 */
export const cssText =
  ':where([data-le]:not(img)){display:block;overflow:hidden;background-size:cover;background-position:50%;background-repeat:no-repeat}' +
  ':where([data-le]) :where(picture){display:contents}' +
  ':where([data-le]) :where(img){display:block;width:100%;height:100%;object-fit:cover}' +
  ':where([data-le]:not([data-state=error]) img,img[data-le]:not([data-state=error])):where([data-le-src],[data-le-srcset],[data-le-url]){color:transparent}\n'
