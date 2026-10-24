# Hosting LinguaWeave under hexad (Cloudflare static assets)

Build (new app only; archived v1 is not built or published):

    npm run build:hexad            # base /apps/langapp/, output dist-hexad/apps/langapp/

Any other base path or hostname root:

    $env:LANGAPP_BASE='/'; $env:LANGAPP_PWA='1'; $env:LANGAPP_OUT='dist-x'; $env:VITE_LANGAPP_PWA='1'; npx vite build

The manifest (id/start_url/scope all `./`) and service worker are emitted only when LANGAPP_PWA=1;
GitHub Pages and dev builds are unchanged. The worker caches only its own scope and never touches IndexedDB.

Worker: `wrangler deploy -c deploy/hexad/wrangler.jsonc` uploads the assets with no route.
The route (hexad-project.ref12.dev/apps/langapp/*) was added once, separately, through the Cloudflare API.
