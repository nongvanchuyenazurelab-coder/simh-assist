const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8888;
const TARGET_HOST = 'ytcs.hmis.vn';
const TARGET_API_HOST = 'ytcs-gw.hmis.vn';
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const MODULES_FILE = path.join(__dirname, 'modules.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Module phân tích cURL & chuyển đổi Excel cho VNPT-HIS
const { fetchFromCurl } = require('./curl_parser');
const { convertHisJsonToWorkbook } = require('./his_converter');
const hisThaiNguyenService = require('./his_thainguyen_service');

// Bộ đệm lưu trữ workbook gần nhất cho việc tải về Excel
let lastExcelBuffer = null;
let lastExcelFilename = 'DMC_DICHVU_output.xlsx';

// Bộ nhớ đệm phiên đăng nhập đa tab / subdomain
const sessionsCache = new Map();

// Bộ nhớ đệm nhật ký API theo thời gian thực (lưu tối đa 300 request gần nhất)
const apiLogs = [];
const MAX_API_LOGS = 300;

function buildCurlCommand(method, url, headers, body) {
  const parts = [`curl -X ${method} "${url}"`];
  const safeHeaders = ['authorization', 'region-code', 'tenant-code', 'content-type', 'accept', 'schema-ods', 'schema-dwh', 'session_id'];
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (safeHeaders.includes(k.toLowerCase()) && v) {
        parts.push(`  -H "${k}: ${v}"`);
      }
    }
  }
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    if (bodyStr.length > 0) {
      parts.push(`  --data-raw ${JSON.stringify(bodyStr)}`);
    }
  }
  return parts.join(' \\\n');
}

function logApiCall(info) {
  try {
    const curlCmd = buildCurlCommand(info.method, info.targetUrl, info.headers, info.body);
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      time: new Date().toISOString(),
      timeStr: new Date().toLocaleTimeString('vi-VN'),
      subdomain: info.subdomain || 'main',
      method: info.method || 'GET',
      apiUrl: info.targetUrl,
      frameUrl: info.frameUrl || ('https://' + TARGET_HOST + '/'),
      statusCode: info.statusCode || 200,
      durationMs: info.durationMs || 0,
      curl: curlCmd,
      body: info.body || '',
      contentType: info.contentType || ''
    };

    apiLogs.push(entry);
    if (apiLogs.length > MAX_API_LOGS) {
      apiLogs.shift();
    }

    const statusColor = (entry.statusCode >= 400) ? '\x1b[31m' : '\x1b[32m';
    console.log(`[API LOG][${entry.subdomain} | ${entry.frameUrl}] ${entry.method} ${entry.apiUrl} -> ${statusColor}${entry.statusCode}\x1b[0m (${entry.durationMs}ms)`);

    const logLine = `[${entry.time}] [TAB: ${entry.subdomain}] [STATUS: ${entry.statusCode} (${entry.durationMs}ms)]\n` +
      `  FRAME URL: ${entry.frameUrl}\n` +
      `  API URL:   ${entry.apiUrl}\n` +
      `  METHOD:    ${entry.method}\n` +
      `  CURL:      ${curlCmd.replace(/ \\\n/g, ' ')}\n` +
      `--------------------------------------------------------------------------------\n`;

    fs.appendFile(path.join(__dirname, 'api_requests.log'), logLine, () => {});
  } catch(e) {
    console.error('Lỗi khi ghi log API:', e.message);
  }
}

// Tự động dọn dẹp sessions cũ quá 24h
setInterval(() => {
  const now = Date.now();
  for (const [sid, item] of sessionsCache.entries()) {
    if (now - item.createdAt > 24 * 60 * 60 * 1000) {
      sessionsCache.delete(sid);
    }
  }
}, 60 * 60 * 1000);

// Đọc danh sách tài khoản
function readAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Lỗi đọc accounts.json:', e);
  }
  return [];
}

// Lưu danh sách tài khoản
function saveAccounts(accounts) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Lỗi ghi accounts.json:', e);
    return false;
  }
}

// Danh sách module mặc định ban đầu
const DEFAULT_MODULES = [
  { id: 'mod_1', name: '⚡ Khám Ngoại trú (Tiếp nhận)', route: '/new/his/ngoaitru/tnkb/tiepnhan' },
  { id: 'mod_2', name: 'Khám Ngoại trú (Tổng quan)', route: '/new/his/ngoaitru' },
  { id: 'mod_3', name: 'Điều trị Nội trú', route: '/new/his/noitru' },
  { id: 'mod_4', name: 'Quản lý Dược', route: '/new/his/duoc' },
  { id: 'mod_5', name: 'Quản lý Viện phí', route: '/new/his/vien-phi' },
  { id: 'mod_6', name: 'Quản trị hệ thống', route: '/new/his/quantri-hethong' },
  { id: 'mod_7', name: '🛠️ Cấu hình Liên thông (KSK / ĐTĐT)', route: '/lien-thong-ksk' },
  { id: 'mod_8', name: '📊 Xuất Excel Danh mục DV (cURL)', route: '/excel-tool' },
  { id: 'mod_canhbao', name: '⚠️ Cảnh Báo Đơn Vị', route: '/canh-bao' },
  { id: 'mod_nhanvien', name: '👤 Tạo nhanh Nhân viên & Tài khoản', route: '/tao-nhan-vien' },
  { id: 'mod_9', name: 'Màn hình Chọn khoa phòng', route: '/new/his/chon-khoaphong' },
  { id: 'mod_10', name: 'Màn hình Login gốc', route: '/new/his/dang-nhap' }
];

