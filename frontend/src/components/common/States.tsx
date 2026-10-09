import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) { return <p role="status" className="state">{label}</p>; }
export function ErrorState({ children }: { children: ReactNode }) { return <p role="alert" className="state state-error">{children}</p>; }
export function EmptyState({ children }: { children: ReactNode }) { return <p className="state">{children}</p>; }
