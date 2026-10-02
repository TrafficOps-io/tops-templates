import { Check, LoaderCircle, X } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';

const ICONS = { running: LoaderCircle, done: Check, error: X };
const STATUS = { running: 'In progress', done: 'Done', error: 'Failed' };

// card: StepCard { label, status: running | done | error, detail?, agent? } — one compact line of agent activity
// ("✓ Read scene 2", "⟳ storyboard: storyboard", "✗ edit_track: durationMs must be > 0"). Not a draft card and not a
// CardFrame: no header, no body, no actions. The status is an icon plus a visually hidden word for screen readers.
export default function StepCard({ card, frame }) {
  const t = useStudioText();
  const status = ICONS[card.status] ? card.status : 'done', Icon = ICONS[status];
  return <div data-testid="studio-chat-card" {...frame} data-status={status} className="studio-step">
    <Icon size={14} aria-hidden="true" className="studio-step-icon" />
    <span className="studio-sr-only">{t(STATUS[status])}: </span>
    {card.agent && <span className="studio-step-agent">{card.agent}</span>}
    <span className="studio-step-label">{card.label}</span>
    {card.detail && <span className="studio-step-detail">{card.detail}</span>}
  </div>;
}
