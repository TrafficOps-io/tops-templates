import { byteSize } from './project.js';

const imagePath = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const pageSource = /\.(?:tpl(?:\.(?:html|php))?|html?|css|js|mjs)$/i;

function documentLanguages(files) {
  const languages = [];
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !/\.(?:tpl(?:\.(?:html|php))?|html?)$/i.test(path)) continue;
    for (const tag of content.matchAll(/<html\b([^>]*)>/gi)) {
      const attribute = tag[1].match(/(?:^|\s)lang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const language = attribute?.slice(1).find(value => value !== undefined);
      // Dynamic TPL expressions are field content, not a hardcoded language.
      if (language && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(language)) languages.push({ path, language: language.toLowerCase() });
    }
  }
  return languages;
}

function cleanField(field) {
  const keys = ['name', 'label', 'help', 'type', 'required', 'options', 'min', 'max', 'min_items', 'max_items', 'aiInstructions', 'aspect_ratio', 'sizes'];
  const clean = Object.fromEntries(keys.filter(key => field[key] !== undefined).map(key => [key, field[key]]));
  if (field.fields) clean.fields = field.fields.map(cleanField);
  return clean;
}

// Planning and content generation need the actual editable schema and values,
// not a second copy of every source file, SVG or unrelated project document.
export function aiProjectContext({ files = {}, values = {}, definition, reviewSources = false, changedPaths = [] }) {
  const fields = definition?.fields || definition?.sections?.flatMap(section => section.fields);
  const manifest = Object.entries(files).map(([path, content]) => ({ path, bytes: byteSize(content), text: typeof content === 'string' }));
  const context = {
    ...(definition ? { template: { name: definition.name, description: definition.description }, fields: fields?.map(cleanField) } : {}),
    values,
    files: manifest,
    assets: Object.keys(files).filter(path => imagePath.test(path) || typeof files[path] !== 'string'),
    documentLanguages: documentLanguages(files),
  };
  if (reviewSources) {
    const changed = new Set(changedPaths);
    context.sources = Object.fromEntries(Object.entries(files).filter(([path, content]) => typeof content === 'string' && (pageSource.test(path) || changed.has(path))));
  }
  const text = JSON.stringify(context);
  if (byteSize(text) > 350 * 1024) throw new Error('This project has too much relevant content for AI review. Reduce large page sources or field values first.');
  return text;
}
