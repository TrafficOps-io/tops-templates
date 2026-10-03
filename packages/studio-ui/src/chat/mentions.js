// Pure mention helpers for the chat composer (no React, loadable by node --test).

// Mention query under the caret: `@` at the start or after whitespace, up to the caret, no newline or second `@`.
// Spaces are allowed (section names have them); an e-mail address does not activate the menu.
export function mentionAtCaret(value, caret = value.length, mentions = []) {
  const match = value.slice(0, caret).match(/(?:^|\s)@([^@\n]*)$/);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  // Continuing a sentence after a selected reference must not reopen its picker.
  if (mentionSegments(value, mentions).some(part => part.target && part.start === start)) return null;
  return { start, end: caret, query: match[1] };
}

export const mentionText = target => `@${target.label}`;

// Two scenes/files can share a name. Give them distinct inline text so deleting one never keeps the other reference.
export function inlineMentionTarget(target, candidates = []) {
  const others = candidates.filter(item => item.label === target.label && mentionKey(item) !== mentionKey(target));
  if (!others.length) return target;
  const detail = target.detail && others.every(item => item.detail !== target.detail) ? target.detail : target.id;
  return { ...target, label: `${target.label} (${detail})` };
}

// Replace only the query at the caret. The reference stays in the actual text (copy/paste, history and providers).
export function insertMention(text, query, target) {
  const start = query?.start ?? text.length, end = query?.end ?? start;
  const token = mentionText(target), suffix = text.slice(end);
  const space = !suffix || !/^\s/.test(suffix) ? ' ' : '';
  return { text: text.slice(0, start) + token + space + suffix, caret: start + token.length + (space || suffix.startsWith(' ') ? 1 : 0) };
}

// Match only selected references, longest label first; emails and partial names are ordinary text.
// Offsets are derived from the text so edits before a reference, wrapping and repeated mentions stay in sync.
export function mentionSegments(text, mentions = []) {
  const targets = [...mentions].sort((a, b) => mentionText(b).length - mentionText(a).length);
  const parts = []; let plain = 0;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '@' || (start && !/\s/.test(text[start - 1]))) continue;
    const target = targets.find(item => {
      const token = mentionText(item), end = start + token.length;
      return text.startsWith(token, start) && (end === text.length || !/[\p{L}\p{N}_/\-]/u.test(text[end]));
    });
    if (!target) continue;
    if (start > plain) parts.push({ text: text.slice(plain, start), start: plain });
    const token = mentionText(target);
    parts.push({ text: token, target, start, end: start + token.length });
    start += token.length - 1; plain = start + 1;
  }
  if (plain < text.length) parts.push({ text: text.slice(plain), start: plain });
  return parts;
}

export function mentionsInText(text, mentions = []) {
  const keys = new Set(mentionSegments(text, mentions).filter(part => part.target).map(part => mentionKey(part.target)));
  return mentions.filter(target => keys.has(mentionKey(target)));
}

// Context actions (e.g. "Ask AI about this file") seed inline references as part of the editable draft.
export function textWithMentions(text = '', mentions = []) {
  const present = new Set(mentionsInText(text, mentions).map(mentionKey));
  const missing = mentions.filter(target => !present.has(mentionKey(target))).map(mentionText);
  return missing.length ? `${text}${text && !/\s$/.test(text) ? ' ' : ''}${missing.join(' ')} ` : text;
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
