import { useAppContext } from '@/context/AppContext';
import { familiesEnabled } from '@/config/families';
import { BarChart3, FileText, Users, Building2, LayoutDashboard, TrendingUp, CalendarRange, Search, Compass, Presentation, FlaskConical, type LucideIcon } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const pages: NavItem[] = [
  { id: 'executive', label: 'Executive Summary', icon: Presentation },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'weekly', label: 'Weekly Review', icon: CalendarRange },
  { id: 'problems', label: 'Problems & RCA', icon: Search },
  { id: 'origen', label: 'Origen', icon: Compass },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'textquality', label: 'Text Quality', icon: BarChart3 },
  { id: 'incidents', label: 'All Incidents', icon: FileText },
  { id: 'agents', label: 'By Agent', icon: Users },
  { id: 'groups', label: 'By Group', icon: Building2 },
];

/** Experimental, flag-gated views (VITE_EXPERIMENTAL_FAMILIES=on). */
const experimentalPages: NavItem[] = [
  { id: 'families', label: 'Incident Families (experimental)', icon: FlaskConical },
];

const filterLabels = [
  { id: 'all', label: 'Show All' },
  { id: 'Excellent', label: 'Excellent', dotColor: 'hsl(145,70%,38%)' },
  { id: 'Good', label: 'Good', dotColor: 'hsl(43,90%,48%)' },
  { id: 'Poor', label: 'Poor', dotColor: 'hsl(14,90%,55%)' },
  { id: 'Critical', label: 'Critical', dotColor: 'hsl(0,80%,55%)' },
];

export default function AppSidebar() {
  const { currentPage, setCurrentPage, filterLabel, setFilterLabel, fileName } = useAppContext();
  const navPages = familiesEnabled() ? [...pages, ...experimentalPages] : pages;

  return (
    <aside className="w-[220px] min-w-[220px] bg-sidebar flex flex-col h-screen">
      <div className="p-4 border-b border-sidebar-border">
        <div className="font-mono text-[13px] font-bold tracking-[0.08em] text-primary-foreground">
          WN Quality
        </div>
        <div className="text-[10px] text-sidebar-foreground/60 mt-0.5 truncate">
          {fileName || 'Work Notes Analysis'}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-2 text-[9px] font-bold tracking-[0.14em] uppercase text-sidebar-foreground/40 font-mono">
          Views
        </div>
        {navPages.map(p => (
          <button
            key={p.id}
            onClick={() => setCurrentPage(p.id)}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[13px] border-l-2 transition-all duration-200 ${
              currentPage === p.id
                ? 'bg-sidebar-accent border-l-sidebar-primary text-sidebar-primary font-medium'
                : 'border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-primary-foreground'
            }`}
          >
            <p.icon className="w-4 h-4" />
            <span>{p.label}</span>
          </button>
        ))}

        <div className="px-3 py-2 mt-4 text-[9px] font-bold tracking-[0.14em] uppercase text-sidebar-foreground/40 font-mono">
          Filter by Quality
        </div>
        {filterLabels.map(f => (
          <button
            key={f.id}
            onClick={() => setFilterLabel(f.id)}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[13px] border-l-2 transition-all duration-200 ${
              filterLabel === f.id
                ? 'bg-sidebar-accent border-l-sidebar-primary text-sidebar-primary font-medium'
                : 'border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-primary-foreground'
            }`}
          >
            {f.dotColor && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.dotColor }} />}
            <span>{f.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border text-[9px] text-sidebar-foreground/30 font-mono">
        WN Quality v1
      </div>
    </aside>
  );
}
