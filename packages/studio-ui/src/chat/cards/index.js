import { createElement } from 'react';
import DiffCard from './DiffCard.jsx';
import ValuesCard from './ValuesCard.jsx';
import ImageCard from './ImageCard.jsx';
import AudioCard from './AudioCard.jsx';
import VideoCard from './VideoCard.jsx';
import FileCard from './FileCard.jsx';
import OperationCard from './OperationCard.jsx';
import QuestionCard from './QuestionCard.jsx';
import StepCard from './StepCard.jsx';

export const cardComponents = { diff: DiffCard, values: ValuesCard, image: ImageCard, audio: AudioCard, video: VideoCard, file: FileCard, operation: OperationCard, question: QuestionCard, step: StepCard };

// part: tool-call part { toolCallId, toolName, result }. Every card is an <article data-testid="studio-chat-card"
// data-card={type}> (CardFrame), the step card a one-line <div> with the same hooks; an unknown toolName or a non-object result falls back to FileCard with raw = the original result.
// options: { can(action) — the port supports the action, capabilities — port.capabilities }.
export function renderCard(part, onAction, { can = () => false, capabilities } = {}) {
  // A missing or malformed result (not an object) falls back to FileCard instead of crashing the feed.
  const valid = part.result !== null && typeof part.result === 'object' && !Array.isArray(part.result);
  const known = valid ? cardComponents[part.toolName] : undefined;
  const type = known ? part.toolName : 'file';
  const card = known ? part.result : { type: 'file', name: part.toolName || 'result', bytes: undefined, raw: part.result };
  return createElement(known ?? FileCard, { key: part.toolCallId, card, onAction, can, capabilities, frame: { 'data-card': type } });
}
