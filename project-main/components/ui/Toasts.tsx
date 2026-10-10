'use client';
export interface ToastItem { id: number; msg: string; kind: 'ok' | 'err' }
export default function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
    </div>
  );
}
