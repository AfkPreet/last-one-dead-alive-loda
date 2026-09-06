/* bundle.js — flatten the site into one self-contained HTML file.
 * Used to publish the game as a single hosted page; the multi-file source in
 * the repo stays the thing you actually edit.
 *   node tools/bundle.js [outfile]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'last-one-dead.html');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// The host wraps the file in its own doctype/head/body, so ship content only.
const bodyStart = html.indexOf('<body>');
const bodyEnd = html.lastIndexOf('</body>');
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'LAST ONE DEAD';
let body = html.slice(bodyStart + '<body>'.length, bodyEnd);

// Nothing outside this file exists once it is published: no manifest, no
// service worker, no icon files. Strip the references rather than 404 on them.
body = body.replace(/<link[^>]*rel="manifest"[^>]*>\s*/g, '');

const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

// Inline the scripts, in the order the page declares them.
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const js = scripts.map(src => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '/* ===== ' + src + ' ===== */\n' + code;
}).join('\n');
body = body.replace(/<script src="[^"]+"><\/script>\s*/g, '');

// A closing-tag sequence inside a string literal would end the script element.
const safe = s => s.replace(/<\/script>/gi, '<\\/script>');

/* Make the output pure ASCII so it renders correctly no matter what encoding
 * the host declares. The burnline is emoji, so a mis-decoded file is not a
 * cosmetic problem here — it is the share artifact turning into mojibake. */
const asciiJs = s => s.replace(/[^\x00-\x7F]/g, c =>
  '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const asciiHtml = s => s.replace(/[^\x00-\x7F]/g, c =>
  '&#x' + c.charCodeAt(0).toString(16) + ';');

const out = [
  // Without this the layout viewport is ~980px, the canvas backing store grows
  // ~6x, and the game runs at 6fps on a phone. A host that supplies its own
  // viewport meta wins on the first declaration, so this is safe to include.
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  // Inline favicon so a standalone copy doesn't 404 on /favicon.ico.
  '<link rel="icon" href="data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="%230a0812"/>' +
      '<circle cx="32" cy="32" r="22" fill="none" stroke="%237b2ff7" stroke-width="3"/>' +
      '<circle cx="32" cy="32" r="7" fill="%23fff3b0"/></svg>').replace(/'/g, '%27') + '">',
  '<title>' + asciiHtml(title) + '</title>',
  '<style>',
  asciiHtml(css.trim()),
  '</style>',
  asciiHtml(body.trim()),
  '<script>',
  asciiJs(safe(js)),
  '</script>',
  ''
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log('wrote ' + path.relative(ROOT, OUT) + '  ' + (out.length / 1024).toFixed(1) + ' KB');
console.log('  scripts inlined: ' + scripts.length);
for (const bad of ['<!doctype', '<html', '<head', '<body']) {
  if (out.toLowerCase().includes(bad)) console.log('  WARNING: output still contains ' + bad);
}
