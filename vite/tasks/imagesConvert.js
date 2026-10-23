// ============================================================================
// IMAGE SCRIPT — DEV COPY & BUILD SYSTEM OPTIMIZATION
// ============================================================================

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import chokidar from 'chokidar';

// ---------------- MODE ----------------
const isBuild = process.argv.includes('build');
const isDev = !isBuild;

// ---------------- PATHS ----------------
const globalSrc = 'src/assets/images/src';
const componentsDir = 'src/components';
const devOutputDir = 'src/assets/images';
const buildOutputDir = 'dist/images';
const outputDir = isBuild ? buildOutputDir : devOutputDir;

// ---------------- CONFIG ----------------
const rasterExts = ['.png', '.jpg', '.jpeg'];
const svgExts = ['.svg'];
const generatedFormats = ['.webp', '.avif'];
const excludeFolder = 'sprite-src';

// ---------------- FLAGS ----------------
let isInitialRun = true;

// ---------------- UTILS ----------------
function normalize(p) {
  return p.replace(/\\/g, '/');
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isUpToDate(src, dest) {
  if (!(await fileExists(dest))) return false;
  const srcStat = await fsp.stat(src);
  const destStat = await fsp.stat(dest);
  return destStat.mtimeMs >= srcStat.mtimeMs;
}

function isGenerated(filePath) {
  return generatedFormats.includes(path.extname(filePath).toLowerCase());
}

// ---------------- PATH RESOLVERS ----------------
function getDestPathForGlobal(filePath) {
  const rel = path.relative(globalSrc, filePath);
  return path.join(outputDir, rel);
}

function getDestPathForComponent(filePath) {
  const fp = normalize(filePath);
  const relAfterComponents = fp.split('/components/')[1];
  if (!relAfterComponents) return null;

  const [compName, ...rest] = relAfterComponents.split('/');
  const idx = rest.indexOf('images');
  if (idx === -1) return null;

  // Якщо це папка src всередині компонента (наприклад, src/components/Header/images/src)
  const filteredRest = rest.slice(idx + 1).filter(p => p !== 'src');
  const inside = filteredRest.join('/');
  return path.join(outputDir, compName, inside);
}

function resolveOutputPath(filePath) {
  const fp = normalize(filePath);
  if (fp.startsWith(normalize(globalSrc))) return getDestPathForGlobal(fp);
  if (fp.includes('/components/') && fp.includes('/images/')) return getDestPathForComponent(fp);
  return null;
}

// ---------------- PROCESS FILE (DEV vs BUILD) ----------------
async function processFile(filePath, destPath) {
  const ext = path.extname(filePath).toLowerCase();
  const destDir = path.dirname(destPath);
  const fileNameWithoutExt = path.basename(filePath, ext);

  if (filePath.includes(`/${excludeFolder}/`)) return;

  // --- DEV MODE: ПРОСТЕ ТА НАДІЙНЕ КОПІЮВАННЯ ---
  if (isDev) {
    if (rasterExts.includes(ext) || svgExts.includes(ext)) {
      await ensureDir(destDir);
      const destOriginal = path.join(destDir, path.basename(filePath));

      // Завжди копіюємо, якщо оригінал відсутній або змінився
      if (!(await isUpToDate(filePath, destOriginal))) {
        await fsp.copyFile(filePath, destOriginal);
        console.log('[Copied Dev]', normalize(destOriginal));
      }
    }
    return;
  }

  // --- BUILD MODE: СИСТЕМНІ УТИЛІТИ (cwebp, avifenc, pngquant) ---
  ensureDirSync(destDir);
  const originalDest = path.join(destDir, `${fileNameWithoutExt}${ext}`);
  const webpDest = path.join(destDir, `${fileNameWithoutExt}.webp`);
  const avifDest = path.join(destDir, `${fileNameWithoutExt}.avif`);

  const srcStat = fs.statSync(filePath);
  let originalNeedsCopy = true;
  if (fs.existsSync(originalDest)) {
    const destStat = fs.statSync(originalDest);
    if (destStat.mtimeMs >= srcStat.mtimeMs) {
      originalNeedsCopy = false;
    }
  }

  if (rasterExts.includes(ext)) {
    // 1. Копіюємо та квантуємо оригінал через pngquant (якщо PNG) або просто копіюємо (якщо JPG)
    if (originalNeedsCopy) {
      fs.copyFileSync(filePath, originalDest);
      if (ext === '.png') {
        try {
          execFileSync('pngquant', ['--quality', '65-80', '--ext', '.png', '--force', originalDest], { stdio: 'ignore' });
          console.log('[PNG Quantized Build]', `${fileNameWithoutExt}${ext}`);
        } catch (e) {
          console.log('[Copied Raster Build]', `${fileNameWithoutExt}${ext}`);
        }
      } else {
        console.log('[Copied Raster Build]', `${fileNameWithoutExt}${ext}`);
      }
    }

    // 2. Генеруємо WebP
    let webpNeedsGen = true;
    if (fs.existsSync(webpDest)) {
      const webpStat = fs.statSync(webpDest);
      if (webpStat.mtimeMs >= srcStat.mtimeMs) webpNeedsGen = false;
    }
    if (webpNeedsGen) {
      try {
        execFileSync('cwebp', ['-q', '80', filePath, '-o', webpDest], { stdio: 'ignore' });
        console.log('[WebP Created]', `${fileNameWithoutExt}.webp`);
      } catch (e) {
        console.warn('[Warning] cwebp failed:', e.message);
      }
    }

    // 3. Генеруємо AVIF
    let avifNeedsGen = true;
    if (fs.existsSync(avifDest)) {
      const avifStat = fs.statSync(avifDest);
      if (avifStat.mtimeMs >= srcStat.mtimeMs) avifNeedsGen = false;
    }
    if (avifNeedsGen) {
      try {
        execFileSync('avifenc', ['-s', '6', '-q', '50', filePath, avifDest], { stdio: 'ignore' });
        console.log('[AVIF Created]', `${fileNameWithoutExt}.avif`);
      } catch (e) {
        console.warn('[Warning] avifenc failed:', e.message);
      }
    }
  } else if (svgExts.includes(ext)) {
    if (originalNeedsCopy) {
      fs.copyFileSync(filePath, originalDest);
      console.log('[SVG Copied Build]', path.basename(filePath));
    }
  }
}

// ---------------- WALKER ----------------
async function walkDirAsync(dir, cb) {
  if (!(await fileExists(dir))) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === excludeFolder) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkDirAsync(full, cb);
    else await cb(full);
  }
}

