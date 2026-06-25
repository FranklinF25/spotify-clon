import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from '@/app/providers';
import { router } from '@/app/router';
import '@/styles/theme.css';

/**
 * App entry. `<Providers>` mounts the QueryClient + the single `<Boot/>`
 * (silent refresh) OUTSIDE the router; `<RouterProvider>` consumes the route
 * table from `app/router.tsx` (auth pages + guards + the stubbed protected
 * tree + the `*` fallback). The router replaced the PR-1 inline stub here.
 */
const root = document.getElementById('root');
if (!root) throw new Error('#root element missing in index.html');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
