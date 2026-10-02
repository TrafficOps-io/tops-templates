export const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
export function focusableElements(root) {
  return [...root.querySelectorAll(focusableSelector)].filter(element => !element.closest('[hidden],[inert]') && element.getClientRects().length > 0);
}
export function activeElement(root) { return root.getRootNode().activeElement; }
export function trapFocus(event, root, { ignoreWithin = '.monaco-editor' } = {}) {
  if (event.key !== 'Tab' || (ignoreWithin && event.target.closest(ignoreWithin))) return;
  const choices = focusableElements(root), active = activeElement(root);
  if (!choices.length) { event.preventDefault(); root.focus(); return; }
  if (event.shiftKey && (active === choices[0] || !choices.includes(active))) { event.preventDefault(); choices.at(-1).focus(); }
  else if (!event.shiftKey && (active === choices.at(-1) || !choices.includes(active))) { event.preventDefault(); choices[0].focus(); }
}
// Makes everything inside `root` except `layer` and its ancestors inert; returns a function that undoes exactly what it set.
export function inertOutside(root, layer) {
  const marked = [];
  for (let node = layer; node && node !== root && root.contains(node); node = node.parentElement) {
    for (const sibling of node.parentElement?.children || []) if (sibling !== node && !sibling.hasAttribute('inert')) { sibling.setAttribute('inert', ''); marked.push(sibling); }
  }
  return () => { for (const element of marked) element.removeAttribute('inert'); };
}
