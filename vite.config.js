import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'fs'
import path from 'path'

export default defineConfig(({ mode }) => {
  const protectedBuild = mode === 'protected'
  const analysisBuild = mode === 'analyze'
  const outDir = analysisBuild ? 'analysis_dist' : protectedBuild ? 'obfuscated_dist' : 'dist'

  function copyGoogleVerificationFiles() {
    const projectRoot = process.cwd()
    const outputRoot = path.resolve(projectRoot, outDir)
    if (!fs.existsSync(outputRoot)) return

    for (const fileName of fs.readdirSync(projectRoot)) {
      if (!/^google[a-z0-9]+\.html$/i.test(fileName)) continue
      fs.copyFileSync(path.join(projectRoot, fileName), path.join(outputRoot, fileName))
    }
  }

  function copyDirectory(source, target) {
    if (!fs.existsSync(source)) return
    fs.mkdirSync(target, { recursive: true })

    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name)
      const targetPath = path.join(target, entry.name)

      if (entry.isDirectory()) {
        copyDirectory(sourcePath, targetPath)
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath)
      }
    }
  }

  function copyCloudflareFunctions() {
    const projectRoot = process.cwd()
    const outputRoot = path.resolve(projectRoot, outDir)
    if (!fs.existsSync(outputRoot)) return

    copyDirectory(path.join(projectRoot, 'functions'), path.join(outputRoot, 'functions'))
  }

  function copyPdfJsWasm() {
    const projectRoot = process.cwd()
    copyDirectory(
      path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'wasm'),
      path.join(projectRoot, outDir, 'pdfjs-wasm'),
    )
  }

  return {
  plugins: [
    react(),
    analysisBuild && visualizer({
      filename: 'output/bundle-analysis.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
    analysisBuild && visualizer({
      filename: 'output/bundle-analysis.json',
      template: 'raw-data',
      gzipSize: true,
      brotliSize: true,
    }),
    {
      name: 'copy-static-deploy-extras',
      closeBundle() {
        copyGoogleVerificationFiles()
        copyCloudflareFunctions()
        copyPdfJsWasm()
      },
    },
    {
      name: 'serve-built-sub-apps',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url.split('?')[0]; // strip query params
          if (url.startsWith('/pdfjs-wasm/')) {
            const fileName = path.basename(url)
            const filePath = path.resolve('node_modules/pdfjs-dist/wasm', fileName)
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              res.setHeader('Content-Type', path.extname(filePath) === '.wasm' ? 'application/wasm' : 'application/javascript')
              res.end(fs.readFileSync(filePath))
              return
            }
          }
          const subApp = url.startsWith('/compress')
            ? { route: '/compress', output: 'dist/compress' }
            : url.startsWith('/pdf-to-word/app')
              ? { route: '/pdf-to-word/app', output: 'dist/pdf-to-word/app' }
              : null
          if (subApp) {
            let relativePath = url.replace(subApp.route, '');
            if (relativePath === '/' || relativePath === '') {
              relativePath = '/index.html';
            }
            const filePath = path.resolve(subApp.output + relativePath);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              const ext = path.extname(filePath);
              const contentType = {
                '.html': 'text/html',
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.svg': 'image/svg+xml',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.gif': 'image/gif',
                '.mjs': 'application/javascript',
              }[ext] || 'application/octet-stream';
              
              res.setHeader('Content-Type', contentType);
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        });
      }
    }
  ],
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir,
    sourcemap: analysisBuild,
    rollupOptions: {
      input: {
        main: 'index.html',
        editpdf: 'editpdf.html',
      },
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (
            normalized.includes('/node_modules/react/')
            || normalized.includes('/node_modules/react-dom/')
            || normalized.includes('/node_modules/react-router/')
            || normalized.includes('/node_modules/react-router-dom/')
            || normalized.includes('/node_modules/scheduler/')
            || normalized.includes('/node_modules/zustand/')
            || normalized.includes('/node_modules/use-sync-external-store/')
          ) {
            return 'framework'
          }
          return undefined
        },
      },
    },
  },
  }
})
