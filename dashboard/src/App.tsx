import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import PortfolioOverview from './pages/PortfolioOverview';
import CompanyDeepDive from './pages/CompanyDeepDive';
import AuditTrail from './pages/AuditTrail';
import ExtractionRunner from './pages/ExtractionRunner';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<PortfolioOverview />} />
          <Route path="/company/:name" element={<CompanyDeepDive />} />
          <Route path="/audit" element={<AuditTrail />} />
          <Route path="/live" element={<ExtractionRunner />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
