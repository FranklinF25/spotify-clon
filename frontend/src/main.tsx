import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Providers } from '@/app/providers';
import '@/styles/theme.css';

/**
 * PR-1 stub router. The real route table (auth routes, `<RequireAuth>`, the
 * protected tree, the `*` fallback) lands in FE-PR2-10 and replaces this
 * inline stub. Kept inline so `main.tsx` is the single edit site later.
 */
const router = createBrowserRouter([{ path: '*', element: null }]);

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing in index.html');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
