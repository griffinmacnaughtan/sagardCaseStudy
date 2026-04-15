import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { DataModeProvider } from './lib/mode';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataModeProvider>
      <App />
    </DataModeProvider>
  </StrictMode>,
);
