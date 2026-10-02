// Monaco themes built from the Studio's semantic tokens (--ui-*), so the code editor follows the same palette as the
// panels around it in both themes. defineTheme() accepts only hex colours: the palette is resolved from the DOM once
// per theme change and every derived shade is mixed here.

export const PALETTE_TOKENS = { page: '--ui-page', surface: '--ui-surface', raised: '--ui-surface-raised', border: '--ui-border', borderStrong: '--ui-border-strong', text: '--ui-text', muted: '--ui-muted', accent: '--ui-accent', success: '--ui-success', warning: '--ui-warning', info: '--ui-info', danger: '--ui-danger' };

const channels = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const toHex = values => `#${values.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;
/** Mixes `amount` (0–1) of colour `a` into colour `b`, like color-mix(in srgb, a amount, b). */
export function mix(a, b, amount) { const [x, y] = [channels(a), channels(b)]; return toHex(x.map((value, index) => value * amount + y[index] * (1 - amount))); }
const alpha = (hex, amount) => `${hex}${Math.round(amount * 255).toString(16).padStart(2, '0')}`;
const bare = hex => hex.slice(1);

/** Theme data for monaco.editor.defineTheme from a resolved palette (#rrggbb values) and a colour scheme. */
export function studioMonacoTheme(palette, scheme) {
  const dark = scheme === 'dark', p = palette;
  // Syntax colours are the semantic tokens, softened toward the text colour so they read as one family:
  // pastel on the dark surface, slightly deeper on the light one.
  const syntax = colour => mix(colour, p.text, dark ? .72 : .86);
  const accent = syntax(p.accent), string = syntax(p.success), warm = syntax(p.warning), cool = dark ? mix(p.info, p.text, .55) : syntax(p.info);
  const comment = mix(p.muted, p.surface, .85), punctuation = mix(p.muted, p.text, .6);
  return {
    base: dark ? 'vs-dark' : 'vs', inherit: true,
    rules: [
      { token: '', foreground: bare(p.text) },
      { token: 'comment', foreground: bare(comment), fontStyle: 'italic' },
      { token: 'keyword.directive', foreground: bare(accent), fontStyle: 'bold' },
      { token: 'delimiter.template', foreground: bare(accent) },
      { token: 'tag', foreground: bare(accent) },
      { token: 'metatag', foreground: bare(comment) },
      { token: 'keyword', foreground: bare(cool) },
      { token: 'type', foreground: bare(cool) },
      { token: 'type.identifier', foreground: bare(cool) },
      { token: 'entity.name.function', foreground: bare(warm) },
      { token: 'attribute.name', foreground: bare(warm) },
      { token: 'attribute.value', foreground: bare(string) },
      { token: 'string', foreground: bare(string) },
      { token: 'string.escape', foreground: bare(warm) },
      { token: 'number', foreground: bare(warm) },
      { token: 'variable', foreground: bare(p.text) },
      { token: 'variable.predefined', foreground: bare(cool) },
      { token: 'variable.parameter', foreground: bare(p.text) },
      { token: 'delimiter', foreground: bare(punctuation) },
      { token: 'regexp', foreground: bare(warm) },
      { token: 'invalid', foreground: bare(p.danger) },
    ],
    colors: {
      'editor.background': p.surface, 'editor.foreground': p.text, 'editorGutter.background': p.surface,
      'editorLineNumber.foreground': mix(p.muted, p.surface, .55), 'editorLineNumber.activeForeground': p.text,
      'editor.lineHighlightBackground': mix(p.text, p.surface, dark ? .05 : .035), 'editor.lineHighlightBorder': alpha(p.surface, 0),
      'editor.selectionBackground': alpha(p.accent, dark ? .3 : .22), 'editor.inactiveSelectionBackground': alpha(p.accent, .12),
      'editor.selectionHighlightBackground': alpha(p.accent, .12), 'editor.wordHighlightBackground': alpha(p.info, .16),
      'editor.findMatchBackground': alpha(p.warning, .45), 'editor.findMatchHighlightBackground': alpha(p.warning, .2),
      'editorCursor.foreground': p.accent, 'editorWhitespace.foreground': p.border,
      'editorIndentGuide.background1': mix(p.border, p.surface, .7), 'editorIndentGuide.activeBackground1': p.borderStrong,
      'editorBracketMatch.background': alpha(p.accent, .14), 'editorBracketMatch.border': alpha(p.accent, .5),
      // Bracket pair colours ({{ }}, (), []) cycle through the syntax family instead of Monaco's gold/blue defaults.
      'editorBracketHighlight.foreground1': accent, 'editorBracketHighlight.foreground2': warm, 'editorBracketHighlight.foreground3': cool,
      'editorBracketHighlight.foreground4': accent, 'editorBracketHighlight.foreground5': warm, 'editorBracketHighlight.foreground6': cool,
      'editorBracketHighlight.unexpectedBracket.foreground': p.danger,
      'editorWidget.background': p.raised, 'editorWidget.foreground': p.text, 'editorWidget.border': p.border,
      'editorSuggestWidget.background': p.surface, 'editorSuggestWidget.border': p.border, 'editorSuggestWidget.foreground': p.text,
      'editorSuggestWidget.selectedBackground': alpha(p.accent, .16), 'editorSuggestWidget.selectedForeground': p.text, 'editorSuggestWidget.highlightForeground': p.accent,
      'editorHoverWidget.background': p.surface, 'editorHoverWidget.border': p.border,
      'input.background': p.page, 'input.border': p.border, 'input.foreground': p.text, 'focusBorder': alpha(p.accent, .6),
      'scrollbarSlider.background': alpha(p.muted, .18), 'scrollbarSlider.hoverBackground': alpha(p.muted, .32), 'scrollbarSlider.activeBackground': alpha(p.muted, .45),
      'scrollbar.shadow': alpha(p.text, 0), 'editorOverviewRuler.border': alpha(p.surface, 0),
      'editorError.foreground': p.danger, 'editorWarning.foreground': p.warning, 'editorInfo.foreground': p.info,
    },
  };
}

/** Resolves the palette under `element`: any CSS colour (including color-mix) is painted into one canvas pixel and read back. */
export function readStudioPalette(element) {
  const document = element.ownerDocument, probe = document.createElement('span'), canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  probe.style.display = 'none'; element.append(probe);
  try {
    return Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([key, token]) => {
      probe.style.color = `var(${token})`;
      // An unparsable value leaves fillStyle unchanged, so reset it first.
      context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = getComputedStyle(probe).color; context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      return [key, toHex([red, green, blue])];
    }));
  } finally { probe.remove(); }
}

export function readMonoFont(element) { return getComputedStyle(element).getPropertyValue('--ui-font-mono').trim() || 'ui-monospace, Menlo, Consolas, monospace'; }
