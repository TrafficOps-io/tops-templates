export const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
export function focusableElements(root) {
  return [...root.querySelectorAll(focusableSelector)].filter(element => !element.closest('[hidden],[inert]') && element.getClientRects().length > 0);
}
export function activeElement(root) { return root.getRootNode().activeElement; }
export function trapFocus(event, root) {
  if (event.key !== 'Tab' || event.target.closest('.monaco-editor')) return;
  const choices = focusableElements(root), active = activeElement(root);
  if (!choices.length) { event.preventDefault(); root.focus(); return; }
  if (event.shiftKey && (active === choices[0] || !choices.includes(active))) { event.preventDefault(); choices.at(-1).focus(); }
  else if (!event.shiftKey && (active === choices.at(-1) || !choices.includes(active))) { event.preventDefault(); choices[0].focus(); }
}
