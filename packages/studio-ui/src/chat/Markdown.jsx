import { useMemo } from 'react';
import { parseMarkdown } from './markdown.js';

// Own lightweight renderer: Streamdown was rejected by the spike (ads-toolbox
// docs/superpowers/plans/2026-10-01-studio-ui-spike-result.md). Parsing lives in markdown.js; this component only
// turns the tree into React elements — text is always a React child, never inserted HTML.
const HEADINGS = { 1: 'h3', 2: 'h4', 3: 'h5' };

function Inline({ nodes }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'strong': return <strong key={index}><Inline nodes={node.children} /></strong>;
      case 'em': return <em key={index}><Inline nodes={node.children} /></em>;
      case 'code': return <code key={index}>{node.text}</code>;
      case 'break': return <br key={index} />;
      default: return node.text;
    }
  });
}

function Block({ block }) {
  switch (block.type) {
    case 'heading': { const Tag = HEADINGS[block.level] || 'h5'; return <Tag><Inline nodes={block.children} /></Tag>; }
    case 'code': return <pre data-lang={block.lang || undefined} tabIndex={0}><code>{block.text}</code></pre>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}><Inline nodes={item} /></li>);
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    default: return <p><Inline nodes={block.children} /></p>;
  }
}

export default function Markdown({ text, className = '' }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`studio-chat-markdown ${className}`}>{blocks.map((block, index) => <Block key={index} block={block} />)}</div>;
}
