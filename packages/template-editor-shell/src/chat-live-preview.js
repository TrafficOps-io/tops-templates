// Live preview of a conversation run (EditorShell ShellChat): while the open conversation's latest run works, the preview
// follows its completed file operations (run.checkpoint), as the former single-draft assistant did. A run that becomes ready
// keeps its final draft in the preview for review (Apply/Discard close it); a run ending otherwise returns the preview to the
// project. trackedRunId is the run this logic put into the preview ('' when none).
// Returns { kind: 'show', runId, draft } | { kind: 'clear' } | { kind: 'none' }.
const ACTIVE = new Set(['queued', 'running']);

export function liveDraftPreview(run, trackedRunId) {
  const draft = run?.checkpoint;
  if (run && ACTIVE.has(run.state) && draft?.files) return { kind: 'show', runId: run.id, draft: previewOf(run, draft) };
  if (!trackedRunId) return { kind: 'none' };
  if (run?.id === trackedRunId && ACTIVE.has(run.state)) return { kind: 'none' };
  if (run?.id === trackedRunId && run.state === 'ready') {
    const ready = run.result || draft;
    return ready?.files ? { kind: 'show', runId: run.id, draft: previewOf(run, ready) } : { kind: 'none' };
  }
  return { kind: 'clear' };
}

// Same shape as chat-port previewDraft → useEditorProject previewConversationDraft.
function previewOf(run, draft) {
  return { ...draft, values: draft.values || {}, locale: run.locale, runId: run.id };
}