// Đọc danh sách module
function readModules() {
  try {
    if (fs.existsSync(MODULES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MODULES_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {
    console.error('Lỗi đọc modules.json:', e);
  }
  return DEFAULT_MODULES;
}

// Lưu danh sách module
function saveModules(modules) {
  try {
    fs.writeFileSync(MODULES_FILE, JSON.stringify(modules, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Lỗi ghi modules.json:', e);
    return false;
  }
}

// Đọc request body JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Gọi API đăng nhập và tự động nạp thông tin user, menu, KHOA & PHÒNG đầu tiên
async function performLogin(username, password, regionCode = 'region2') {
  const loginPayload = JSON.stringify({ username, password });

  // 1. Gửi request Login
  const loginRes = await fetch(`https://${TARGET_API_HOST}/api/authen/public/login`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': `https://${TARGET_HOST}`,
      'Referer': `https://${TARGET_HOST}/`,
      'REGION-CODE': regionCode,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: loginPayload
  });

  const loginData = await loginRes.json();
  if (loginData.code !== 200 || !loginData.data?.accessToken) {
    return {
      success: false,
      message: loginData.message || 'Đăng nhập không thành công',
      code: loginData.code
    };
  }

  const { accessToken, refreshToken, expiredTime, adminRegion } = loginData.data;

  // 2. Lấy thông tin user (authen/admuser/info)
  let userInfo = null;
  try {
    const infoRes = await fetch(`https://${TARGET_API_HOST}/api/authen/admuser/info`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'REGION-CODE': regionCode,
        'Accept': 'application/json, text/plain, */*',
        'Origin': `https://${TARGET_HOST}`,
        'Referer': `https://${TARGET_HOST}/`
      }
    });
    const infoJson = await infoRes.json();
    if (infoJson.code === 200) {
      userInfo = infoJson.data;
    }
  } catch (err) {
    console.warn('Lỗi lấy user info:', err.message);
  }

  // 3. Lấy menu người dùng (common/menus/customer)
  let menus = null;
  try {
    const menuRes = await fetch(`https://${TARGET_API_HOST}/api/common/menus/customer`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'REGION-CODE': regionCode,
        'Accept': 'application/json, text/plain, */*',
        'Origin': `https://${TARGET_HOST}`,
        'Referer': `https://${TARGET_HOST}/`
      }
    });
    const menuJson = await menuRes.json();
    if (menuJson.code === 0 || menuJson.code === 200) {
      const rawMenu = JSON.parse(JSON.stringify(menuJson.data || []).replaceAll('"url"', '"route"'));
      menus = rawMenu.map(item => ({
        ...item,
        icon: item.children && item.children.length > 0 ? 'caret-down' : ''
      }));
    }
  } catch (err) {
    console.warn('Lỗi lấy menu:', err.message);
  }

  // 4. Lấy danh sách Khoa & tự động chọn Khoa đầu tiên
  let defaultKhoa = userInfo?.officer?.khoa || null;
  let defaultPhong = null;
  let khoaList = [];
  let phongList = [];

  const companyId = userInfo?.company?.id || 1;
  try {
    const khoaRes = await fetch(`https://${TARGET_API_HOST}/api/common/organization/khoa?companyId=${companyId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'REGION-CODE': regionCode,
        'Accept': 'application/json, text/plain, */*'
      }
    });
    const khoaJson = await khoaRes.json();
    if (khoaJson.code === 0 && Array.isArray(khoaJson.data) && khoaJson.data.length > 0) {
      khoaList = khoaJson.data;
      if (!defaultKhoa) {
        defaultKhoa = khoaList[0];
      }
    }
  } catch (err) {
    console.warn('Lỗi lấy danh sách khoa:', err.message);
  }

  // 5. Lấy danh sách Phòng của Khoa đó & tự động chọn Phòng đầu tiên
  const targetKhoaId = defaultKhoa?.id || (khoaList[0]?.id);
  if (targetKhoaId) {
    try {
      const phongRes = await fetch(`https://${TARGET_API_HOST}/api/common/organization/phong?khoaId=${targetKhoaId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'REGION-CODE': regionCode,
          'Accept': 'application/json, text/plain, */*'
        }
      });
      const phongJson = await phongRes.json();
      if (phongJson.code === 0 && Array.isArray(phongJson.data) && phongJson.data.length > 0) {
        phongList = phongJson.data;
        defaultPhong = phongList[0];
      }
    } catch (err) {
      console.warn('Lỗi lấy danh sách phòng:', err.message);
    }
  }

  // 6. Tự động gọi API thiết lập cache khoa phòng trên máy chủ (common/cache/put)
  let showIcdYhct = 0;
  if (targetKhoaId && defaultPhong?.id) {
    try {
      await fetch(`https://${TARGET_API_HOST}/api/common/cache/put`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'REGION-CODE': regionCode
        },
        body: JSON.stringify({
          khoaId: targetKhoaId,
          phongId: defaultPhong.id
        })
      });

      const detRes = await fetch(`https://${TARGET_API_HOST}/api/common/dmcthongtinkhoaphong/details?khoaId=${targetKhoaId}&phongId=${defaultPhong.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'REGION-CODE': regionCode
        }
      });
      const detJson = await detRes.json();
      if (detJson.code === 0 && detJson.data?.showIcdYhct) {
        showIcdYhct = 1;
      }
    } catch (err) {
      console.warn('Lỗi lưu cache khoa phòng:', err.message);
    }
  }

  return {
    success: true,
    data: {
      accessToken,
      refreshToken,
      expiredTime,
      adminRegion: adminRegion ?? 0,
      userInfo,
      menus,
      defaultKhoa,
      defaultPhong,
      showIcdYhct,
      khoaList,
      phongList,
      regionCode
    }
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname !== '/_mgr/trace' && !pathname.startsWith('/new/assets') && !pathname.endsWith('.png') && !pathname.endsWith('.woff2') && !pathname.endsWith('.css') && !pathname.endsWith('.js')) {
    try {
      fs.appendFileSync(path.join(__dirname, 'trace.log'), `[HTTP] ${req.method} ${pathname} Host=${req.headers.host} Url=${req.url}\n`, 'utf8');
    } catch(e) {}
  }

  // Lấy chính xác Origin của client để trả về CORS hợp lệ (tránh lỗi wildcard * khi có Authorization / credentials)
  const getReqOrigin = () => {
    return req.headers.origin || (req.headers.host ? (req.connection?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https://' : 'http://') + req.headers.host : '*');
  };

  // CORS headers chung tương thích 100% với trình duyệt và Angular HttpClient
  const setCors = () => {
    const origin = getReqOrigin();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Real-Api-Url, X-Frame-Url, X-Tab-Subdomain, X-Upstream-Gateway, Content-Disposition, *');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  };

  if (req.method === 'OPTIONS') {
    setCors();
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Phục vụ trang Dashboard chính tại URL '/'
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  // 1b. Phục vụ trang Cấu hình Liên thông KSK / ĐTĐT / Viện Phí / Mẹ & Bé
  if (pathname === '/lien-thong-ksk' || pathname === '/lien-thong-ksk.html') {
    const kskPath = path.join(PUBLIC_DIR, 'lien-thong-ksk.html');
    if (fs.existsSync(kskPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(kskPath).pipe(res);
      return;
    }
  }

  // 1b2. Phục vụ trang Tool Trích xuất Danh mục Dịch vụ sang Excel (cURL to Excel)
  if (pathname === '/excel-tool' || pathname === '/excel-tool.html' || pathname === '/vnpt-his-excel-tool') {
    const excelToolPath = path.join(PUBLIC_DIR, 'excel-tool.html');
    if (fs.existsSync(excelToolPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(excelToolPath).pipe(res);
      return;
    }
  }

  // 1b3. Phục vụ trang Cảnh Báo Đơn Vị (Bệnh nhân chưa duyệt BHYT, KSK...)
  if (pathname === '/canh-bao' || pathname === '/canh-bao.html') {
    const canhBaoPath = path.join(PUBLIC_DIR, 'canh-bao.html');
    if (fs.existsSync(canhBaoPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(canhBaoPath).pipe(res);
      return;
    }
  }

  // 1b4. Phục vụ trang Tạo nhanh Nhân viên & Tài khoản
  if (pathname === '/tao-nhan-vien' || pathname === '/tao-nhan-vien.html') {
    const nhanVienPath = path.join(PUBLIC_DIR, 'nhan-vien.html');
    if (fs.existsSync(nhanVienPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(nhanVienPath).pipe(res);
      return;
    }
  }

  // 1c. Route ghi log chẩn đoán chuyển trang (Trace Log)
  if (pathname === '/_mgr/trace') {
    const from = parsedUrl.query.from || 'unknown';
    const sub = parsedUrl.query.sub || '';
    const urlStr = parsedUrl.query.url || '';
    const msg = parsedUrl.query.msg || '';
    const line = `[${new Date().toISOString()}] FROM=${from} SUB=${sub} MSG=${msg} URL=${urlStr}\n`;
    try {
      fs.appendFileSync(path.join(__dirname, 'trace.log'), line, 'utf8');
    } catch(e) {}
    setCors();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // 1d. Phục vụ frame-sync.js cho iframe Single-SPA
  if (pathname === '/_mgr/frame-sync.js' || pathname === '/frame-sync.js') {
    const frameSyncPath = path.join(PUBLIC_DIR, 'frame-sync.js');
    if (fs.existsSync(frameSyncPath)) {
      setCors();
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=UTF-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      fs.createReadStream(frameSyncPath).pipe(res);
      return;
    }
  }

  // 1e. Proxy xem/in file PDF/XML từ dms-hisl4.vnpt.vn (Khắc phục triệt để lỗi CORS khi in phiếu/đơn thuốc/kết quả/XML)
  if (pathname === '/dms-proxy' || pathname.startsWith('/dms-proxy/') || pathname.startsWith('/his4/') || pathname.includes('/dms-proxy')) {
    setCors();
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let targetPdfUrl = parsedUrl.query.target || parsedUrl.query.url;
    if (!targetPdfUrl) {
      if (pathname.includes('/dms-proxy/')) {
        const idx = req.url.indexOf('/dms-proxy/');
        targetPdfUrl = 'https://dms-hisl4.vnpt.vn/' + req.url.slice(idx + 11);
      } else if (pathname.includes('/his4/')) {
        const idx = req.url.indexOf('/his4/');
        targetPdfUrl = 'https://dms-hisl4.vnpt.vn' + req.url.slice(idx);
      }
    }

    if (targetPdfUrl) {
      if (targetPdfUrl.startsWith('/')) {
        targetPdfUrl = 'https://dms-hisl4.vnpt.vn' + targetPdfUrl;
      } else if (!targetPdfUrl.startsWith('http://') && !targetPdfUrl.startsWith('https://')) {
        targetPdfUrl = 'https://dms-hisl4.vnpt.vn/' + targetPdfUrl;
      }

      try {
        const u = new URL(targetPdfUrl);
        const reqHeaders = {
          'host': u.hostname,
          'origin': 'https://' + TARGET_HOST,
          'referer': 'https://' + TARGET_HOST + '/',
          'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'accept': req.headers['accept'] || '*/*'
        };
        if (req.headers['range']) {
          reqHeaders['range'] = req.headers['range'];
        }

        const proxyReq = https.request({
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: req.method,
          headers: reqHeaders
        }, (proxyRes) => {
          const respHeaders = { ...proxyRes.headers };
          const origin = getReqOrigin();
          respHeaders['access-control-allow-origin'] = origin;
          respHeaders['access-control-allow-credentials'] = 'true';
          respHeaders['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
          respHeaders['access-control-allow-headers'] = req.headers['access-control-request-headers'] || '*';
          respHeaders['access-control-expose-headers'] = 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition, ETag';
          respHeaders['vary'] = 'Origin';
          respHeaders['x-frame-options'] = 'ALLOWALL';
          delete respHeaders['content-security-policy'];

          res.writeHead(proxyRes.statusCode, respHeaders);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error('[DMS Proxy] Lỗi tải PDF:', err.message);
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway: ' + err.message);
        });

        req.pipe(proxyReq);
        return;
      } catch (err) {
        console.error('[DMS Proxy] Lỗi phân tích URL:', err.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL: ' + err.message);
        return;
      }
    }
  }

  // 2. Route nạp phiên làm việc độc lập cho tab/subdomain (/init-session)
  if (pathname === '/init-session') {
    const sid = parsedUrl.query.sid;
    let sessionData = sid ? sessionsCache.get(sid) : null;
    if (!sessionData && parsedUrl.query.payload) {
      try {
        sessionData = JSON.parse(decodeURIComponent(parsedUrl.query.payload));
      } catch (e) {}
    }

    const targetRoute = parsedUrl.query.route || sessionData?.targetRoute || '/new/his/ngoaitru/tnkb/tiepnhan';
    const embeddedJson = JSON.stringify(sessionData || {}).replace(/<\//g, '<\\/');
    const clientOrigin = getReqOrigin();

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': clientOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin'
    });
    res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Khởi tạo phiên làm việc...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f0f2f5; }
    .box { text-align:center; background:#fff; padding:24px 32px; border-radius:12px; box-shadow:0 4px 14px rgba(0,0,0,0.06); }
    .spin { display:inline-block; width:36px; height:36px; border:3px solid #1890ff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="box">
    <div class="spin"></div>
    <div style="margin-top:14px; font-size:14px; color:#1890ff; font-weight:600;">Đang khởi tạo phiên làm việc đa tab...</div>
  </div>
  <script>
    try {
      const data = ${embeddedJson};
      if (data && data.accessToken) {
        localStorage.setItem('jhi-accessToken', JSON.stringify(data.accessToken));
        if (data.expiredTime) localStorage.setItem('jhi-expiredTime', JSON.stringify(data.expiredTime));
        localStorage.setItem('jhi-adminRegion', JSON.stringify(data.adminRegion ?? 0));
        if (data.userInfo) {
          localStorage.setItem('jhi-info', JSON.stringify(data.userInfo));
          sessionStorage.setItem('jhi-info', JSON.stringify(data.userInfo));
          if (data.defaultKhoa) {
            const km = {}; km[String(data.userInfo.id)] = data.defaultKhoa;
            localStorage.setItem('jhi-khoa', JSON.stringify(km));
            sessionStorage.setItem('jhi-khoa', JSON.stringify(km));
          }
          if (data.defaultPhong) {
            const pm = {}; pm[String(data.userInfo.id)] = data.defaultPhong;
            localStorage.setItem('jhi-phong', JSON.stringify(pm));
            sessionStorage.setItem('jhi-phong', JSON.stringify(pm));
          }
        }
        if (data.menus) localStorage.setItem('jhi-menu', JSON.stringify(data.menus));
        localStorage.setItem('jhi-hienthiYHCT', String(data.showIcdYhct || 0));
        localStorage.setItem('jhi-lang', JSON.stringify('vi'));
        localStorage.removeItem('api:url:base');
        localStorage.removeItem('enviroment:origin');
        sessionStorage.removeItem('hideTenantSelectAfterReload');
      }
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'YTCS_URL_CHANGED',
            tabId: window.name || '',
            subdomain: window.location.hostname.split('.')[0] || '',
            url: window.location.origin + ${JSON.stringify(targetRoute)},
            pathname: ${JSON.stringify(targetRoute)}
          }, '*');
        }
      } catch(e) {}
      const sep = ${JSON.stringify(targetRoute)}.includes('?') ? '&' : '?';
      const freshRoute = ${JSON.stringify(targetRoute)} + sep + '_v=' + Date.now();
      window.location.replace(freshRoute);
    } catch(err) {
      console.error(err);
      const sep = ${JSON.stringify(targetRoute)}.includes('?') ? '&' : '?';
      const freshRoute = ${JSON.stringify(targetRoute)} + sep + '_v=' + Date.now();
      window.location.replace(freshRoute);
    }
  </script>
</body>
</html>`);
    return;
  }

  // 3. Quản lý danh sách tài khoản: /_mgr/accounts
  if (pathname === '/_mgr/accounts') {
    setCors();
    if (req.method === 'GET') {
      const accounts = readAccounts();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(accounts));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await parseRequestBody(req);
        if (Array.isArray(payload)) {
          saveAccounts(payload);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ success: true, message: 'Đã lưu danh sách tài khoản' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ success: false, message: 'Dữ liệu không hợp lệ' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ success: false, message: err.message }));
      }
      return;
    }
  }

  // 3a. Quản lý danh sách Module hay dùng: /_mgr/modules
  if (pathname === '/_mgr/modules') {
    setCors();
    if (req.method === 'GET') {
      const modules = readModules();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(modules));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await parseRequestBody(req);
        if (Array.isArray(payload)) {
          saveModules(payload);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ success: true, message: 'Đã lưu danh sách module hay dùng' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ success: false, message: 'Dữ liệu không hợp lệ' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ success: false, message: err.message }));
      }
      return;
    }
  }

  // 3b. API tra cứu & quản lý Nhật ký API: /_mgr/api-logs
  if (pathname === '/_mgr/api-logs') {
    setCors();
    if (req.method === 'GET') {
      const limit = parseInt(parsedUrl.query.limit, 10) || 100;
      const sub = parsedUrl.query.sub || '';
      let list = apiLogs;
      if (sub && sub !== 'all') {
        list = list.filter(item => item.subdomain === sub);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true, total: apiLogs.length, logs: list.slice(-limit) }));
      return;
    }
    if (req.method === 'DELETE') {
      apiLogs.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true, message: 'Đã làm trống danh sách nhật ký API' }));
      return;
    }
  }

  // 4. API đăng nhập nhanh & tự động chọn khoa phòng: /_mgr/login
  if (pathname === '/_mgr/login' && req.method === 'POST') {
    setCors();
    try {
      const { username, password, regionCode, targetRoute } = await parseRequestBody(req);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ success: false, message: 'Thiếu tài khoản hoặc mật khẩu' }));
        return;
      }
      const result = await performLogin(username, password, regionCode || 'region2');
      if (result.success) {
        const sessionId = 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        sessionsCache.set(sessionId, {
          ...result.data,
          targetRoute: targetRoute || '/new/his/ngoaitru/tnkb/tiepnhan',
          createdAt: Date.now()
        });
        result.sessionId = sessionId;
      }
      res.writeHead(result.success ? 200 : 401, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  // 4b. API tích hợp VNPT HIS Thái Nguyên: Quản lý kích hoạt User theo Đơn vị
  if (pathname === '/_mgr/his-tn/status' && req.method === 'GET') {
    setCors();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(hisThaiNguyenService.getStatus()));
    return;
  }

  if (pathname === '/_mgr/his-tn/login' && req.method === 'POST') {
    setCors();
    try {
      const { username, password } = await parseRequestBody(req);
      const result = await hisThaiNguyenService.loginHisThaiNguyen(username || 'ADMIN_IT', password || 'Hmis@@2026');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  if (pathname === '/_mgr/his-tn/enable-users' && req.method === 'POST') {
    setCors();
    try {
      const data = await parseRequestBody(req);
      let items = [];
      if (Array.isArray(data.items)) {
        items = data.items;
      } else if (data.madonvi && data.username) {
        items = [{ madonvi: data.madonvi, username: data.username }];
      } else {
        throw new Error('Dữ liệu yêu cầu không hợp lệ. Cần truyền madonvi & username hoặc mảng items.');
      }

      const result = await hisThaiNguyenService.processEnableUsers(items);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // 5. Thay thế cấu hình env.js của HIS để mọi API đi qua proxy tuyệt đối 'http://host/api/'
  if (pathname === '/new/assets/env.js') {
    const customEnvJs = `
(function(window) {
    window.env = window.env || {};
    const config = {
      API_URL: window.location.origin + '/api/',
      ENV: 'prod',
      SERVER_DREPORT: 'https://onehealth2.vncare.vn/',
      VERSION_NUMBER: '1.4.0'
    };
    window.env = config;
    window.__HIS_CONFIG__ = config;
})(this);
`;
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(customEnvJs);
    return;
  }

  // 5b. API Proxy KSK: Test KSK Login tới api.emrhub.vn
  if (pathname === '/api/test-ksk-login' && req.method === 'POST') {
    setCors();
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetUrl = payload.url || 'https://api.emrhub.vn/api/auth/login';
        const target = new url.URL(targetUrl);

        const postData = JSON.stringify({
          username: payload.username || '',
          password: payload.password || ''
        });

        const startTime = Date.now();
        const client = target.protocol === 'https:' ? https : http;

        const proxyReq = client.request({
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname + target.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
          }
        }, (proxyRes) => {
          let responseData = '';
          proxyRes.on('data', chunk => responseData += chunk);
          proxyRes.on('end', () => {
            const latency = Date.now() - startTime;
            res.writeHead(proxyRes.statusCode, {
              'Content-Type': proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
              'X-Response-Time-Ms': latency.toString(),
              'Access-Control-Allow-Origin': getReqOrigin(),
              'Access-Control-Allow-Credentials': 'true'
            });
            res.end(responseData);
          });
        });

        proxyReq.setTimeout(15000, () => {
          proxyReq.destroy(new Error('Hết thời gian chờ kết nối tới EMRHub (15s timeout)'));
        });

        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({
            header: { success: false, res_msg: `Lỗi kết nối tới máy chủ EMRHub: ${err.message}` },
            error: err.message
          }));
        });

        proxyReq.write(postData);
        proxyReq.end();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
        res.end(JSON.stringify({ error: 'Dữ liệu JSON không hợp lệ: ' + err.message }));
      }
    });
    return;
  }

  // 5c. API Proxy KSK: Lấy cặp khóa RSA Public / Private từ admin.emrhub.vn
  if (pathname === '/api/get-emrhub-keys' && req.method === 'POST') {
    setCors();
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const username = (payload.username || '').trim();
        const password = payload.password || '';

        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({ success: false, message: 'Vui lòng cung cấp đầy đủ username và password tài khoản admin.emrhub.vn' }));
          return;
        }

        const startTime = Date.now();

        // 1. Login to admin.emrhub.vn
        const loginRes = await fetch('https://admin.emrhub.vn/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Language': 'vi',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://admin.emrhub.vn/auth/login',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: JSON.stringify({ username, password })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok || !loginData.header || !loginData.header.success) {
          const errMsg = loginData.header?.res_msg || loginData.message || 'Đăng nhập admin.emrhub.vn thất bại';
          res.writeHead(loginRes.status || 401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({ success: false, message: errMsg, raw: loginData }));
          return;
        }

        // Extract WEB_TOKEN cookie
        const setCookie = loginRes.headers.get('set-cookie');
        let webToken = '';
        if (setCookie) {
          const m = setCookie.match(/WEB_TOKEN=([^;]+)/);
          if (m) webToken = m[1];
        }

        if (!webToken) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({ success: false, message: 'Đăng nhập thành công nhưng không nhận được cookie WEB_TOKEN từ máy chủ EMRHub' }));
          return;
        }

        // 2. Fetch Facility Profile to get keys
        const profileRes = await fetch('https://admin.emrhub.vn/api/admin/facility/profile', {
          headers: {
            'Cookie': `WEB_TOKEN=${webToken}`,
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://admin.emrhub.vn/facility/profile',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const profileData = await profileRes.json();
        if (!profileRes.ok || !profileData.header || !profileData.header.success || !profileData.data) {
          const errMsg = profileData.header?.res_msg || 'Không lấy được hồ sơ cơ sở khám chữa bệnh';
          res.writeHead(profileRes.status || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({ success: false, message: errMsg, raw: profileData }));
          return;
        }

        const d = profileData.data;
        const duration = Date.now() - startTime;

        function toPem(rawKey, type) {
          if (!rawKey) return '';
          let clean = rawKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
          const lines = clean.match(/.{1,64}/g) || [clean];
          return `-----BEGIN ${type} KEY-----\n${lines.join('\n')}\n-----END ${type} KEY-----`;
        }

        const publicKeyPem = toPem(d.public_key, 'PUBLIC');
        const privateKeyPem = toPem(d.private_key, 'PRIVATE');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
        res.end(JSON.stringify({
          success: true,
          duration,
          data: {
            facilityCode: d.ma_cskb || username,
            facilityName: d.ten_cskb || '',
            businessLicenseNumber: d.so_gphd || '',
            taxCode: d.ma_so_thue || '',
            phone: d.dien_thoai || '',
            email: d.email || '',
            address: d.dia_chi || '',
            province: d.ten_tinh || '',
            bhytCode: d.ma_cscb_bhyt || '',
            representative: d.ho_ten_nguoi_khai || '',
            publicKey: publicKeyPem,
            privateKey: privateKeyPem,
            publicKeyRaw: d.public_key || '',
            privateKeyRaw: d.private_key || ''
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
        res.end(JSON.stringify({ success: false, message: 'Lỗi xử lý máy chủ: ' + err.message }));
      }
    });
    return;
  }

  // 5d. API Proxy KSK: Bóc tách dữ liệu phiếu in (https://ytcs-gw.hmis.vn/api/common/phieuin/data)
  if (pathname === '/api/phieuin-data' && req.method === 'POST') {
    setCors();
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        let token = (req.headers['authorization'] || payload.token || '').trim();
        const targetUrl = payload.url || 'https://ytcs-gw.hmis.vn/api/common/phieuin/data';
        const reqMethod = (payload.method || 'POST').toUpperCase();
        
        let postBody = null;
        if (reqMethod !== 'GET' && reqMethod !== 'HEAD') {
          if (payload.data !== undefined && payload.data !== null) {
            postBody = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data);
          } else if (payload.payload) {
            postBody = typeof payload.payload === 'string' ? payload.payload : JSON.stringify(payload.payload);
          } else {
            postBody = JSON.stringify({
              maBaoCao: payload.maBaoCao || 'GIAY_RA_VIEN',
              param: payload.param || { khamBenhId: 402 }
            });
          }
        }

        const urlObj = new url.URL(targetUrl);
        const startTime = Date.now();
        const client = urlObj.protocol === 'https:' ? https : http;

        const reqHeaders = {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'vi',
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'region-code': req.headers['region-code'] || payload.regionCode || 'region2',
          'Origin': 'https://ytcs.hmis.vn',
          'Referer': 'https://ytcs.hmis.vn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity-PhieuIn/1.0'
        };
        if (postBody && reqMethod !== 'GET' && reqMethod !== 'HEAD') {
          reqHeaders['Content-Type'] = 'application/json; charset=UTF-8';
          reqHeaders['Content-Length'] = Buffer.byteLength(postBody);
        }

        const proxyReq = client.request({
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: reqMethod,
          headers: reqHeaders
        }, (proxyRes) => {
          let responseData = '';
          proxyRes.on('data', chunk => responseData += chunk);
          proxyRes.on('end', () => {
            const latency = Date.now() - startTime;
            const trimmed = (responseData || '').trim();

            // 1. Nếu Gateway trả về trực tiếp XML (ví dụ Jasper data-report: <?xml... hoặc <DATA...)
            if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.endsWith('>'))) {
              const base64Str = Buffer.from(trimmed, 'utf8').toString('base64');
              res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Response-Time-Ms': latency.toString(),
                'Access-Control-Allow-Origin': getReqOrigin(),
                'Access-Control-Allow-Credentials': 'true'
              });
              return res.end(JSON.stringify({
                code: 0,
                status: proxyRes.statusCode,
                message: 'OK',
                data: base64Str,
                decodedXml: trimmed,
                isDirectXml: true,
                latency: latency
              }));
            }

            // 2. Nếu Gateway trả về JSON (ví dụ /api/common/phieuin/data có trường data là base64)
            try {
              const json = JSON.parse(responseData);
              let decodedXml = '';
              if (json && json.data) {
                const dataStr = String(json.data).trim();
                if (dataStr.startsWith('<')) {
                  decodedXml = dataStr;
                } else {
                  try {
                    decodedXml = Buffer.from(dataStr, 'base64').toString('utf8');
                  } catch(e) {
                    decodedXml = dataStr;
                  }
                }
              }
              res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Response-Time-Ms': latency.toString(),
                'Access-Control-Allow-Origin': getReqOrigin(),
                'Access-Control-Allow-Credentials': 'true'
              });
              return res.end(JSON.stringify({
                ...json,
                code: json.code !== undefined ? json.code : 0,
                decodedXml: decodedXml || json.decodedXml || '',
                latency
              }));
            } catch (err) {
              // 3. Nếu là chuỗi text/html khác
              res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': getReqOrigin(),
                'Access-Control-Allow-Credentials': 'true'
              });
              return res.end(JSON.stringify({
                code: proxyRes.statusCode >= 200 && proxyRes.statusCode < 300 ? 0 : proxyRes.statusCode,
                message: proxyRes.statusMessage || 'Phản hồi không phải JSON hợp lệ',
                rawText: responseData,
                decodedXml: trimmed.includes('<') ? trimmed : '',
                latency
              }));
            }
          });
        });

        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
          res.end(JSON.stringify({ code: -1, message: 'Lỗi kết nối tới Gateway: ' + err.message, error: err.message }));
        });

        if (postBody && reqMethod !== 'GET' && reqMethod !== 'HEAD') {
          proxyReq.write(postBody);
        }
        proxyReq.end();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': getReqOrigin(), 'Access-Control-Allow-Credentials': 'true' });
        res.end(JSON.stringify({ code: -1, message: 'Dữ liệu JSON không hợp lệ: ' + err.message }));
      }
    });
    return;
  }

  // 5e. API Tool Trích xuất Excel: Lấy cURL mẫu
  if ((pathname === '/api/sample-curl' || pathname === '/api/excel/sample-curl') && req.method === 'GET') {
    setCors();
    const sampleCurlPath = path.join(__dirname, 'curl_input.txt');
    let sample = '';
    if (fs.existsSync(sampleCurlPath)) {
      sample = fs.readFileSync(sampleCurlPath, 'utf-8');
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ curl: sample }));
  }

  // 5f. API Tool Trích xuất Excel: Xử lý cURL và trích xuất dữ liệu Excel
  if ((pathname === '/api/convert' || pathname === '/api/excel/convert') && req.method === 'POST') {
    setCors();
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const curlCommand = payload.curl;
        if (!curlCommand || !curlCommand.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'Vui lòng nhập lệnh cURL hợp lệ.' }));
        }

        // Gọi API VNPT-HIS
        const { reqInfo, data } = await fetchFromCurl(curlCommand);

        // Chuyển đổi sang Excel với ExcelJS (đầy đủ format vàng, chữ đỏ, merge cells, tên sheet pttt)
        const { workbook, totalRecords, groups } = await convertHisJsonToWorkbook(data);

        // Tạo Buffer file Excel để cho phép tải về
        const excelBuffer = await workbook.xlsx.writeBuffer();
        lastExcelBuffer = excelBuffer;
        const nowStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        lastExcelFilename = `pttt_${nowStr}.xlsx`;

        // Ghi luôn 1 bản vào thư mục dự án
        const localSavePath = path.join(__dirname, 'DMC_DICHVU_output.xlsx');
        fs.writeFileSync(localSavePath, excelBuffer);

        // Chuẩn bị dữ liệu xem trước
        const previewRows = data.map((item, idx) => {
          const tenDv = (item.TEN_DV || item.TEN_HIEN_THI || '').trim();
          const maDmByt = (item.MABAOCAO || item.MABAOCAO_BYT || item.MA_DICHVU_KYTHUAT_DMDC || '').trim();
          const maDv = maDmByt || (item.MANOIBO ? String(item.MANOIBO).trim() : (item.MA_DV !== undefined ? String(item.MA_DV).trim() : `DV_${idx + 1}`));
          return {
            stt: idx + 1,
            maDv: maDv, // MADICHVU = MADMBYT
            tenDv: tenDv,
            tenTt37: tenDv, // TEN_TT37 luôn bằng tên dịch vụ
            loaiDv: item.LOAI_DV || 'TT',
            donVi: item.DVT_DV || 'lần',
            giaBhyt: item.GIACOBH_TT22 || item.GIABAOHIEM || item.GIA_DV || 0,
            giaDv: item.GIAKOBH_TT21 || item.GIA_DV || item.GIAKHONGBH || 0,
            maDmByt: maDmByt,
            chuyenKhoa: 2 // Luôn = 2 theo yêu cầu
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          totalRecords,
          groups,
          sheets: workbook.worksheets.map(w => w.name),
          localSavePath,
          previewRows
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: false,
          error: err.message
        }));
      }
    });
    return;
  }

  // 5g. API Tool Trích xuất Excel: Tải file Excel về máy
  if ((pathname === '/api/download' || pathname === '/api/excel/download') && (req.method === 'GET' || req.method === 'HEAD')) {
    setCors();
    if (!lastExcelBuffer) {
      const localFile = path.join(__dirname, 'DMC_DICHVU_output.xlsx');
      if (fs.existsSync(localFile)) {
        lastExcelBuffer = fs.readFileSync(localFile);
      }
    }

    if (!lastExcelBuffer) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Chưa có file nào được tạo. Vui lòng thực hiện trích xuất trước.');
    }

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${lastExcelFilename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Length': lastExcelBuffer.length
    });
    return res.end(lastExcelBuffer);
  }

  // 6. Proxy tất cả các request '/api/*' sang TARGET_API_HOST
  if (pathname.startsWith('/api/')) {
    const clientHost = req.headers['host'] || '';
    const sub = (clientHost.split('.')[0] && clientHost.split('.')[0] !== 'localhost') ? clientHost.split('.')[0] : 'main';

    let rawFrameUrl = req.headers['x-client-frame-url'] || req.headers['referer'] || '';
    let realFrameUrl = '';
    if (rawFrameUrl) {
      realFrameUrl = rawFrameUrl.replace(/https?:\/\/[a-zA-Z0-9_.-]+(:\d+)?/g, 'https://' + TARGET_HOST);
    } else {
      realFrameUrl = 'https://' + TARGET_HOST + '/';
    }

    const targetUrl = 'https://' + TARGET_API_HOST + req.url;
    const reqHeaders = { ...req.headers };
    reqHeaders['host'] = TARGET_API_HOST;
    reqHeaders['origin'] = 'https://' + TARGET_HOST;
    reqHeaders['referer'] = 'https://' + TARGET_HOST + '/';
    if (!reqHeaders['region-code']) {
      reqHeaders['region-code'] = 'region2';
    }
    delete reqHeaders['x-client-frame-url'];
    if (pathname.includes('/minio') || pathname.includes('getLink')) {
      delete reqHeaders['accept-encoding'];
    }

    const clientOrigin = getReqOrigin();
    const startTime = Date.now();
    let bodySample = '';
    const chunks = [];

    const proxyReq = https.request(targetUrl, {
      method: req.method,
      headers: reqHeaders
    }, (proxyRes) => {
      const durationMs = Date.now() - startTime;
      const respHeaders = { ...proxyRes.headers };
      delete respHeaders['x-frame-options'];
      delete respHeaders['content-security-policy'];
      respHeaders['access-control-allow-origin'] = clientOrigin;
      respHeaders['access-control-allow-credentials'] = 'true';
      respHeaders['access-control-allow-headers'] = req.headers['access-control-request-headers'] || '*';
      respHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD';
      respHeaders['vary'] = respHeaders['vary'] ? `${respHeaders['vary']}, Origin` : 'Origin';

      // Trả về Header đặc biệt để Chrome DevTools hiển thị URL thật ngay dưới Response Headers
      respHeaders['x-real-api-url'] = targetUrl;
      respHeaders['x-frame-url'] = realFrameUrl;
      respHeaders['x-tab-subdomain'] = sub;
      respHeaders['x-upstream-gateway'] = TARGET_API_HOST;

      const exposeList = ['X-Real-Api-Url', 'X-Frame-Url', 'X-Tab-Subdomain', 'X-Upstream-Gateway', 'Content-Disposition'];
      if (respHeaders['access-control-expose-headers']) {
        respHeaders['access-control-expose-headers'] += ', ' + exposeList.join(', ');
      } else {
        respHeaders['access-control-expose-headers'] = exposeList.join(', ');
      }

      if (respHeaders['set-cookie']) {
        respHeaders['set-cookie'] = respHeaders['set-cookie'].map(c => c.replace(/;\s*Secure/gi, ''));
      }

      // Xử lý viết lại link file PDF DMS từ API MinIO để đi qua /dms-proxy tránh lỗi CORS
      const isMinio = pathname.includes('/minio') || pathname.includes('getLink');
      const isJson = (respHeaders['content-type'] || '').includes('application/json');

      if (isMinio && isJson) {
        const resChunks = [];
        proxyRes.on('data', chunk => resChunks.push(chunk));
        proxyRes.on('end', () => {
          let bodyText = Buffer.concat(resChunks).toString('utf8');
          if (bodyText.includes('dms-') || bodyText.includes('vnpt.vn')) {
            const hostHeader = req.headers['host'] || ('localhost:' + PORT);
            const proto = req.connection?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
            const originBase = `${proto}://${hostHeader}`;

            bodyText = bodyText.replace(/https?(?::\\\/\\\/|:\/\/)(dms[-a-z0-9]*\.vnpt\.vn[^\",\s]+)/g, (match) => {
              const cleanUrl = match.replace(/\\\//g, '/');
              return originBase + '/dms-proxy?target=' + encodeURIComponent(cleanUrl);
            });
          }
          delete respHeaders['transfer-encoding'];
          delete respHeaders['content-length'];
          respHeaders['content-length'] = Buffer.byteLength(bodyText);
          res.writeHead(proxyRes.statusCode, respHeaders);
          res.end(bodyText);

          logApiCall({
            subdomain: sub,
            method: req.method,
            targetUrl: targetUrl,
            frameUrl: realFrameUrl,
            statusCode: proxyRes.statusCode,
            durationMs: durationMs,
            headers: req.headers,
            body: bodySample,
            contentType: proxyRes.headers['content-type'] || ''
          });
        });
        return;
      }

      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        logApiCall({
          subdomain: sub,
          method: req.method,
          targetUrl: targetUrl,
          frameUrl: realFrameUrl,
          statusCode: proxyRes.statusCode,
          durationMs: durationMs,
          headers: req.headers,
          body: bodySample,
          contentType: proxyRes.headers['content-type'] || ''
        });
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Lỗi Proxy API:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': clientOrigin, 'Access-Control-Allow-Credentials': 'true' });
      res.end(JSON.stringify({ code: 502, message: 'Bad Gateway: ' + err.message }));
    });

    if (req.method === 'GET' || req.method === 'HEAD') {
      proxyReq.end();
    } else {
      req.on('data', chunk => {
        chunks.push(chunk);
        proxyReq.write(chunk);
      });
      req.on('end', () => {
        proxyReq.end();
        try {
          const fullBuf = Buffer.concat(chunks);
          if (fullBuf.length > 0 && fullBuf.length <= 64 * 1024) {
            bodySample = fullBuf.toString('utf8');
          } else if (fullBuf.length > 64 * 1024) {
            bodySample = fullBuf.slice(0, 1024).toString('utf8') + '... [Cắt bớt do kích thước lớn]';
          }
        } catch(e) {}
      });
      req.on('error', (e) => {
        proxyReq.destroy(e);
      });
    }
    return;
  }

  // 7. Proxy tất cả các request còn lại (HTML, JS, CSS, i18n, assets) sang TARGET_HOST
  const targetUrl = 'https://' + TARGET_HOST + req.url;
  const reqHeaders = { ...req.headers };
  reqHeaders['host'] = TARGET_HOST;
  reqHeaders['origin'] = 'https://' + TARGET_HOST;
  reqHeaders['referer'] = 'https://' + TARGET_HOST + '/';

  const clientOrigin = getReqOrigin();

  const isHtmlRequest = !pathname.includes('.') || pathname.endsWith('.html');
  const isJsRequest = pathname.endsWith('.js') || pathname.includes('.js?');

  if (isHtmlRequest || isJsRequest) {
    reqHeaders['accept-encoding'] = 'identity';
    delete reqHeaders['if-none-match'];
    delete reqHeaders['if-modified-since'];
  }

  const proxyReq = https.request(targetUrl, {
    method: req.method,
    headers: reqHeaders
  }, (proxyRes) => {
    const respHeaders = { ...proxyRes.headers };
    delete respHeaders['x-frame-options'];
    delete respHeaders['content-security-policy'];
    respHeaders['access-control-allow-origin'] = clientOrigin;
    respHeaders['access-control-allow-credentials'] = 'true';
    respHeaders['access-control-allow-headers'] = req.headers['access-control-request-headers'] || '*';
    respHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD';
    respHeaders['vary'] = respHeaders['vary'] ? `${respHeaders['vary']}, Origin` : 'Origin';

    if (respHeaders['set-cookie']) {
      respHeaders['set-cookie'] = respHeaders['set-cookie'].map(c => c.replace(/;\s*Secure/gi, ''));
    }

    if (isHtmlRequest) {
      let bodyData = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { bodyData += chunk; });
      proxyRes.on('end', () => {
        bodyData = bodyData.replace(
          /var siteName = host\.split\('\.'\)\[0\] \|\| 'unknown';/g,
          "var siteName = 'ytcs';"
        );

        // Inject script đồng bộ route URL thời gian thực về window.parent (Header & Bottom Bar)
        let frameSyncContent = '';
        try {
          frameSyncContent = fs.readFileSync(path.join(PUBLIC_DIR, 'frame-sync.js'), 'utf8');
        } catch(e) {
          console.error('Cannot read frame-sync.js:', e);
        }
        const frameSyncScript = '<script id="ytcs-frame-route-sync">\n' + frameSyncContent + '\n</script>';

        // Chèn script vào ngay sau <head> và trước </body>
        if (bodyData.includes('<head>')) {
          bodyData = bodyData.replace('<head>', '<head>' + frameSyncScript);
        } else if (bodyData.includes('<body>')) {
          bodyData = bodyData.replace('<body>', '<body>' + frameSyncScript);
        } else if (bodyData.includes('</body>')) {
          bodyData = bodyData.replace('</body>', frameSyncScript + '</body>');
        } else {
          bodyData += frameSyncScript;
        }

        delete respHeaders['transfer-encoding'];
        delete respHeaders['content-length'];
        delete respHeaders['etag'];
        delete respHeaders['last-modified'];
        respHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, max-age=0';
        respHeaders['pragma'] = 'no-cache';
        respHeaders['expires'] = '0';

        res.writeHead(proxyRes.statusCode, respHeaders);
        res.end(bodyData);
      });
      return;
    }

    if (isJsRequest) {
      let bodyData = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { bodyData += chunk; });
      proxyRes.on('end', () => {
        bodyData = bodyData.replaceAll('window.location.origin.includes("localhost")?"https://his4-dev.vnpthis.vn":""', '""');
        bodyData = bodyData.replaceAll('window.location.origin.includes("localhost") ? "https://his4-dev.vnpthis.vn" : ""', '""');
        bodyData = bodyData.replaceAll('"https://his4-dev.vnpthis.vn"', '""');
        bodyData = bodyData.replaceAll('Y.includes("localhost")?"https://his4-dev.vncare.vn":Y', 'Y');
        bodyData = bodyData.replaceAll('Y.includes("localhost") ? "https://his4-dev.vncare.vn" : Y', 'Y');
        bodyData = bodyData.replaceAll('"https://his4-dev.vncare.vn"', '""');

        delete respHeaders['transfer-encoding'];
        delete respHeaders['content-length'];
        res.writeHead(proxyRes.statusCode, respHeaders);
        res.end(bodyData);
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, respHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Lỗi Proxy Web:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: ' + err.message);
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
});

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`  YTCS Multi-Account Manager đang chạy tại: http://localhost:${PORT}`);
  console.log(`  Trang quản trị: http://localhost:${PORT}`);
  console.log(`  Hỗ trợ đa Tab subdomain: http://acc1.localhost:${PORT}, http://acc2.localhost:${PORT}...`);
  console.log(`================================================================`);
});
