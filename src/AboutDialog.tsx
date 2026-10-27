import { useEffect, useId, useRef } from 'react';
import { ArrowUpRight, Globe2, Sparkles, X } from 'lucide-react';
import './about.css';

interface AboutDialogProps {
  onClose: () => void;
  onWebsite: () => void;
  onX: () => void;
  xHandle?: string;
}

export function AboutDialog({ onClose, onWebsite, onX, xHandle = '@ronmillar' }: AboutDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) closeButton.current?.focus();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="about-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) {
        event.preventDefault();
        onClose();
      }
    }}>
      <section ref={panel} className="about-splash" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <button ref={closeButton} className="about-close" type="button" onClick={onClose} aria-label="Close About">
          <X size={20} />
        </button>

        <div className="about-art" aria-hidden="true">
          <div className="about-orbit about-orbit-outer" />
          <div className="about-orbit about-orbit-inner" />
          <svg className="about-deck" viewBox="0 0 240 180" fill="none">
            <g className="about-card about-card-bottom">
              <path d="m120 78 78 40-78 41-78-41 78-40Z" />
              <path className="about-card-edge" d="m42 118 78 41 78-41" />
            </g>
            <g className="about-card about-card-middle">
              <path d="m120 49 78 40-78 41-78-41 78-40Z" />
              <path className="about-card-edge" d="m42 89 78 41 78-41" />
            </g>
            <g className="about-card about-card-top">
              <path d="m120 20 78 40-78 41-78-41 78-40Z" />
              <path className="about-card-mark" d="m91 60 29-15 29 15-29 15-29-15Z" />
            </g>
          </svg>
          <span className="about-spark about-spark-one">✦</span>
          <span className="about-spark about-spark-two">✧</span>
          <span className="about-spark about-spark-three">✦</span>
          <span className="about-dot about-dot-one" />
          <span className="about-dot about-dot-two" />
        </div>

        <div className="about-copy">
          <p className="about-eyebrow">A little less noise. A lot more possibility.</p>
          <h2 id={titleId}>GrokDeck<span aria-hidden="true">.</span></h2>
          <p className="about-credit">GrokDeck by Ron Millar 2026</p>
          <p className="about-description" id={descriptionId}>
            A clearer Grok Bot experience for people with lots of agents.
            Your favorites, conversations, and computers—together in a space that feels like yours.
          </p>
          <div className="about-links">
            <button className="about-link about-link-primary" type="button" onClick={onWebsite} aria-label="Visit Ron Millar’s website">
              <Globe2 size={17} /><span>ronmillar.com</span><ArrowUpRight size={16} />
            </button>
            <button className="about-link" type="button" onClick={onX} aria-label="Visit Ron Millar on X">
              <svg className="about-x-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.5 5.4 22H2.2l7.7-8.8L1.2 2h6.5l4.4 6.8L18.9 2ZM17.8 20h1.8L6.7 3.9H4.8L17.8 20Z" />
              </svg>
              <span>{xHandle || 'Find me on X'}</span><ArrowUpRight size={16} />
            </button>
          </div>
          <div className="about-next">
            <Sparkles size={16} aria-hidden="true" />
            <p>More good things are on the way.<br /><span>Open source. MIT licensed. Fork it, make it your own, and bring your ideas.</span></p>
          </div>
          <p className="about-independent">An independent project for the way you work.</p>
        </div>
      </section>
    </div>
  );
}
