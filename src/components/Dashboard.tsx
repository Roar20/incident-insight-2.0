import { useAppContext } from '@/context/AppContext';
import AppSidebar from '@/components/AppSidebar';
import OverviewPage from '@/pages/OverviewPage';
import TextQualityPage from '@/pages/TextQualityPage';
import AllIncidentsPage from '@/pages/AllIncidentsPage';
import ByAgentPage from '@/pages/ByAgentPage';
import ByGroupPage from '@/pages/ByGroupPage';
import TrendsPage from '@/pages/TrendsPage';
import WeeklyPage from '@/pages/WeeklyPage';
import ProblemsPage from '@/pages/ProblemsPage';
import OrigenPage from '@/pages/OrigenPage';
import ExecutiveSummaryPage from '@/pages/ExecutiveSummaryPage';
import FamiliesPage from '@/pages/FamiliesPage';
import { familiesEnabled } from '@/config/families';

export default function Dashboard() {
  const { currentPage } = useAppContext();

  const renderPage = () => {
    switch (currentPage) {
      case 'executive': return <ExecutiveSummaryPage />;
      case 'overview': return <OverviewPage />;
      case 'weekly': return <WeeklyPage />;
      case 'problems': return <ProblemsPage />;
      case 'origen': return <OrigenPage />;
      case 'trends': return <TrendsPage />;
      case 'textquality': return <TextQualityPage />;
      case 'incidents': return <AllIncidentsPage />;
      case 'agents': return <ByAgentPage />;
      case 'groups': return <ByGroupPage />;
      // Experimental, flag-gated: unreachable unless VITE_EXPERIMENTAL_FAMILIES=on.
      case 'families': return familiesEnabled() ? <FamiliesPage /> : <OverviewPage />;
      default: return <OverviewPage />;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto p-8 bg-background">
        {renderPage()}
      </main>
    </div>
  );
}
