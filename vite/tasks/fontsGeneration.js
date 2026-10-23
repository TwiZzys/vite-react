import {readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync} from "fs";
import {join, extname, basename} from "path";
import chokidar from "chokidar";
import fontverter from "fontverter";

const weightMap = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  heavy: 800,
  black: 900
};

function parseFontName(name) {
  const clean = name.replace(/\.(ttf|otf)$/i, "");
  const lowName = clean.toLowerCase();
  const isVariable = lowName.includes("variable") || lowName.includes("vfgw") || lowName.includes("wght");
  const family = clean.replace(/[-_]/g, "");

  let weight = 400;
  let style = lowName.includes("italic") ? "italic" : "normal";

  if (isVariable) {
    weight = "100 1000";
  } else {
    const parts = clean.split(/[-_]+/);
    parts.forEach(part => {
      const low = part.toLowerCase();
      if (weightMap[low]) weight = weightMap[low];
    });
  }
  return {family, weight, style, isVariable, baseName: clean};
}

async function generateFonts(inDir, outDir, outScss, varsScss) {
  if (!existsSync(inDir)) {
    mkdirSync(inDir, {recursive: true});
  }
  if (!existsSync(outDir)) {
    mkdirSync(outDir, {recursive: true});
  }

  const files = readdirSync(inDir).filter(f => /\.(ttf|otf)$/i.test(f));

  let scssContent = "";
  let mixinsContent = "";

  if (files.length > 0) {
    let needsConversion = !existsSync(outScss);
    if (!needsConversion) {
      for (const file of files) {
        const fontPath = join(inDir, file);
        const base = basename(file, extname(file));
        const woff2Path = join(outDir, base + ".woff2");
        const woffPath = join(outDir, base + ".woff");

        if (!existsSync(woff2Path) || !existsSync(woffPath)) {
          needsConversion = true;
          break;
        }

        const fontStat = statSync(fontPath);
        if (fontStat.mtimeMs > statSync(woff2Path).mtimeMs) {
          needsConversion = true;
          break;
        }
      }
    }

    if (needsConversion) {
      console.log(`[fonts-auto] 🔄 Processing ${files.length} font(s)...`);
    }

    for (const file of files) {
      const fontPath = join(inDir, file);
      if (!existsSync(fontPath)) continue;

      const base = basename(file, extname(file));
      const parsed = parseFontName(base);

      try {
        const woff2Path = join(outDir, base + ".woff2");
        const woffPath = join(outDir, base + ".woff");
        const fontStat = statSync(fontPath);

        if (!existsSync(woff2Path) || !existsSync(woffPath) || fontStat.mtimeMs > statSync(woff2Path).mtimeMs) {
          console.log(`[fonts-auto] ⚙️ Converting: ${file} -> WOFF/WOFF2`);
          const fontBuffer = readFileSync(fontPath);

          const woff2Buf = await fontverter.convert(fontBuffer, "woff2");
          writeFileSync(woff2Path, woff2Buf);

          const woffBuf = await fontverter.convert(fontBuffer, "woff");
          writeFileSync(woffPath, woffBuf);
        }

        const woff2Format = parsed.isVariable ? 'format("woff2-variations")' : 'format("woff2")';
        scssContent += `@font-face {\n  font-family: "${parsed.family}";\n  font-weight: ${parsed.weight};\n  font-style: ${parsed.style};\n  font-display: swap;\n  src: local("${parsed.baseName}"),\n       url("../assets/fonts/${base}.woff2") ${woff2Format},\n       url("../assets/fonts/${base}.woff") format("woff");\n}\n\n`;

        let mixinName = parsed.family.replace(/VariableFont/i, "").replace(/Variable/i, "");
        if (parsed.isVariable) {
          mixinName += "Var";
          mixinsContent += `@mixin ${mixinName}($wght: 400) {\n  font-family: '${parsed.family}', sans-serif;\n  font-weight: $wght;\n  font-style: ${parsed.style};\n}\n\n`;
        } else {
          mixinsContent += `@mixin ${mixinName}() {\n  font-family: '${parsed.family}', sans-serif;\n  font-weight: ${parsed.weight};\n  font-style: ${parsed.style};\n}\n\n`;
        }
      } catch (err) {
        console.warn(`[fonts-auto] ❌ Error processing ${file}:`, err.message);
      }
    }
  } else {
    console.log(`[fonts-auto] ℹ️ No fonts found. Clearing _fonts.scss and mixins.`);
  }

  // Записуємо _fonts.scss тільки якщо вміст реально змінився
  const currentScss = existsSync(outScss) ? readFileSync(outScss, "utf-8") : "";
  if (currentScss !== scssContent) {
    writeFileSync(outScss, scssContent);
    console.log(`[fonts-auto] ✨ Successfully updated: ${outScss}`);
  }

  // Оновлюємо міксини в _vars.scss тільки якщо є різниця
  if (existsSync(varsScss)) {
    let varsRaw = readFileSync(varsScss, "utf-8");
    const startMarker = "// ==== FONTS START ====";
    const endMarker = "// ==== FONTS END ====";
    const startIndex = varsRaw.indexOf(startMarker);
    const endIndex = varsRaw.indexOf(endMarker);
    const contentToInsert = `${startMarker}\n\n${mixinsContent}${endMarker}`;

    let newVars = (startIndex !== -1 && endIndex !== -1)
      ? varsRaw.slice(0, startIndex) + contentToInsert + varsRaw.slice(endIndex + endMarker.length)
      : varsRaw + "\n\n" + contentToInsert + "\n";

    if (varsRaw !== newVars) {
      writeFileSync(varsScss, newVars);
      console.log(`[fonts-auto] ✨ Successfully updated mixins in: ${varsScss}`);
    }
  }
}

export default function fontPlugin(options = {}) {
  const inDir = options.inDir || "src/assets/fonts/src";
  const outDir = options.outDir || "src/assets/fonts";
  const outScss = options.outScss || "src/scss/_fonts.scss";
  const varsScss = options.varsScss || "src/scss/_vars.scss";
  let debounceTimer = null;

  return {
    name: "vite-fonts-auto",
    async buildStart() {
      await generateFonts(inDir, outDir, outScss, varsScss);
    },
    configureServer() {
      generateFonts(inDir, outDir, outScss, varsScss);

      const watcher = chokidar.watch(inDir, {ignoreInitial: true});
      watcher.on("all", (event, path) => {
        console.log(`[fonts-auto] 👁️ File event [${event}]: ${path}`);
        if (event === "unlink") {
          const base = basename(path, extname(path));
          [".woff", ".woff2"].forEach(e => {
            const p = join(outDir, base + e);
            if (existsSync(p)) {
              try {
                unlinkSync(p);
                console.log(`[fonts-auto] 🗑️ Deleted old format: ${base + e}`);
              } catch (err) {
                console.warn(`[fonts-auto] ⚠️ Failed to delete ${base + e}:`, err.message);
              }
            }
          });
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => generateFonts(inDir, outDir, outScss, varsScss), 300);
      });
    }
  };
}
