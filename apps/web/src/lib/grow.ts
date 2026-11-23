export function autoGrow(node: HTMLTextAreaElement, max = 240) {
  const fit = () => {
    const cs = getComputedStyle(node)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    node.style.height = 'auto'
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
