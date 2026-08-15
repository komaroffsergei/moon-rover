import type { ReactNode } from 'react';

interface ModalProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly tone?: 'default' | 'danger' | 'success';
  readonly onDismiss?: () => void;
}

export function Modal({
  title,
  children,
  footer,
  tone = 'default',
  onDismiss,
}: ModalProps) {
  return (
    <div className="modal-backdrop">
      <section
        className={`modal-card modal-card--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-modal-title"
      >
        <header className="modal-card__header">
          <h2 id="active-modal-title">{title}</h2>
          {onDismiss ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={onDismiss}
            >
              ×
            </button>
          ) : null}
        </header>
        <div className="modal-card__body">{children}</div>
        <footer className="modal-card__footer">{footer}</footer>
      </section>
    </div>
  );
}
