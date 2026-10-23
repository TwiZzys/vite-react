import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { optimize } from "svgo";
import crypto from "crypto";

const spriteOutput = "src/assets/images/sprite.svg";
const globalSrc = "src/assets/images/sprite-src";
const componentsDir = "src/components";
const cacheFile = ".svg-cache.json";

let cache = fs.existsSync(cacheFile)
  ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  : {};

const hash = (str) =>
  crypto.createHash("sha256").update(str).digest("hex");

// Безпечний рекурсивний обхід теки
const walkDir = (dir, cb) => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((file) => {
    if (file.endsWith("~") || file === "sprite.svg") return;

    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walkDir(full, cb);
      else if (file.endsWith(".svg")) cb(full);
    } catch (e) {}
  });
};

// --------------------------------------------------
// БАЗОВА ОПТИМІЗАЦІЯ SVGO (зберігає координати та оригінальні кольори)
// --------------------------------------------------
const optimizeSvgRaw = (svgContent, filePath = "") => {
  try {
    return optimize(svgContent, {
      multipass: true,
      floatPrecision: 3,
      plugins: [
        "removeDoctype",
        "removeXMLProcInst",
        "removeComments",
        "removeMetadata",
        "removeEditorsNSData",
        "removeTitle",
        "removeDesc",
        "removeUselessDefs",
        "removeHiddenElems",
        "removeDimensions",
        "convertStyleToAttrs",
        // Не чіпаємо "convertPathData", щоб піксельна геометрія з Figma не пливла
        "sortAttrs",
      ],
    }).data;
  } catch (e) {
    console.warn(`[SVG Pipeline] SVGO error (${filePath}):`, e.message);
    return null;
  }
};

// --------------------------------------------------
// НОРМАЛІЗАЦІЯ ДЛЯ СПРАЙТУ (додає currentColor та чистить зайве)
// --------------------------------------------------
const normalizeSvgForSprite = (svgContent, filePath = "") => {
  const optimized = optimizeSvgRaw(svgContent, filePath);
  if (!optimized) return null;

  const $ = load(optimized, { xmlMode: true });
  const $svg =$("svg");

  if (!$svg.length) return null;

  const viewBox = $svg.attr("viewBox");
  $svg.attr({});
  if (viewBox) $svg.attr("viewBox", viewBox);

  $svg.find("*").each((_, el) => {
    const $el =$(el);

    $el.removeAttr(
      "class id style opacity color width height data-name data-testid"
    );

    const fill = $el.attr("fill");
    const stroke = $el.attr("stroke");

    if (fill && fill !== "none") {
      $el.attr("fill", "currentColor");
    }
    if (stroke && stroke !== "none") {
      $el.attr("stroke", "currentColor");
    }
    if (!fill && !stroke) {
      $el.attr("fill", "currentColor");
    }
  });

  return $.xml($svg)
    .replace(/\n+/g, "")
    .replace(/\s{2,}/g, " ");
};

// --------------------------------------------------
// 1. ОПТИМІЗАЦІЯ ЗВИЧАЙНИХ (STANDALONE) SVG НА ДИСКУ
// --------------------------------------------------
const processStandaloneSvg = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  if (filePath.includes("sprite-src")) return; // Іконки для спрайту тут не чіпаємо

  const raw = fs.readFileSync(filePath, "utf8");
  const fileHash = hash(raw);

  if (cache[`standalone:${filePath}`] === fileHash) return;

  const optimized = optimizeSvgRaw(raw, filePath);
  if (!optimized) return;

  const cleaned = optimized.replace(/\n+/g, "").replace(/\s{2,}/g, " ");

  if (cleaned !== raw) {
    fs.writeFileSync(filePath, cleaned, "utf8");
    console.log(`[SVG Standalone] Optimized: ${path.basename(filePath)}`);
  }

  cache[`standalone:${filePath}`] = hash(cleaned);
};

const processAllStandaloneSvgs = () => {
  const scanDirs = ["src/assets/images", componentsDir];
  const activeFiles = new Set();

  scanDirs.forEach((dir) => {
    walkDir(dir, (filePath) => {
      if (filePath.includes("sprite-src")) return;
      activeFiles.add(filePath);
      processStandaloneSvg(filePath);
    });
  });

  // Очищення кешу для видалених звичайних SVG
  Object.keys(cache).forEach((key) => {
    if (key.startsWith("standalone:")) {
      const filePath = key.replace("standalone:", "");
      if (!activeFiles.has(filePath)) {
        delete cache[filePath];
        delete cache[key];
      }
    }
  });
};

