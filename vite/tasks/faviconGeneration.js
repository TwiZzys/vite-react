import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import { Jimp } from 'jimp';

const isBuild = process.argv.includes('build');
const inDir = 'public/favicons/src';
const outDir = isBuild ? 'dist/favicons' : 'public/favicons';
const buildSrcDirInDist = 'dist/favicons/src';
const activeSourceMarkerPath = path.join(inDir, '.active_source');

let isProcessing = false;
let forcedActiveFileName = null;

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function generateManifest(outDirectory, iconName, isSvg = false) {
  const manifestData = {
    name: "App",
    short_name: "App",
    icons: isSvg
      ? [
        {
          src: `/favicons/${iconName}`,
          sizes: "any",
          type: "image/svg+xml"
        }
      ]
      : [
        {
          src: "/favicons/icon-192x192.png",
          sizes: "192x192",
          type: "image/png"
        },
        {
          src: "/favicons/icon-512x512.png",
          sizes: "512x512",
          type: "image/png"
        }
      ],
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff"
  };

  const manifestPath = path.join(outDirectory, 'manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');
}

async function getAllHtmlFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  let htmlFiles = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      htmlFiles = htmlFiles.concat(await getAllHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'index.html') {
      htmlFiles.push(fullPath);
    }
  }
  return htmlFiles;
}

async function updateIndexHtml(hasIcons = true, svgFileName = null) {
  const srcDir = path.resolve(process.cwd(), 'src');
  if (!(await fileExists(srcDir))) return;

  const htmlFiles = await getAllHtmlFiles(srcDir);

  if (htmlFiles.length === 0) {
    console.warn('[FaviconHTML] Попередження: не знайдено жодного index.html у папці src/');
    return;
  }

  const faviconTags = svgFileName
    ? `    <!-- FAVICONS AUTO-INJECT -->\n    <link rel="icon" type="image/svg+xml" sizes="any" href="/favicons/${svgFileName}" />\n    <link rel="manifest" href="/favicons/manifest.json" />\n    <!-- /FAVICONS AUTO-INJECT -->`
    : `    <!-- FAVICONS AUTO-INJECT -->\n    <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png" />\n    <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png" />\n    <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon-180x180.png" />\n    <link rel="manifest" href="/favicons/manifest.json" />\n    <!-- /FAVICONS AUTO-INJECT -->`;

  for (const filePath of htmlFiles) {
    let htmlContent = await fsp.readFile(filePath, 'utf-8');
    const markerRegex = /<!-- FAVICONS AUTO-INJECT -->[\s\S]*?<!-- \/FAVICONS AUTO-INJECT -->/;

    if (!hasIcons) {
      if (markerRegex.test(htmlContent)) {
        htmlContent = htmlContent.replace(markerRegex, '');
        // Видаляємо зайві порожні рядки після видалення тегів
        htmlContent = htmlContent.replace(/^\s*[\r\n]/gm, '');
        await fsp.writeFile(filePath, htmlContent, 'utf-8');
        console.log(`[FaviconHTML] Очищено теги фавіконів у: ${path.relative(process.cwd(), filePath)}`);
      }
      continue;
    }

    let newHtmlContent = htmlContent;
    if (markerRegex.test(newHtmlContent)) {
      newHtmlContent = newHtmlContent.replace(markerRegex, faviconTags);
    } else {
      if (newHtmlContent.includes('</head>')) {
        newHtmlContent = newHtmlContent.replace('</head>', `  ${faviconTags}\n</head>`);
      } else {
        continue;
      }
    }

    // Видаляємо всі повністю порожні рядки (або рядки з пробілами) на льоту
    newHtmlContent = newHtmlContent.replace(/^\s*[\r\n]/gm, '');

    if (htmlContent !== newHtmlContent) {
      await fsp.writeFile(filePath, newHtmlContent, 'utf-8');
      console.log(`[FaviconHTML] Оновлено та очищено теги у: ${path.relative(process.cwd(), filePath)}`);
    }
  }
}

async function generateFaviconSizes(srcPath) {
  try {
    console.log(`[FaviconJimp] Початок нарізки растрового зображення: ${path.basename(srcPath)}`);
    const image = await Jimp.read(srcPath);

    const targets = [
      { name: 'favicon-16x16.png', size: 16 },
      { name: 'favicon-32x32.png', size: 32 },
      { name: 'apple-touch-icon-180x180.png', size: 180 },
      { name: 'icon-192x192.png', size: 192 },
      { name: 'icon-512x512.png', size: 512 }
    ];

    for (const target of targets) {
      const resized = image.clone().resize({ w: target.size, h: target.size });
      const outFilePath = path.join(outDir, target.name);
      await resized.write(outFilePath);
      console.log(`  ├─ Згенеровано: ${target.name} (${target.size}x${target.size})`);
    }
    return true;
  } catch (err) {
    console.error('[FaviconGenerator] Помилка зміни розмірів зображення через Jimp:', err);
    return false;
  }
}

async function cleanOutputDir() {
  if (await fileExists(outDir)) {
    const files = await fsp.readdir(outDir);
    let count = 0;
    for (const file of files) {
      if (file !== 'src') {
        await fsp.unlink(path.join(outDir, file)).catch(() => {});
        count++;
      }
    }
    if (count > 0) {
      console.log(`[FaviconClean] Видалено згенерованих файлів і маніфесту: ${count}`);
    }
  }
}

