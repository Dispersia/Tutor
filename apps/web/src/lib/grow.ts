/* A textarea that grows with its content instead of hiding it behind a
   scrollbar. Used by the deck composer and the chat box. */
export function autoGrow(node: HTMLTextAreaElement, max = 240) {
  const fit = () => {
    const cs = getComputedStyle(node)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    node.style.height = 'auto'
    // scrollHeight covers padding but not the border, and the field is
    // border-box, so add the border back or the last line clips.
    node.style.height = Math.min(node.scrollHeight + border, max) + 'px'
  }
  fit()
  node.addEventListener('input', fit)
  return {
    update: fit,
    destroy() {
      node.removeEventListener('input', fit)
    },
  }
}
