const toolFields = Object.freeze({
  set_file: ['path', 'content'], set_files: ['files', 'path', 'content'],
  edit_file: ['path', 'search', 'replace'], patch_file: ['path', 'search', 'replace'],
  set_values: ['values'], generate_image: ['path', 'prompt', 'referenceIds'],
  read_file: ['path'], read_files: ['paths'], remove_file: ['path'], delete_file: ['path'],
  get_fields: [], list_files: [], validate_draft: [],
});
const tools = new Set([...Object.keys(toolFields), 'submit_plan', 'submit_review', 'unknown']);
const fields = new Set(['path', 'content', 'files', 'search', 'replace', 'values', 'paths', 'prompt', 'referenceIds', 'input']);
const codes = new Set(['invalid_type', 'too_big', 'too_small', 'invalid_format', 'invalid_value', 'invalid_union', 'unrecognized_keys', 'custom', 'invalid_json', 'unknown_tool', 'invalid_input']);
const MAX_REPORTED_CHARS = 16 * 1024 * 1024;

export function aiDiagnosticToolName(value) { return tools.has(value) ? value : 'unknown'; }

// Apply this allowlist again at the export boundary. Never copy tool arguments,
// arbitrary property names, private file paths, or SDK error text into a log.
export function sanitizeAiToolValidationEvent(event) {
  if (event?.type !== 'tool-validation' || !tools.has(event.tool) || !fields.has(event.issueField) || !codes.has(event.issueCode)) return null;
  const result = { type: 'tool-validation', tool: event.tool, issueField: event.issueField, issueCode: event.issueCode };
  for (const key of ['inputChars', 'limit']) {
    if (Number.isSafeInteger(event[key]) && event[key] >= 0 && event[key] <= MAX_REPORTED_CHARS) result[key] = event[key];
  }
  return result;
}

function fieldValue(input, path, tool) {
  const first = path?.[0];
  if (typeof first !== 'string' || !toolFields[tool]?.includes(first)) return { field: 'input' };
  if (first === 'files' && path.length === 3 && Number.isSafeInteger(path[1]) && path[1] >= 0 && path[1] < 3 && ['path', 'content'].includes(path[2])) {
    return { field: path[2], value: input?.files?.[path[1]]?.[path[2]] };
  }
  return { field: first, value: path.length === 1 ? input?.[first] : undefined };
}

function messageFor(event) {
  if (event.issueCode === 'too_big' && event.inputChars !== undefined && event.limit !== undefined) {
    const correction = event.issueField === 'prompt' ? 'Shorten the image prompt before retrying.' : 'Write a compact file, then expand it with focused edit_file calls.';
    return `${event.tool} ${event.issueField} has ${event.inputChars} characters; the limit is ${event.limit}. ${correction}`;
  }
  if (event.issueCode === 'invalid_type') return `${event.tool} requires a valid ${event.issueField} argument. Supply the required fields with their declared types.`;
  if (event.issueCode === 'invalid_json') return 'The tool arguments are not valid JSON. Submit a complete tool call with its required fields.';
  if (event.issueCode === 'unknown_tool') return 'The model called an unavailable tool. Use one of the tools supplied for this step.';
  return `${event.tool} rejected its ${event.issueField} argument. Correct the tool input before retrying.`;
}

// The SDK keeps typed Zod issues on invalid tool calls even though its separate
// tool-error event contains a freeform message. Inspect only bounded issue data.
export function aiToolValidationEvents(toolCall) {
  if (toolCall?.invalid !== true) return [];
  const tool = aiDiagnosticToolName(toolCall.toolName);
  const seen = new Set();
  let error = toolCall.error, issues, fallback = tool === 'unknown' ? 'unknown_tool' : 'invalid_input';
  for (let depth = 0; error && depth < 5 && !seen.has(error); depth++) {
    seen.add(error);
    if (error.name === 'AI_JSONParseError') fallback = 'invalid_json';
    if (Array.isArray(error.issues)) { issues = error.issues.slice(0, 4); break; }
    error = error.cause;
  }
  const events = (issues?.length ? issues : [null]).map(issue => {
    const { field, value } = fieldValue(toolCall.input, issue?.path, tool);
    const metadata = { type: 'tool-validation', tool, issueField: field,
      issueCode: issue && codes.has(issue.code) ? issue.code : fallback };
    if (typeof value === 'string') metadata.inputChars = value.length;
    if (issue?.origin === 'string' && issue.code === 'too_big') metadata.limit = issue.maximum;
    const safe = sanitizeAiToolValidationEvent(metadata);
    return { ...safe, message: messageFor(safe) };
  });
  return events.filter((event, index) => events.findIndex(other => other.tool === event.tool && other.issueField === event.issueField && other.issueCode === event.issueCode) === index);
}
