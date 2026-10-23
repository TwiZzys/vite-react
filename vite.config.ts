import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fontPlugin from "./vite/tasks/fontsGeneration.js";
import runSvgSprite from './vite/tasks/svgSprite.js';
import { runImageConvert, startImageWatcher } from './vite/tasks/imagesConvert.js';
import { runFaviconConvert, startFaviconWatcher } from './vite/tasks/faviconGeneration.js';
import browserslistToEsbuild from "browserslist-to-esbuild";
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
export default defineConfig(({ command }) => {
  const isProd = command === 'build';

  return {
    root: import.meta.dirname + '/src',
    publicDir: import.meta.dirname + '/public',
    base: "./",
    plugins: [
      react(),
      {
        name: 'assets-automation-plugin',
        // Викликаємо обробку картинок, фавіконів та копіювання спрайта ПІСЛЯ завершення збірки
        async closeBundle() {
          if (command === 'build') {
            await runImageConvert();
            await runFaviconConvert();

            // Копіюємо згенерований SVG-спрайт у фінальну папку dist/assets/ (або dist/images/)
            const srcSprite = path.resolve(import.meta.dirname, 'src/assets/images/sprite.svg');
            const distSprite = path.resolve(import.meta.dirname, 'dist/images/sprite.svg');

            if (fs.existsSync(srcSprite)) {
              await fsp.mkdir(path.dirname(distSprite), { recursive: true });
              await fsp.copyFile(srcSprite, distSprite);
              console.log('[SpriteCopy] sprite.svg успішно скопійовано у dist/images/');
            }
          }
        },
        configureServer(server) {
          runImageConvert(server);
          startImageWatcher(server);

          runFaviconConvert();
          startFaviconWatcher(server);
        },
      },
      fontPlugin({
        inDir: "src/assets/fonts/src",
        outDir: "src/assets/fonts",
        outScss: "src/scss/_fonts.scss",
        varsScss: "src/scss/_vars.scss",
      }),
      runSvgSprite(),
    ],
    resolve: {
      alias: {
        '@': import.meta.dirname + '/src',
        '@pages': import.meta.dirname + '/src/pages',
        '@components': import.meta.dirname + '/src/components',
        '@scss': import.meta.dirname + '/src/scss',
        '@images': import.meta.dirname + '/src/assets/images',
        '@shared': import.meta.dirname + '/src/shared',
        '@hooks': import.meta.dirname + '/src/hooks',
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `
            @use "@scss/vars" as * with (
              $isProd: ${isProd},
              $env: "${isProd ? 'production' : 'development'}"
            );
          `,
        },
      },
    },
    server: {
      port: 8080,
      open: true,
    },
    build: {
      outDir: import.meta.dirname + '/dist',
      emptyOutDir: true,
      target: browserslistToEsbuild(),
      rollupOptions: {
        output: {
          entryFileNames: 'js/[name].[hash].js',
          chunkFileNames: 'js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            const ext = name.split('.').pop() || '';

            if (/css/i.test(ext)) {
              return 'css/[name].[hash][extname]';
            }
            if (/woff2?|ttf|eot/i.test(ext)) {
              return 'fonts/[name][extname]';
            }
            return 'assets/[name].[hash][extname]';
          },
        },
      },
    },
  };
});
