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

export default function Dashboard() {
  const { currentPage } = useAppContext();

  const renderPage = () => {
    switch (currentPage) {
      case 'overview': return <OverviewPage />;
      case 'weekly': return <WeeklyPage />;
      case 'problems': return <ProblemsPage />;
      case 'trends': return <TrendsPage />;
      case 'textquality': return <TextQualityPage />;
      case 'incidents': return <AllIncidentsPage />;
      case 'agents': return <ByAgentPage />;
      case 'groups': return <ByGroupPage />;
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
