import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { queryClient } from './lib/queryClient.js';
// Design system condiviso del sito completo (design/recupera.css), poi lo stile della dashboard.
import '../../../design/recupera.css';
import '../style.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
