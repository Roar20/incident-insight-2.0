import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import type { DimensionSelection } from '@/lib/problemView';
import type { DimensionOptions, FacetCounts } from '@/lib/serviceDimension';

/**
 * The popover is dark, so text uses the popover tokens; muted-foreground is
 * meant for the light page background and is too dark here.
 */
const COUNT_CLASS = 'font-mono text-[11px] text-popover-foreground/75';

interface Props {
  /** e.g. "Service". */
  label: string;
  /** e.g. "All Services" — shown when nothing is selected. */
  allLabel: string;
  /** e.g. "No Service" — the option for incidents with no value. */
  missingLabel: string;
  options: DimensionOptions;
  counts: FacetCounts;
  selection: DimensionSelection;
  onChange: (selection: DimensionSelection) => void;
}

/**
 * Multi-select for one global dimension filter.
 *
 * The option list is fixed for the loaded file. Counts show incidents under the
 * other filters, never this one's own selection, so picking an option does not
 * change its own count. An option at zero is disabled unless it is selected;
 * a selected option is never dropped.
 */
export default function DimensionFilter({ label, allLabel, missingLabel, options, counts, selection, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selection.values);
  const active = selection.values.length + (selection.includeMissing ? 1 : 0);

  const toggleValue = (value: string) => {
    const values = selected.has(value) ? selection.values.filter(v => v !== value) : [...selection.values, value];
    onChange({ ...selection, values });
  };
  const toggleMissing = () => onChange({ ...selection, includeMissing: !selection.includeMissing });

  const summary = active === 0
    ? allLabel
    : active === 1
      ? (selection.values[0] ?? missingLabel)
      : `${active} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors max-w-[280px] ${
            active > 0
              ? 'bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary'
              : 'bg-secondary border-border text-secondary-foreground hover:border-primary/50'
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
          <span className="truncate">{summary}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.values.map(value => {
                const count = counts.values.get(value) ?? 0;
                const isSelected = selected.has(value);
                return (
                  <CommandItem
                    key={value}
                    value={value}
                    disabled={count === 0 && !isSelected}
                    onSelect={() => toggleValue(value)}
                    className="gap-2"
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                    <span className={`truncate flex-1 text-[12px] ${isSelected ? 'font-semibold' : ''}`}>{value}</span>
                    <span className={COUNT_CLASS}>{count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {options.hasMissing && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Missing value">
                  <CommandItem
                    value={`__missing__ ${missingLabel}`}
                    disabled={counts.missing === 0 && !selection.includeMissing}
                    onSelect={toggleMissing}
                    className="gap-2"
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${selection.includeMissing ? 'opacity-100' : 'opacity-0'}`} />
                    <span className={`flex-1 text-[12px] italic ${selection.includeMissing ? 'font-semibold' : ''}`}>{missingLabel}</span>
                    <span className={COUNT_CLASS}>{counts.missing}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
          {active > 0 && (
            <button
              type="button"
              onClick={() => onChange({ values: [], includeMissing: false })}
              className="w-full border-t border-border px-3 py-2 text-left font-mono text-[11px] text-popover-foreground/75 hover:text-popover-foreground"
            >
              Clear {label} filter
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
