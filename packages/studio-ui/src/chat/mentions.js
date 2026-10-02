// Pure mention helpers for the chat composer (no React, loadable by node --test).

// Mention query under the caret: `@` at the start or after whitespace, up to the caret, no newline or second `@`.
// Spaces are allowed (section names have them); an e-mail address does not activate the menu.
export function mentionAtCaret(value, caret = value.length) {
  const match = value.slice(0, caret).match(/(?:^|\s)@([^@\n]*)$/);
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null;
}

// Removes the `@query` that the user typed once a target is picked; returns the caret position to restore.
export function removeMentionQuery(text, query) {
  return query ? { text: text.slice(0, query.start) + text.slice(query.end), caret: query.start } : { text, caret: text.length };
}

export const MENTION_KINDS = ['section', 'scene', 'track', 'file', 'asset', 'field'];
export const MENTION_GROUP_LABELS = { section: 'Sections', scene: 'Scenes', track: 'Tracks', file: 'Files', asset: 'Assets', field: 'Fields' };

export const mentionKey = target => `${target.kind}:${target.id}`;

// MentionTarget[] → [{ kind, items }] in the fixed kind order; empty groups are dropped, order inside a group is kept.
export function groupTargets(targets = []) {
  return MENTION_KINDS.map(kind => ({ kind, items: targets.filter(target => target.kind === kind) })).filter(group => group.items.length);
}

export function addMention(mentions, target) {
  return mentions.some(item => mentionKey(item) === mentionKey(target)) ? mentions : [...mentions, target];
}
