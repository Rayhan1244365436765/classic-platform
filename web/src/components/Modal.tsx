import { useEffect, type ReactNode } from 'react';

import { CloseIcon } from './Icons';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name of the close controls (defaults to English). */
  closeLabel?: string;
};

/**
 * Minimal accessible dialog: closes on Escape or backdrop click.
 * Rendering is controlled by the parent's state.
 */
export function Modal({ title, onClose, children, closeLabel = 'Close' }: ModalProps) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="modal__backdrop"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <div className="modal__panel">
        <header className="modal__head">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <CloseIcon className="icon" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default Modal;
