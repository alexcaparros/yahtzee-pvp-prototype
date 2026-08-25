const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /pwaNavigator\.serviceWorker\.register\('\.\/sw\.js'\)/);

assert.equal(manifest.display, 'fullscreen');
assert.equal(manifest.orientation, 'portrait');
assert.equal(manifest.start_url, './?source=pwa');
assert.equal(manifest.scope, './');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));

for (const icon of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
  assert.ok(fs.existsSync(path.join(root, 'icons', icon)), `${icon} should exist`);
}

assert.match(sw, /self\.addEventListener\('install'/);
assert.match(sw, /self\.addEventListener\('fetch'/);
assert.match(sw, /caches\.open\(CACHE_NAME\)/);

console.log('pwaInstall=ok display=fullscreen ios=standalone android=installable');
