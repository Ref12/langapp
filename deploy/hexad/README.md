# Hosting LinguaWeave under hexad (Cloudflare static assets)

Build (new app only; archived v1 is not built or published):

    npm run build:hexad            # base /lang/, output dist-hexad/lang/

Any other base path or hostname root:

    $env:LANGAPP_BASE='/'; $env:LANGAPP_PWA='1'; $env:LANGAPP_OUT='dist-x'; $env:VITE_LANGAPP_PWA='1'; npx vite build

The manifest (id/start_url/scope all `./`) and service worker are emitted only when LANGAPP_PWA=1;
GitHub Pages and dev builds are unchanged. The worker caches only its own scope and never touches IndexedDB.

Worker: `wrangler deploy -c deploy/hexad/wrangler.jsonc` uploads the assets with no route.
The route (apps--hexad-project.ref12.dev/lang/*) was added once, separately, through the Cloudflare API.
