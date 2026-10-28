const fs = require('fs');
const path = require('path');
const terser = require('terser');
const csso = require('csso');
const { minify: minifyHtml } = require('html-minifier-terser');
const archiver = require('archiver');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const { version } = require(path.join(ROOT_DIR, 'package.json'));

/**
 * Only production files are shipped. Everything under `tools/`, `scripts/`
 * and any dev artefact stays out of the archive.
 */
const SOURCE_FILES = ['icons', 'src', 'manifest.json', '_locales'];

const HTML_OPTIONS = {
  collapseWhitespace: true,
  keepClosingSlash: true,
  removeComments: true,
  minifyJS: true,
  minifyCSS: true,
  removeOptionalTags: false,
  removeAttributeQuotes: true,
  removeScriptTypeAttributes: true,
  removeStyleTypeAttributes: true,
  removeRedundantAttributes: true,
  collapseBooleanAttributes: true,
  useShortDoctype: true,
};

function collectFiles(dir, predicate) {
  const results = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
    }
  })(dir);
  return results;
}

/**
 * Content scripts are classic scripts loaded by Chrome, so they must keep
 * their top-level names. Terser's `mangle` is safe (it only renames locals),
 * but we never enable `toplevel`.
 */
const TERSER_OPTIONS = {
  compress: true,
  mangle: true,
  format: { comments: false },
};

async function main() {
  if (fs.existsSync(DIST_DIR)) {
    console.log('🧹 Cleaning previous build…');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }

  console.log('📁 Copying files…');
  for (const file of SOURCE_FILES) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(DIST_DIR, file), { recursive: true });
  }

  console.log('⚡ Minifying JavaScript…');
  for (const filePath of collectFiles(DIST_DIR, (f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = await terser.minify(code, TERSER_OPTIONS);
    if (result.error) {
      throw new Error(`terser failed on ${path.relative(ROOT_DIR, filePath)}: ${result.error.message}`);
    }
    fs.writeFileSync(filePath, result.code, 'utf8');
    const saved = ((code.length - result.code.length) / code.length) * 100;
    console.log(`   ✓ ${path.relative(DIST_DIR, filePath)}  (—${saved.toFixed(1)}%)`);
  }

  console.log('🎨 Minifying CSS…');
  for (const filePath of collectFiles(DIST_DIR, (f) => f.endsWith('.css'))) {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = csso.minify(code);
    fs.writeFileSync(filePath, result.css, 'utf8');
    const saved = ((code.length - result.css.length) / code.length) * 100;
    console.log(`   ✓ ${path.relative(DIST_DIR, filePath)}  (—${saved.toFixed(1)}%)`);
  }

  console.log('📄 Minifying HTML…');
  for (const filePath of collectFiles(DIST_DIR, (f) => f.endsWith('.html'))) {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = await minifyHtml(code, HTML_OPTIONS);
    fs.writeFileSync(filePath, result, 'utf8');
    const saved = ((code.length - result.length) / code.length) * 100;
    console.log(`   ✓ ${path.relative(DIST_DIR, filePath)}  (—${saved.toFixed(1)}%)`);
  }

  console.log('🗂️ Normalising manifest + JSON…');
  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  console.log(`   ✓ manifest.json  (version ${version})`);

  // Fail loudly instead of shipping a broken archive.
  for (const [key, relPath] of Object.entries(manifest.icons)) {
    if (!fs.existsSync(path.join(DIST_DIR, relPath))) throw new Error(`missing icon ${key}: ${relPath}`);
  }

  console.log('📦 Creating zip archive…');
  const zipName = `deepseek-usage-monitor-v${version}.zip`;
  const zipPath = path.join(ROOT_DIR, zipName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`   ✓ ${zipName}  (${(archive.pointer() / 1024).toFixed(1)} KB)`);
      resolve();
    });
    archive.on('error', (err) => reject(new Error(`archiver error: ${err.message}`)));

    archive.pipe(output);
    archive.directory(DIST_DIR, false);
    archive.finalize();
  });

  console.log('✅ Build complete!');
}

main().catch((err) => {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
});
