import {Marked} from 'marked';
import sanitizeHtml from 'sanitize-html';

// Keep this allowlist aligned with template-dsl/src/TemplateRichText.php.
const policy = Object.freeze({
  allowedTags:['p','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','s','u','ul','li','blockquote','pre','code','hr','ol','a','img'],
  allowedAttributes:{ol:['start'], a:['href','title'], img:['src','alt','title']},
  allowedSchemes:['https','http','mailto'],
  allowedSchemesByTag:{img:['https','http']},
  allowProtocolRelative:false,
  disallowedTagsMode:'discard',
  nonTextTags:['script','style','textarea','option','noscript'],
  parseStyleAttributes:false,
  nestingLimit:32,
});
const markdown = new Marked({gfm:false, breaks:false, async:false, renderer:{html() { return ''; }}});

export function renderRichText(type, value) {
  if (!['markdown','wysiwyg'].includes(type)) throw new Error('Formatted output requires Markdown or Wysiwyg');
  const html = type === 'markdown' ? markdown.parse(value) : value;
  return sanitizeHtml(html, policy);
}
export function isRichTextEmpty(html) {
  // sanitize-html already removed executable tags and unsafe image sources.
  if (/<hr(?:\s|\/?\>)|<img\s[^>]*\bsrc="[^"]+"/i.test(html)) return false;
  return sanitizeHtml(html, {allowedTags:[], allowedAttributes:{}}).replace(/&(?:nbsp|#160|#xA0);/gi,' ').replace(/\s|\u200b|\ufeff/g,'') === '';
}
