import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog
    ref={dialogRef}
    className="modal"
    aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <h2 id={titleId}>{title}</h2>
    <button className="modal-close" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
    {children}
  </dialog>;
}