// ---------------- REMOVE FILES ----------------
async function removeOutputFiles(sourcePath) {
  const normalized = normalize(sourcePath);
  if (normalized.includes(`/${excludeFolder}/`)) return;

  const dest = resolveOutputPath(normalized);
  if (!dest) return;

  const dir = path.dirname(dest);
  const base = path.basename(dest, path.extname(dest));
  const filesToRemove = [
    dest,
    path.join(dir, base + '.webp'),
    path.join(dir, base + '.avif'),
  ];

  for (const f of filesToRemove) {
    if (fs.existsSync(f)) {
      await fsp.unlink(f);
      console.log('[Removed File]', normalize(f));
    }
  }

  await clearEmptyDirsUpward(dir);
}

async function clearEmptyDirsUpward(dir) {
  try {
    if (!(await fileExists(dir))) return;

    const items = await fsp.readdir(dir);
    if (items.length > 0) return;

    await fsp.rmdir(dir);
    console.log('[Removed Empty Dir]', dir);

    const parent = path.dirname(dir);
    if (normalize(parent) !== normalize(devOutputDir) && normalize(parent) !== normalize(buildOutputDir)) {
      await clearEmptyDirsUpward(parent);
    }
  } catch (e) {
    if (['EPERM', 'EBUSY', 'ENOENT'].includes(e.code)) return;
    throw e;
  }
}

// ---------------- SCANNER HELPER ----------------
async function scanAndProcessAll() {
  // 1. Глобальні картинки
  if (await fileExists(globalSrc)) {
    await walkDirAsync(globalSrc, async fp => {
      const dest = getDestPathForGlobal(fp);
      if (dest) await processFile(fp, dest);
    });
  }

  // 2. Картинки компонентів
  if (await fileExists(componentsDir)) {
    const comps = await fsp.readdir(componentsDir);
    for (const comp of comps) {
      const imgDir = path.join(componentsDir, comp, 'images');
      if (!(await fileExists(imgDir))) continue;
      await walkDirAsync(imgDir, async fp => {
        const dest = getDestPathForComponent(fp);
        if (dest) await processFile(fp, dest);
      });
    }
  }
}

// ---------------- MAIN ----------------
export async function runImageConvert(server) {
  console.log(`[ImageConvert] Start (${isBuild ? 'Build' : 'Dev'} mode)`);

  if (isBuild) {
    await ensureDir(buildOutputDir);
  } else {
    await ensureDir(devOutputDir);
  }

  await scanAndProcessAll();

  console.log('[ImageConvert] Done');

  if (server && isInitialRun) {
    server.ws.send({ type: 'full-reload', path: '*' });
  }
  isInitialRun = false;
}

// ---------------- WATCHER ----------------
export function startImageWatcher(server) {
  if (isBuild) return; // У білді ворчер не потрібен

  const watchPaths = [globalSrc];
  if (fs.existsSync(componentsDir)) {
    watchPaths.push(componentsDir);
  }

  const watcher = chokidar.watch(watchPaths, {
    ignored: /sprite-src/,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  const pendingFiles = new Set();
  let processTimeout = null;
  const MAX_PARALLEL = 4;

  const processBatch = async (files) => {
    while (files.length > 0) {
      const batch = files.splice(0, MAX_PARALLEL);
      await Promise.all(
        batch.map(async (fp) => {
          const dest = resolveOutputPath(fp);
          if (dest) await processFile(fp, dest);
        })
      );
    }
  };

  const scheduleProcessing = async () => {
    if (pendingFiles.size === 0) return;
    const files = Array.from(pendingFiles);
    pendingFiles.clear();
    await processBatch(files);
    if (!isInitialRun) {
      server.ws.send({ type: 'full-reload', path: '*' });
    }
  };

  watcher.on('all', (event, filePath) => {
    const fp = normalize(filePath);
    if (fp.includes(`/${excludeFolder}/`) || isGenerated(fp)) return;

    if (event === 'add' || event === 'change') {
      pendingFiles.add(fp);
      if (processTimeout) clearTimeout(processTimeout);
      processTimeout = setTimeout(scheduleProcessing, 50);
    }

    if (event === 'unlink') {
      removeOutputFiles(fp).then(() => {
        if (!isInitialRun) {
          server.ws.send({ type: 'full-reload', path: '*' });
        }
      });
    }
  });

  watcher.on('ready', () => console.log('[Image Watcher] Ready & Listening...'));
}
