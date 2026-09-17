/** Quote-aware HTML context checking. Data remains opaque until final encoding. */
export function encodeSegments(segments, {fail, escape, safeUrl, bytes, maxBytes}) {
  const marker = '\u0001'; let markup = ''; const values = [];
  for (const segment of segments) {
    if (segment.literal) { if (segment.value.includes(marker)) fail('Control characters are forbidden in markup'); markup += segment.value; }
    else { markup += `${marker}${values.length}${marker}`; values.push(segment); }
  }
  const pattern = /\u0001(\d+)\u0001/g;
  const valueOf = (token) => values[Number(token.slice(1,-1))];
  const text = (part, richAllowed = true) => part.replace(pattern, (token) => { const value = valueOf(token); if (value.runtime === 'actions') fail('Action tokens belong in href, action or formaction attributes'); if (value.rich) { if (!richAllowed) fail('Formatted output cannot appear in title or textarea'); return value.value; } return escape(value.value); });
  const css = (part) => part.replace(pattern, (token) => { const value = valueOf(token); if (value.runtime || !['color','number','range'].includes(value.fieldType)) fail('CSS interpolation only accepts Color, Number or Range settings'); return escape(value.value); });
  const tagEnd = (start) => {
    let quote = '';
    for (let position = start + 1; position < markup.length; position++) {
      const char = markup[position];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') return position + 1;
    }
    return markup.length;
  };
  const rewriteTag = (tag, name, closing) => {
    if (!tag.includes(marker)) return tag;
    if (closing || ['script','iframe','object','embed','meta','base'].includes(name)) fail(`Dynamic values are forbidden in ${name} tags`);
    const prefix = /^<[A-Za-z][A-Za-z0-9:-]*/.exec(tag)[0]; let position = prefix.length, rewritten = prefix;
    while (position < tag.length) {
      const tail = tag.slice(position);
      if (/^\s*\/?\s*>$/.test(tail)) { rewritten += tail; position = tag.length; break; }
      const attr = /^(\s+)([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(tail);
      if (!attr) fail('Dynamic values require well-formed HTML attributes');
      const [whole, space, attribute, double, single, unquoted] = attr, lower = attribute.toLowerCase(), value = double ?? single ?? unquoted;
      if (whole.includes(marker)) {
        if (double === undefined && single === undefined || /^on/.test(lower) || lower === 'srcdoc') fail(`Dynamic values are forbidden in ${attribute}`);
        if (!/^(?:style|href|src|action|formaction|poster|alt|title|value|placeholder|id|class|name|content|lang|role|aria-[\w-]+|data-[\w-]+)$/.test(lower)) fail(`Unsupported dynamic attribute ${attribute}`);
        const url = ['href','src','action','formaction','poster'].includes(lower);
        const interpolated = value.replace(pattern, (token) => {
          const segment = valueOf(token);
          if (segment.rich) fail('Formatted output cannot appear in an attribute');
          if (lower === 'style') { if (segment.runtime || !['color','number','range'].includes(segment.fieldType)) fail('CSS interpolation only accepts Color, Number or Range settings'); return segment.value; }
          if (segment.runtime === 'actions') { if (!['href','action','formaction'].includes(lower) || value !== token) fail('An action token must fill an entire href/action/formaction'); return segment.value; }
          if (url && segment.runtime) { const start = value.slice(0, value.indexOf(token)); if (!/^(?:https?:\/\/[^/\s\u0001]+\/|\/(?!\/)|\.\/|[A-Za-z0-9_-]+\/)/i.test(start)) fail('Runtime URL tokens need a fixed host/path prefix'); return encodeURIComponent(segment.value); }
          return segment.value;
        });
        if (url && !safeUrl(interpolated)) fail(`Unsafe URL in ${attribute}`);
        rewritten += `${space}${attribute}=${double !== undefined ? '"' : "'"}${escape(interpolated)}${double !== undefined ? '"' : "'"}`;
      } else rewritten += whole;
      position += whole.length;
    }
    if (!tag.endsWith('>')) fail('Unclosed HTML tag containing dynamic values');
    return rewritten;
  };
  let result = '', cursor = 0, active = null;
  while (cursor < markup.length) {
    if (active) {
      // HTML raw text closes only on its own end tag, even inside JS/CSS strings.
      const close = new RegExp(`</${active}(?=[\\t\\n\\f\\r />])`, 'ig'); close.lastIndex = cursor; const match = active === 'plaintext' ? null : close.exec(markup);
      const end = match ? match.index : markup.length, content = markup.slice(cursor,end);
      // Legacy script escape states can make the browser ignore the first
      // apparent closing tag. Reject this uncommon author syntax explicitly.
      if (active === 'script' && /<!--|<script(?=[\t\n\f\r />])/i.test(content)) fail('Legacy escaped or nested script source is not supported');
      if (active === 'script' || ['xmp','plaintext','noembed','noframes','noscript'].includes(active)) { if (content.includes(marker)) fail(`Dynamic values are forbidden inside ${active}`); result += content; }
      else result += active === 'style' ? css(content) : text(content,false);
      cursor = end; if (!match) break;
      const finish = tagEnd(cursor), tag = markup.slice(cursor,finish);
      if (tag.includes(marker)) fail('Dynamic values are forbidden in closing tags');
      result += tag; cursor = finish; active = null; continue;
    }
    const opening = markup.indexOf('<',cursor);
    if (opening < 0) { result += text(markup.slice(cursor)); break; }
    result += text(markup.slice(cursor,opening)); cursor = opening;
    if (markup.startsWith('<!--',cursor)) {
      const end = /--!?>/g; end.lastIndex = cursor + 4; const close = end.exec(markup), finish = close ? close.index + close[0].length : markup.length;
      const comment = markup.slice(cursor,finish); if (comment.includes(marker)) fail('Dynamic values are forbidden in comments'); result += comment; cursor = finish; continue;
    }
    if (/^<[!?]/.test(markup.slice(cursor,cursor+2))) {
      const end = markup.indexOf('>',cursor + 2), finish = end < 0 ? markup.length : end + 1, declaration = markup.slice(cursor,finish);
      if (declaration.includes(marker)) fail('Dynamic values are forbidden in declarations'); result += declaration; cursor = finish; continue;
    }
    const start = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(markup.slice(cursor));
    if (!start) {
      const end = markup.indexOf('>',cursor + 1), part = markup.slice(cursor,end < 0 ? markup.length : end + 1);
      if (part.includes(marker)) fail('Dynamic values are forbidden in malformed tags');
      result += '<'; cursor++; continue;
    }
    const finish = tagEnd(cursor), tag = markup.slice(cursor,finish), name = start[2].toLowerCase(), closing = !!start[1];
    result += rewriteTag(tag,name,closing); cursor = finish;
    if (!closing && ['script','style','title','textarea','xmp','plaintext','noembed','noframes','noscript'].includes(name)) active = name;
  }
  if (bytes(result) > maxBytes) fail('Rendered output exceeds 8 MiB');
  return result;
}
