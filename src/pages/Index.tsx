import { useAppContext } from '@/context/AppContext';
import UploadScreen from '@/components/UploadScreen';
import Dashboard from '@/components/Dashboard';

const Index = () => {
  const { loaded, loading } = useAppContext();

  if (loading || !loaded) {
    return <UploadScreen />;
  }

  return <Dashboard />;
};

export default Index;
