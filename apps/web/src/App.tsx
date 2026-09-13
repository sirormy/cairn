import { Navigate, Route, Routes } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { ConversationPage } from './pages/ConversationPage';
import { HomePage } from './pages/HomePage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemsPage } from './pages/ItemsPage';

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/c/:id" element={<ConversationPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
