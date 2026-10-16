import type { Plugin } from 'vite';
import { manifestPath, pwaApps, webManifest, type PwaApp } from '../src/shared/pwa.ts';

const manifests = (Object.keys(pwaApps) as PwaApp[]).map((app) => ({
  path: manifestPath(app),
  content: `${JSON.stringify(webManifest(app), null, 2)}\n`,
}));

export function pwaManifests(): Plugin {
  return {
    name: 'pwa-manifests',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const manifest = manifests.find((m) => m.path === req.url);
        if (!manifest) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest.content);
      });
    },
    generateBundle() {
      for (const manifest of manifests) {
        this.emitFile({ type: 'asset', fileName: manifest.path.slice(1), source: manifest.content });
      }
    },
  };
}
