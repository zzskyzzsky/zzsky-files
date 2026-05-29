const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

// ==================== Config ====================
const PASSWORD = process.env.VERCEL_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'zzsky-files-secret-2026';
const FILES_DIR = path.resolve(__dirname, '..', 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// ==================== Middleware ====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: !!process.env.VERCEL,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Static files (login page, CSS)
app.use('/static', express.static(path.resolve(__dirname, '..', 'public')));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path === '/login' || req.path.startsWith('/static/') || req.path === '/api/login') {
    return next();
  }
  if (req.method === 'POST' && req.path === '/api/login') {
    return next();
  }
  res.redirect('/login');
}

app.use(requireAuth);

// ==================== Routes ====================

// Login page
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.resolve(__dirname, '..', 'public', 'login.html'));
});

// Login POST
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true, redirect: '/' });
  }
  res.json({ success: false, message: '密码错误' });
});

// Logout
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// API: list files (JSON)
app.get('/api/files', (req, res) => {
  const files = listFiles();
  res.json({ files });
});

// Home page
app.get('/', (req, res) => {
  const files = listFiles();
  res.send(generateListingPage(files));
});

// Serve file
app.get('/files/:name', (req, res) => {
  const fileName = path.basename(req.params.name);
  const filePath = path.join(FILES_DIR, fileName);

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
  let files = [];
  try {
    const items = fs.readdirSync(FILES_DIR, { withFileTypes: true });
    files = items
      .filter(item => item.isFile())
      .map(item => {
        const stat = fs.statSync(path.join(FILES_DIR, item.name));
        return {
          name: item.name,
          size: formatSize(stat.size),
          mtime: stat.mtime.toISOString().replace('T', ' ').slice(0, 16),
          isHtml: item.name.endsWith('.html') || item.name.endsWith('.htm')
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (e) {
    // files dir might not exist
  }
  return files;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function generateListingPage(files) {
  const fileRows = files.map(f => {
    const viewLink = f.isHtml
      ? ` <a href="/files/${f.name}" class="view-link">📖 查看</a>`
      : '';
    return `<tr>
      <td class="fname">📄 ${f.name}</td>
      <td class="fsize">${f.size}</td>
      <td class="ftime">${f.mtime}</td>
      <td class="faction">
        <a href="/files/${f.name}" class="dl-link">⬇ 下载</a>${viewLink}
      </td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>zzsky 文件站</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📂 zzsky 文件站</h1>
      <a href="/api/logout" class="logout">退出</a>
    </div>
    ${files.length === 0
      ? '<p class="empty">暂无文件</p>'
      : `<table>
        <thead>
          <tr>
            <th>文件名</th>
            <th>大小</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${fileRows}</tbody>
      </table>`
    }
    <p class="footer">文件通过 Git 推送自动更新 · 密码保护</p>
  </div>
</body>
</html>`;
}

module.exports = app;