// --------------------------------------------------
// 2. ГЕНЕРАТОР СПРАЙТУ
// --------------------------------------------------
const generateSprite = (server = null) => {
  // Перед збіркою спрайту проганяємо звичайні standalone SVG
  processAllStandaloneSvgs();

  let sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n';
  let hasIcons = false;
  let compiledIcons = "";
  const newCache = { ...cache };
  const activeSpriteFiles = new Set();

  const addIcon = (filePath, id) => {
    if (!fs.existsSync(filePath)) return;
    activeSpriteFiles.add(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const fileHash = hash(raw);
    newCache[filePath] = fileHash;

    if (cache[filePath] === fileHash && cache[`svg:${filePath}`]) {
      compiledIcons += cache[`svg:${filePath}`] + "\n";
      return;
    }

    // Нормалізуємо для спрайту (оригінали у sprite-src залишаються недоторканими)
    const cleaned = normalizeSvgForSprite(raw, filePath);
    if (!cleaned) return;

    const symbol = cleaned
      .replace("<svg", `<symbol id="${id}"`)
      .replace("</svg>", "</symbol>");

    compiledIcons += symbol + "\n";
    newCache[`svg:${filePath}`] = symbol;
    console.log(`[SVG Sprite] Icon processed: ${path.basename(filePath)}`);
  };

  // Глобальні іконки спрайту
  if (fs.existsSync(globalSrc)) {
    walkDir(globalSrc, (file) => {
      hasIcons = true;
      addIcon(file, path.basename(file, ".svg"));
    });
  }

  // Іконки спрайту в компонентах
  if (fs.existsSync(componentsDir)) {
    fs.readdirSync(componentsDir).forEach((comp) => {
      const spriteDir = path.join(componentsDir, comp, "images", "sprite-src");
      if (!fs.existsSync(spriteDir)) return;

      walkDir(spriteDir, (file) => {
        hasIcons = true;
        addIcon(file, `${comp}-${path.basename(file, ".svg")}`);
      });
    });
  }

  // Очищення кешу іконок спрайту
  Object.keys(cache).forEach((key) => {
    if (key.startsWith("svg:")) {
      const filePath = key.replace("svg:", "");
      if (!activeSpriteFiles.has(filePath)) {
        delete newCache[key];
        delete newCache[filePath];
      }
    }
  });

  sprite += compiledIcons + "</svg>";

  if (!hasIcons) {
    if (fs.existsSync(spriteOutput)) {
      fs.unlinkSync(spriteOutput);
      console.log("[SVG Sprite] All icons removed. Sprite file deleted.");
    }
    fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));
    if (server) server.ws.send({ type: "full-reload", path: "*" });
    return;
  }

  const spriteHash = hash(sprite);

  if (cache.__spriteHash === spriteHash) {
    fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(spriteOutput), { recursive: true });
  fs.writeFileSync(spriteOutput, sprite, "utf8");

  newCache.__spriteHash = spriteHash;
  fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));

  console.log("[SVG Sprite] Sprite successfully updated.");

  if (server) {
    server.ws.send({ type: "full-reload", path: "*" });
  }
};

// --------------------------------------------------
// VITE PLUGIN EXPORT
// --------------------------------------------------
export default function runSvgSprite(options = {}) {
  return {
    name: "vite-svg-pipeline",
    buildStart() {
      generateSprite();
    },
    configureServer(server) {
      const dirs = [globalSrc];

      if (fs.existsSync(componentsDir)) {
        fs.readdirSync(componentsDir).forEach((comp) => {
          const dir = path.join(componentsDir, comp, "images", "sprite-src");
          if (fs.existsSync(dir)) dirs.push(dir);
        });
      }

      // Додаємо в отчер лише папки з іконками спрайту та загальну папку картинок
      dirs.forEach((dir) => server.watcher.add(dir));

      const imagesAssetsDir = path.resolve("src/assets/images");
      if (fs.existsSync(imagesAssetsDir)) {
        server.watcher.add(imagesAssetsDir);
      }

      server.watcher.on("all", (event, file) => {
        if (!file || file.endsWith("~") || file.endsWith("sprite.svg")) return;

        if (file.endsWith(".svg")) {
          if (!file.includes("sprite-src")) {
            if (event === "add" || event === "change") {
              processStandaloneSvg(file);
            }
          } else {
            generateSprite(server);
          }
        }
      });

      generateSprite(server);
    },
  };
}
