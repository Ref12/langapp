# LinguaWeave

A modular, local-first language-learning PWA built around shared learning
items, reading techniques, and AI conversation.

## Development

```powershell
npm install
npm run dev
```

Run the same quality gates as deployment:

```powershell
npm run lint
npm test
npm run build
```

## Deployment

Pushes to `main` run `.github/workflows/deploy-pages.yml`. The workflow
installs from the lockfile, runs lint and tests, creates the production build,
and deploys `dist` to GitHub Pages.

The app uses hash routing and relative assets so it works at a repository Pages
path such as `https://ref12.github.io/langapp/`.

## Specifications

- [`specs/app.md`](specs/app.md)
- [`specs/data-model.md`](specs/data-model.md)
- [`docs/implementation-plan.md`](docs/implementation-plan.md)
