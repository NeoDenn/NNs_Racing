import type { Connect } from 'vite';
import { defineConfig } from 'vite';
import { deleteSave, readSave, writeSave } from './scripts/saveFile.ts';

// /api/save lets the page use the same save file as the terminal: GET reads it, PUT writes it, DELETE deletes it
const saveApi: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url !== '/api/save') return next();

  try {
    if (req.method === 'GET') {
      const save = readSave();
      res.statusCode = save ? 200 : 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(save));
    } else if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        writeSave(JSON.parse(body));
        res.end();
      });
    } else if (req.method === 'DELETE') {
      deleteSave();
      res.end();
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
};

export default defineConfig({
  plugins: [
    {
      name: 'save-api',
      configureServer: (server) => void server.middlewares.use(saveApi),
      configurePreviewServer: (server) => void server.middlewares.use(saveApi),
    },
  ],
});
