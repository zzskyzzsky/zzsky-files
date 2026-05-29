const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// ==================== Config ====================
// var PASSWORD = (process.env.VERCEL_PASSWORD || 'changeme');
var pwE = 'ZZSKY' + '_KEY';
var PASSWORD = process.env[pwE] || 'changeme';

const FILES_DIR = path.resolve(__dirname, '..', 'files');

// ==================== Middleware ====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use('/static', express.static(path.resolve(__dirname, '..', 'public')));

// Simple cookie-based auth (no session store needed)
const COOKIE_SECRET = process.env.COOKIE_SECRET || process.env.SESSION_SECRET || 'zzsky-secret-2026';

function parseCookies(req) {
  const c = req.headers.cookie;
  if (!c) return {};
  return c.split(';').reduce(function(o, kv) {
    var parts = kv.trim().split('=');
    o[parts[0]] = decodeURIComponent(parts[1] || '');
    return o;
  }, {});
}

function makeToken() {
  var h = crypto.createHmac('sha256', COOKIE_SECRET);
  h.update('auth:' + PASSWORD);
  return h.digest('hex');
}

function setAuthCookie(res) {
  var maxAge = 7 * 24 * 60 * 60;
  var secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'auth=' + makeToken() + '; HttpOnly; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure);
}

function checkAuth(req) {
  var cookies = parseCookies(req);
  var token = cookies.auth;
  if (!token) return false;
  var expected = makeToken();
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch(e) {
    return false;
  }
}

// Auth middleware
app.use(function(req, res, next) {
  if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/logout' ||
      req.path.startsWith('/static/')) {
    return next();
  }
  if (checkAuth(req)) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.redirect('/login');
});

// ==================== Routes ====================

// Login page
app.get('/login', function(req, res) {
  if (checkAuth(req)) {
    return res.redirect('/');
  }
  res.sendFile(path.resolve(__dirname, '..', 'public', 'login.html'));
});

// Login POST
app.post('/api/login', function(req, res) {
  if (req.body && req.body.password === PASSWORD) {
    setAuthCookie(res);
    return res.json({ success: true, redirect: '/' });
  }
  res.json({ success: false, message: '密码错误' });
});

// Logout
app.get('/api/logout', function(req, res) {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/login');
});

// API: list files (JSON)
app.get('/api/files', function(req, res) {
  res.json({ files: listFiles() });
});

// Home page
app.get('/', function(req, res) {
  res.send(generateListingPage(listFiles()));
});

// Serve file
app.get('/files/:name', function(req, res) {
  var fileName = path.basename(req.params.name);
  var filePath = path.join(FILES_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('文件不存在');
  }
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(fs.readFileSync(filePath, 'utf-8'));
  } else {
    res.download(filePath, fileName);
  }
});

// ==================== Helpers ====================

function listFiles() {
  if (!fs.existsSync(FILES_DIR)) return [];
  try {
    var items = fs.readdirSync(FILES_DIR, { withFileTypes: true });
    return items.filter(function(item) { return item.isFile(); }).map(function(item) {
      var stat = fs.statSync(path.join(FILES_DIR, item.name));
      return {
        name: item.name,
        size: formatSize(stat.size),
        mtime: stat.mtime.toISOString().replace('T', ' ').slice(0, 16),
        isHtml: item.name.endsWith('.html') || item.name.endsWith('.htm')
      };
    }).sort(function(a, b) { return b.mtime.localeCompare(a.mtime); });
  } catch(e) {
    return [];
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function generateListingPage(files) {
  var rows = files.map(function(f) {
    var viewLink = f.isHtml ? ' <a href="/files/' + escHtml(f.name) + '" class="view-link">📖 查看</a>' : '';
    return '<tr>' +
      '<td class="fname">📄 ' + escHtml(f.name) + '</td>' +
      '<td class="fsize">' + f.size + '</td>' +
      '<td class="ftime">' + f.mtime + '</td>' +
      '<td class="faction"><a href="/files/' + escHtml(f.name) + '" class="dl-link">⬇ 下载</a>' + viewLink + '</td>' +
      '</tr>';
  }).join('\n');

  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>zzsky 文件站</title>\n<link rel="stylesheet" href="/static/style.css">\n</head>\n<body>\n' +
    '<div class="container">\n<div class="header">\n<h1>📂 zzsky 文件站</h1>\n' +
    '<a href="/api/logout" class="logout">退出</a>\n</div>\n' +
    (files.length === 0
      ? '<p class="empty">暂无文件</p>'
      : '<table><thead><tr><th>文件名</th><th>大小</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>') +
    '\n<p class="footer">文件通过 Git 推送自动更新 · 密码保护</p>\n</div>\n</body>\n</html>';
}

// Start server when run directly (not as Vercel module)
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('zzsky-files running on port ' + PORT);
});

module.exports = app;
