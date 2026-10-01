import { Download, Loader2 } from 'lucide-react';

interface Props {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
}

export default function ExportButton({ onClick, busy = false, disabled = false, title }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={title}
      className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-3 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      Exportar
    </button>
  );
}