async function processFaviconFolder(force = false) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!(await fileExists(inDir))) {
      console.log('[FaviconProcess] Папка вихідних файлів відсутня.');
      await cleanOutputDir();
      if (isBuild && (await fileExists(outDir))) {
        await fsp.rm(outDir, { recursive: true, force: true });
      }
      await updateIndexHtml(false);
      forcedActiveFileName = null;
      return;
    }

    const entries = await fsp.readdir(inDir, { withFileTypes: true });
    const validEntries = entries.filter(e => e.isFile() && e.name !== '.active_source' && /\.(png|jpg|jpeg|svg)$/i.test(e.name));

    if (validEntries.length === 0) {
      console.log('[FaviconProcess] У папці src немає валідних файлів зображень.');
      await cleanOutputDir();

      if (isBuild && (await fileExists(outDir))) {
        await fsp.rm(outDir, { recursive: true, force: true });
      }

      await updateIndexHtml(false);
      forcedActiveFileName = null;
      await fsp.unlink(activeSourceMarkerPath).catch(() => {});
      return;
    }

    const filesWithStats = await Promise.all(
      validEntries.map(async (entry) => {
        const filePath = path.join(inDir, entry.name);
        const stats = await fsp.stat(filePath);
        return { name: entry.name, path: filePath, mtime: stats.mtimeMs, size: stats.size };
      })
    );

    let activeFile;
    if (forcedActiveFileName) {
      activeFile = filesWithStats.find(f => f.name === forcedActiveFileName);
    }

    if (!activeFile) {
      filesWithStats.sort((a, b) => b.mtime - a.mtime);
      activeFile = filesWithStats[0];
    }

    const isSvg = activeFile.name.endsWith('.svg');
    const mainOutputCheckPath = path.join(outDir, isSvg ? activeFile.name : 'favicon-32x32.png');

    let lastSource = '';
    if (await fileExists(activeSourceMarkerPath)) {
      try {
        lastSource = await fsp.readFile(activeSourceMarkerPath, 'utf-8');
      } catch {}
    }

    let needsGeneration = true;

    if (!force && lastSource === activeFile.name && (await fileExists(mainOutputCheckPath))) {
      try {
        const outStat = await fsp.stat(mainOutputCheckPath);
        if (activeFile.mtime <= outStat.mtimeMs) {
          needsGeneration = false;
        }
      } catch {
        needsGeneration = true;
      }
    }

    if (!force && !needsGeneration) {
      return;
    }

    console.log(`[FaviconProcess] Виявлено активний файл фавікона: "${activeFile.name}" (${activeFile.size} байт)`);

    await ensureDir(outDir);
    await cleanOutputDir();

    if (isSvg) {
      const destPath = path.join(outDir, activeFile.name);
      await fsp.copyFile(activeFile.path, destPath);
      await generateManifest(outDir, activeFile.name, true);
      await updateIndexHtml(true, activeFile.name);
      console.log(`[Favicon SVG] Успішно встановлено SVG-фавікон: ${activeFile.name}`);
    } else {
      const success = await generateFaviconSizes(activeFile.path);
      if (success) {
        await generateManifest(outDir, activeFile.name, false);
        await updateIndexHtml(true, null);
        console.log(`[Favicon PNG] Успішно згенеровано набір фавіконів із: ${activeFile.name}`);
      }
    }

    await fsp.writeFile(activeSourceMarkerPath, activeFile.name, 'utf-8').catch(() => {});
  } finally {
    isProcessing = false;
  }
}

export async function runFaviconConvert() {
  console.log(`[FaviconConvert] Start (${isBuild ? 'Build' : 'Dev'} mode)`);

  forcedActiveFileName = null;
  await processFaviconFolder(false);

  if (isBuild && (await fileExists(buildSrcDirInDist))) {
    try {
      await fsp.rm(buildSrcDirInDist, { recursive: true, force: true });
      console.log('[FaviconBuild] Очищено тимчасову папку src у dist/favicons');
    } catch (e) {
      console.warn('[FaviconBuild] Попередження: не вдалося видалити src з dist:', e.message);
    }
  }

  console.log('[FaviconConvert] Done');
}

export function startFaviconWatcher(server) {
  if (isBuild) return;

  if (!fs.existsSync(inDir)) {
    fs.mkdirSync(inDir, { recursive: true });
  }

  const watcher = chokidar.watch(inDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on('all', async (event, filePath) => {
    const fileName = filePath ? path.basename(filePath) : null;

    if (fileName === '.active_source') return;

    console.log(`[FaviconWatcher] Подія файлової системи: [${event}] -> ${fileName}`);

    if (['add', 'change'].includes(event) && fileName) {
      forcedActiveFileName = fileName;
    }

    if (event === 'unlink' && forcedActiveFileName === fileName) {
      forcedActiveFileName = null;
    }

    if (['add', 'change', 'unlink'].includes(event)) {
      await processFaviconFolder(false);

      if (server) {
        console.log('[FaviconWatcher] Оновлення сторінки через HMR (full-reload)...');
        server.ws.send({ type: 'full-reload', path: '*' });
      }
    }
  });

  watcher.on('ready', () => console.log('[Favicon Watcher] Готовий і слідкує за змінами...'));
}
