import { useAppContext } from '@/context/AppContext';
import { Calendar } from 'lucide-react';

export default function MonthFilter() {
  const { availableMonths, selectedMonths, setSelectedMonths } = useAppContext();

  if (availableMonths.length <= 1) return null;

  const toggle = (key: string) => {
    if (selectedMonths.includes(key)) {
      setSelectedMonths(selectedMonths.filter(m => m !== key));
    } else {
      setSelectedMonths([...selectedMonths, key]);
    }
  };

  const clearAll = () => setSelectedMonths([]);
  const selectAll = () => setSelectedMonths(availableMonths.map(m => m.key));

  const isFiltered = selectedMonths.length > 0;
  const activeCount = isFiltered ? selectedMonths.length : availableMonths.length;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
            Filter by Month
          </span>
          {isFiltered && (
            <span className="font-mono text-[10px] text-primary">
              {activeCount} of {availableMonths.length} selected
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={clearAll}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            All
          </button>
          <button
            onClick={selectAll}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Select All
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {availableMonths.map(m => {
          const selected = selectedMonths.includes(m.key);
          const active = !isFiltered || selected;
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className={`font-mono text-[11px] px-2.5 py-1 rounded-md border transition-all duration-200 ${
                selected
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary'
                  : active
                  ? 'bg-secondary border-border text-secondary-foreground hover:border-primary/50'
                  : 'bg-secondary border-border text-muted-foreground/50 hover:text-muted-foreground'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
