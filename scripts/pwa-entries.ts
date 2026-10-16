import type { Plugin } from 'vite';
import { manifestPath, pwaAppAt, pwaApps, pwaHeadTags, webManifest, type PwaApp } from '../src/shared/pwa.ts';

const apps = Object.keys(pwaApps) as PwaApp[];

const manifests = apps.map((app) => ({
  path: manifestPath(app),
  content: `${JSON.stringify(webManifest(app), null, 2)}\n`,
}));

function withHeadTags(html: string, app: PwaApp): string {
  return html.replace('</head>', `  ${pwaHeadTags(app)}\n  </head>`);
}

export function pwaEntries(): Plugin {
  return {
    name: 'pwa-entries',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const manifest = manifests.find((m) => m.path === req.url);
        if (!manifest) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest.content);
      });
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      const app = pwaAppAt(new URL(ctx.originalUrl ?? ctx.path, 'http://dev').pathname);
      return app ? withHeadTags(html, app) : html;
    },
    generateBundle(_, bundle) {
      for (const manifest of manifests) {
        this.emitFile({ type: 'asset', fileName: manifest.path.slice(1), source: manifest.content });
      }
      const index = bundle['index.html'];
      if (index?.type !== 'asset' || typeof index.source !== 'string') {
        this.error('index.html fehlt im Bundle – die App-Einstiege können nicht erzeugt werden');
      }
      for (const app of apps) {
        this.emitFile({
          type: 'asset',
          fileName: `${pwaApps[app].scope.slice(1)}/index.html`,
          source: withHeadTags(index.source, app),
        });
      }
    },
  };
}
