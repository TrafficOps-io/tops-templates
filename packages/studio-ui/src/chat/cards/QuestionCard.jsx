import { useId, useState } from 'react';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import Button from '../../primitives/Button.jsx';
import CardFrame from './CardFrame.jsx';

// card: QuestionCard { questionId, text, options?, answered?, kind?: 'conflict', references? }
// kind 'conflict' is the apply gate (landing): "reviewed" → apply(runId, { allowStaleContext: true }) once the checkbox
// is ticked and capabilities.conflictReview is on; "rebase" → answer(questionId, 'rebase'); Discard → discard(runId).
// reviewed/rebase are rendered only when present in options; raw option strings never reach the markup.
export default function QuestionCard({ card, onAction, can, capabilities, frame }) {
  return card.kind === 'conflict'
    ? <ConflictQuestion card={card} onAction={onAction} can={can} capabilities={capabilities} frame={frame} />
    : <PlainQuestion card={card} onAction={onAction} can={can} frame={frame} />;
}

function PlainQuestion({ card, onAction, can, frame }) {
  const t = useStudioText(), [answer, setAnswer] = useState('');
  const disabled = Boolean(card.answered) || !can('answer');
  return <CardFrame type="question" icon={CircleHelp} title={card.text} meta={card.answered ? t('Answered') : undefined} frame={frame}>
    {card.options?.length
      ? <div className="studio-card-options" role="group" aria-label={card.text}>
        {card.options.map(option => <Button key={option} size="sm" disabled={disabled} onClick={() => onAction('answer', card, option)}>{option}</Button>)}
      </div>
      : <form className="studio-card-answer" onSubmit={event => { event.preventDefault(); if (answer.trim()) onAction('answer', card, answer.trim()); }}>
        <input className="studio-card-input" aria-label={t('Your answer')} value={answer} disabled={disabled} placeholder={t('Your answer')} onChange={event => setAnswer(event.target.value)} />
        <Button type="submit" size="sm" variant="primary" disabled={disabled || !answer.trim()}>{t('Answer')}</Button>
      </form>}
  </CardFrame>;
}

function ConflictQuestion({ card, onAction, can, capabilities, frame }) {
  const t = useStudioText(), [reviewed, setReviewed] = useState(false), checkboxId = useId();
  const options = card.options ?? [], answered = Boolean(card.answered);
  const offerReviewed = options.includes('reviewed') && can('apply'), offerRebase = options.includes('rebase') && can('answer');
  return <CardFrame type="question" icon={TriangleAlert} title={card.text} meta={answered ? t('Answered') : undefined} frame={frame}>
    {card.references?.length > 0 && <ul className="studio-card-references" aria-label={t('Changed files')}>
      {card.references.map(reference => <li key={reference}>{reference}</li>)}
    </ul>}
    {offerReviewed && <label htmlFor={checkboxId} className="studio-card-check">
      <input id={checkboxId} type="checkbox" checked={reviewed} disabled={answered} onChange={event => setReviewed(event.target.checked)} />
      {t('I reviewed the current files')}
    </label>}
    <div className="studio-card-options">
      {offerReviewed && <Button size="sm" variant="primary" disabled={answered || !reviewed || !capabilities?.conflictReview} onClick={() => onAction('apply', card, { allowStaleContext: true })}>{t('Apply after reviewing updated context')}</Button>}
      {offerRebase && <Button size="sm" disabled={answered} onClick={() => onAction('answer', card, 'rebase')}>{t('Continue with current project')}</Button>}
      {can('discard') && <Button size="sm" variant="ghost" disabled={answered} onClick={() => onAction('discard', card)}>{t('Discard')}</Button>}
    </div>
  </CardFrame>;
}
