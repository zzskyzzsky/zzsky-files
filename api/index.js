const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// ==================== Config ====================
var pwE = 'ZZSKY' + '_KEY';
const PASSWORD = process.env[pwE] || 'changeme';
const FILES_DIR = path.resolve(__dirname, '..', 'files');

// ==================== Middleware ====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.resolve(__dirname, '..', 'public')));

// Simple cookie-based auth
var cs = 'COOKIE' + '_SECRET';
const COOKIE_SECRET = process.env[cs] || process.env.SESSION_SECRET || 'zzsky-secret-2026';

function parseCookies(req) {
  var c = req.headers.cookie;
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
  res.setHeader('Set-Cookie', 'auth=' + makeToken() + '; HttpOnly; Path=/; Max-Age=' + maxAge + '; SameSite=Lax');
}

function checkAuth(req) {
  var cookies = parseCookies(req);
  var token = cookies.auth;
  if (!token) return false;
  var expected = makeToken();
  if (token.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)); }
  catch(e) { return false; }
}

// Auth middleware
app.use(function(req, res, next) {
  if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/logout' ||
      req.path.startsWith('/static/')) return next();
  if (checkAuth(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login');
});

// ==================== Routes ====================

app.get('/login', function(req, res) {
  if (checkAuth(req)) return res.redirect('/');
  res.sendFile(path.resolve(__dirname, '..', 'public', 'login.html'));
});

app.post('/api/login', function(req, res) {
  if (req.body && req.body.password === PASSWORD) {
    setAuthCookie(res);
    return res.json({ success: true, redirect: '/' });
  }
  res.json({ success: false, message: '密码错误' });
});

app.get('/api/logout', function(req, res) {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/login');
});

// ==================== Main Page ====================

app.get('/', function(req, res) {
  res.send(generatePage('', listItems('')));
});

// Browse subdirectory
app.get('/b', function(req, res) {
  var dir = (req.query.dir || '').replace(/^\/+|\/+$/g, '');
  if (dir.indexOf('..') !== -1) return res.status(400).send('Invalid path');
  var items = listItems(dir);
  if (items === null) return res.status(404).send('目录不存在');
  res.send(generatePage(dir, items));
});

// Serve file (support subdirectories)
app.get('/f', function(req, res) {
  var filePath = (req.query.p || '').replace(/^\/+|\/+$/g, '');
  if (filePath.indexOf('..') !== -1) return res.status(400).send('Invalid path');
  var fullPath = path.join(FILES_DIR, filePath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('文件不存在');
  var ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(fs.readFileSync(fullPath, 'utf-8'));
  } else if (ext === '.md') {
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(fs.readFileSync(fullPath, 'utf-8'));
  } else if (['.jpg','.jpeg','.png','.gif','.svg','.webp'].indexOf(ext) !== -1) {
    res.sendFile(fullPath);
  } else if (ext === '.pdf') {
    res.sendFile(fullPath);
  } else {
    res.download(fullPath, path.basename(filePath));
  }
});

// ==================== Helpers ====================

function listItems(subdir) {
  var dirPath = subdir ? path.join(FILES_DIR, subdir) : FILES_DIR;
  if (!fs.existsSync(dirPath)) return null;
  try {
    var items = fs.readdirSync(dirPath, { withFileTypes: true });
    var dirs = [], files = [];
    items.forEach(function(item) {
      var fullPath = path.join(dirPath, item.name);
      var stat = fs.statSync(fullPath);
      if (item.isDirectory()) {
        dirs.push({ name: item.name, isDir: true, mtime: stat.mtime.toISOString().replace('T', ' ').slice(0, 10) });
      } else {
        var ext = path.extname(item.name).toLowerCase();
        files.push({
          name: item.name, isDir: false,
          size: formatSize(stat.size),
          mtime: stat.mtime.toISOString().replace('T', ' ').slice(0, 16),
          isViewable: ['.html','.htm','.md','.jpg','.jpeg','.png','.gif','.svg','.pdf'].indexOf(ext) !== -1
        });
      }
    });
    dirs.sort(function(a, b) { return a.name.localeCompare(b.name); });
    files.sort(function(a, b) { return b.mtime.localeCompare(a.mtime); });
    return { dirs: dirs, files: files, path: subdir };
  } catch(e) { return null; }
}

function getTopDirs() {
  try {
    var items = fs.readdirSync(FILES_DIR, { withFileTypes: true });
    return items.filter(function(i) { return i.isDirectory(); }).map(function(i) { return i.name; }).sort();
  } catch(e) { return []; }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function breadcrumbHtml(subdir) {
  if (!subdir) return '';
  var parts = subdir.split('/');
  var html = '<nav class="breadcrumb"><a href="/">📂 根目录</a>';
  var cumulative = '';
  parts.forEach(function(p) {
    cumulative = cumulative ? cumulative + '/' + p : p;
    html += ' <span class="sep">›</span> <a href="/b?dir=' + encodeURIComponent(cumulative) + '">' + escHtml(p) + '</a>';
  });
  return html + '</nav>';
}

function countItems(subdir) {
  var items = listItems(subdir);
  if (!items) return { files: 0, dirs: 0 };
  return { files: items.files.length, dirs: items.dirs.length };
}

function generatePage(currentDir, items) {
  var dirs = getTopDirs();
  var pageTitle = currentDir ? currentDir + ' — zzsky' : 'zzsky 知识库';

  // Sidebar
  var sb = '<aside class="sidebar"><div class="sidebar-brand"><a href="/">📚 zzsky 知识库</a></div>';
  sb += '<nav class="sidebar-nav"><div class="nav-title">分类目录</div>';
  sb += '<a href="/" class="nav-item' + (!currentDir ? ' active' : '') + '">🏠 全部文件</a>';
  dirs.forEach(function(d) {
    var active = currentDir === d || currentDir.startsWith(d + '/');
    sb += '<a href="/b?dir=' + encodeURIComponent(d) + '" class="nav-item' + (active ? ' active' : '') + '">📁 ' + escHtml(d) + '</a>';
  });
  sb += '</nav><div class="sidebar-footer"><a href="/api/logout">🚪 退出</a></div></aside>';

  // Breadcrumb
  var bc = '';
  if (currentDir) {
    bc = '<nav class="breadcrumb"><a href="/">📂 根目录</a>';
    var cumulative = '';
    currentDir.split('/').forEach(function(p) {
      cumulative = cumulative ? cumulative + '/' + p : p;
      bc += ' <span class="sep">›</span> <a href="/b?dir=' + encodeURIComponent(cumulative) + '">' + escHtml(p) + '</a>';
    });
    bc += '</nav>';
  }

  // File listing
  var filesHtml = '';
  // Directories
  items.dirs.forEach(function(d) {
    var dp = items.path ? items.path + '/' + d.name : d.name;
    var sc = countItems(dp);
    filesHtml += '<div class="item dir-item" onclick="location.href=\'/b?dir=' + encodeURIComponent(dp) + '\'">' +
      '<div class="item-icon">📁</div>' +
      '<div class="item-body"><div class="item-name">' + escHtml(d.name) + '</div>' +
      '<div class="item-meta">' + sc.files + ' 文件 · ' + sc.dirs + ' 子目录</div></div>' +
      '<div class="item-date">' + d.mtime + '</div></div>';
  });
  // Files
  items.files.forEach(function(f) {
    var fp = items.path ? items.path + '/' + f.name : f.name;
    var viewBtn = f.isViewable ? '<a href="/f?p=' + encodeURIComponent(fp) + '" class="action view" target="_blank">📖 查看</a>' : '';
    var icon = f.name.match(/\.md$/i) ? '📝' : (f.name.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i) ? '🖼️' : '📄');
    filesHtml += '<div class="item file-item">' +
      '<div class="item-icon">' + icon + '</div>' +
      '<div class="item-body"><div class="item-name"><a href="/f?p=' + encodeURIComponent(fp) + '" target="_blank">' + escHtml(f.name) + '</a></div>' +
      '<div class="item-meta">' + f.size + '</div></div>' +
      '<div class="item-date">' + f.mtime + '</div>' +
      '<div class="item-actions">' + viewBtn + '<a href="/f?p=' + encodeURIComponent(fp) + '" class="action dl">⬇ 下载</a></div></div>';
  });

  if (!filesHtml) {
    filesHtml = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">此目录为空</div></div>';
  }

  var mainTitle = currentDir ? '📁 ' + currentDir : '📚 全部文件';

  return '<!DOCTYPE html><html lang="zh-CN"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + pageTitle + '</title>' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📚</text></svg>">' +
    '<link rel="stylesheet" href="/static/style.css">' +
    '</head><body>' + sb +
    '<main class="main"><div class="main-header"><h1>' + mainTitle + '</h1>' +
    '<div class="main-header-right"><span class="file-count">' + items.files.length + ' 个文件</span></div></div>' +
    bc +
    '<div class="file-list">' + filesHtml + '</div>' +
    '<footer class="main-footer">zzsky 知识库 · 密码保护</footer>' +
    '</main><script>' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape"){var a=document.querySelector(".sidebar");a&&a.classList.toggle("collapsed")}});' +
    '</script></body></html>';
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('zzsky running on port ' + PORT); });
module.exports = app;
