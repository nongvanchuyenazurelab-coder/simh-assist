const https = require('https');
const crypto = require('crypto');

let hisTnCookieJar = '';
let hisTnLoggedInUser = null;
let lastLoginTime = 0;

function realPersonHash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h) + value.charCodeAt(i);
    h = h | 0;
  }
  return h;
}

function convertStr_MysqlDate(str) {
  if (!str) return '';
  if (typeof str === 'string' && str.length === 10 && str.includes('/')) {
    const arr = str.split('/');
    return arr[2] + '-' + arr[1] + '-' + arr[0];
  }
  return str;
}

function convertArray(arr) {
  if (!arr || arr.length === 0) return '';
  let str = (arr[0] !== undefined && arr[0] !== null ? arr[0].toString() : '').replace(/```/g, '').replace(/&/g, '+');
  for (let i = 1; i < arr.length; i++) {
    const item = (arr[i] !== undefined && arr[i] !== null ? arr[i].toString() : '');
    str += '```' + item.replace(/```/g, '').replace(/&/g, '+');
  }
  return encodeURIComponent(str);
}

function requestHisHttp(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      const setCookies = res.headers['set-cookie'] || [];
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        setCookies,
        body: data
      }));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Hết thời gian chờ kết nối tới VNPT HIS Thái Nguyên (25s)')));
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Đăng nhập tự động vào hệ thống VNPT HIS Thái Nguyên
 * Sử dụng thuật toán sinh hash của jQuery Real Person để vượt qua kiểm tra mã xác nhận 100% tự động
 */
async function loginHisThaiNguyen(username = 'ADMIN_IT', password = 'Hmis@@2026') {
  // 1. Lấy Cookie phiên khởi tạo từ trang đăng nhập
  const initRes = await requestHisHttp({
    hostname: 'yte-thainguyen.vnpthis.vn',
    port: 443,
    path: '/web_his/dangnhap',
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });

  let cookies = initRes.setCookies.map(c => c.split(';')[0]).join('; ');

  // 2. Tính toán hash RealPerson và gửi POST login_v2
  const code = 'FAST' + Math.floor(Math.random() * 1000);
  const postBody = new URLSearchParams({
    tendn: username,
    matkhau: crypto.createHash('md5').update(password).digest('hex'),
    defaultRealHash: realPersonHash(code).toString(),
    defaultReal: code
  }).toString();

  const loginRes = await requestHisHttp({
    hostname: 'yte-thainguyen.vnpthis.vn',
    port: 443,
    path: '/web_his/login_v2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(postBody),
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://yte-thainguyen.vnpthis.vn/web_his/dangnhap'
    }
  }, postBody);

  const resBody = (loginRes.body || '').trim();
  if (resBody !== 'SUCCESS') {
    throw new Error('Đăng nhập VNPT HIS không thành công (Phản hồi: ' + resBody + ')');
  }

  if (loginRes.setCookies.length) {
    cookies += '; ' + loginRes.setCookies.map(c => c.split(';')[0]).join('; ');
  }

  hisTnCookieJar = cookies;
  hisTnLoggedInUser = username;
  lastLoginTime = Date.now();

  return {
    ok: true,
    user: username,
    message: 'Đăng nhập thành công tài khoản ' + username
  };
}

/**
 * Đảm bảo đã có phiên đăng nhập hợp lệ
 */
async function ensureSession() {
  // Nếu chưa có cookie hoặc đã quá 30 phút, làm mới đăng nhập
  if (!hisTnCookieJar || (Date.now() - lastLoginTime > 30 * 60 * 1000)) {
    await loginHisThaiNguyen();
  }
}

/**
 * Thiết lập / Chuyển đơn vị làm việc trên HIS Thái Nguyên
 */
async function switchUnit(madonvi) {
  await ensureSession();
  const res = await requestHisHttp({
    hostname: 'yte-thainguyen.vnpthis.vn',
    port: 443,
    path: `/web_his/thaydoidonvi?madonvi=${encodeURIComponent(madonvi)}`,
    method: 'GET',
    headers: {
      'Cookie': hisTnCookieJar,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://yte-thainguyen.vnpthis.vn/web_his/thietlapdonvi'
    }
  });

  const resText = (res.body || '').trim();
  if (resText !== 'SUCCESS') {
    // Nếu bị điều hướng về dangnhap (hết session), login lại và retry
    if (resText.includes('dangnhap') || res.statusCode === 302 || res.statusCode === 401) {
      await loginHisThaiNguyen();
      return switchUnit(madonvi);
    }
    throw new Error(`Thiết lập đơn vị ${madonvi} không thành công (HTTP ${res.statusCode}: ${resText})`);
  }
  return true;
}

/**
 * Lấy toàn bộ danh sách nhân viên của đơn vị
 */
async function getEmployees(madonvi) {
  await ensureSession();
  const listPath = `/web_his/danhsachnhanvien?dvtt=${encodeURIComponent(madonvi)}&loadOnlyEnabledUser=0&khoa=-1&filterscount=0&groupscount=0&pagenum=0&pagesize=500&recordstartindex=0&recordendindex=500&featureClass=P&style=full&maxRows=500&username=jqwidgets&_=${Date.now()}`;
  
  const res = await requestHisHttp({
    hostname: 'yte-thainguyen.vnpthis.vn',
    port: 443,
    path: listPath,
    method: 'GET',
    headers: {
      'Cookie': hisTnCookieJar,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://yte-thainguyen.vnpthis.vn/web_his/nhanvien'
    }
  });

  if (res.statusCode !== 200) {
    if (res.body.includes('dangnhap') || res.statusCode === 302 || res.statusCode === 401) {
      await loginHisThaiNguyen();
      return getEmployees(madonvi);
    }
    throw new Error(`Lỗi tải danh sách nhân viên đơn vị ${madonvi} (HTTP ${res.statusCode})`);
  }

  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error('Dữ liệu nhân viên trả về không đúng định dạng JSON: ' + err.message);
  }
}

/**
 * Cập nhật và bật Enabled = 1 cho một nhân viên
 */
async function updateEnableOfficer(officer) {
  await ensureSession();
  const ngaysinhFormatted = convertStr_MysqlDate(officer.NGAY_SINH);
  
  const str = [
    officer.MA_NHANVIEN,
    officer.MA_PHONGBAN,
    officer.TEN_NHANVIEN,
    ngaysinhFormatted,
    officer.GIOITINH_NHANVIEN !== undefined && officer.GIOITINH_NHANVIEN !== null ? officer.GIOITINH_NHANVIEN : 1,
    officer.CHUCDANH_NHANVIEN || '',
    officer.CHUCVU_NHANVIEN || '',
    officer.DIACHI_NHANVIEN || '',
    officer.TRINHDO_NHANVIEN || '',
    officer.SOCMT_NHANVIEN || '',
    officer.SODIENTHOAI_NHANVIEN || '',
    officer.CHUNGCHI_HANHNGHE || '',
    officer.EMAIL || '',
    "0"
  ];

  const updateBody = new URLSearchParams({
    url: convertArray(str),
    chuky: '',
    enabled: 1,
    chungthuso: officer.SERI_CHUNGTHUSO || '',
    ma_so_bhxh: officer.MA_SO_BHXH || ''
  }).toString();

  const updateRes = await requestHisHttp({
    hostname: 'yte-thainguyen.vnpthis.vn',
    port: 443,
    path: '/web_his/suanhanvien',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(updateBody),
      'Cookie': hisTnCookieJar,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://yte-thainguyen.vnpthis.vn/web_his/nhanvien'
    }
  }, updateBody);

  const resBody = (updateRes.body || '').trim();
  if (resBody === '1') {
    return { ok: true, message: 'Cập nhật thành công!' };
  } else if (resBody === '-1') {
    return { ok: false, message: 'Đã tồn tại nhân viên với số CMT: ' + (officer.SOCMT_NHANVIEN || '') };
  } else {
    return { ok: false, message: 'Cập nhật không thành công (Phản hồi: ' + resBody + ')' };
  }
}

/**
 * Xử lý danh sách user cần kích hoạt theo đơn vị
 * @param {Array<{madonvi: string, username: string}>} items 
 */
async function processEnableUsers(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Danh sách yêu cầu rỗng');
  }

  await ensureSession();

  // Nhóm theo mã đơn vị để tối ưu số lần chuyển đơn vị
  const byUnit = new Map();
  for (const item of items) {
    const unit = String(item.madonvi || '').trim();
    const user = String(item.username || '').trim();
    if (!unit || !user) continue;

    if (!byUnit.has(unit)) {
      byUnit.set(unit, []);
    }
    byUnit.get(unit).push(user);
  }

  const results = [];

  for (const [unit, userList] of byUnit.entries()) {
    try {
      // 1. Chuyển đơn vị
      await switchUnit(unit);

      // 2. Lấy danh sách nhân viên của đơn vị
      const employees = await getEmployees(unit);

      for (const username of userList) {
        const uLower = username.toLowerCase();
        // Tìm nhân viên theo SOCMT_NHANVIEN, MA_NHANVIEN hoặc TEN_NHANVIEN
        const matched = employees.find(e => 
          (e.SOCMT_NHANVIEN && e.SOCMT_NHANVIEN.toLowerCase() === uLower) ||
          (e.MA_NHANVIEN && String(e.MA_NHANVIEN).toLowerCase() === uLower) ||
          (e.TEN_NHANVIEN && e.TEN_NHANVIEN.toLowerCase() === uLower)
        );

        if (!matched) {
          results.push({
            madonvi: unit,
            username: username,
            status: 'NOT_FOUND',
            ok: false,
            message: `Không tìm thấy tài khoản "${username}" trong đơn vị ${unit}`
          });
          continue;
        }

        const wasEnabled = (matched.ENABLED === 1 || matched.ENABLED === '1' || matched.ENABLED === true);
        
        // Cập nhật bật Enabled = 1
        const upd = await updateEnableOfficer(matched);

        if (upd.ok) {
          results.push({
            madonvi: unit,
            username: username,
            fullName: matched.TEN_NHANVIEN,
            officerId: matched.MA_NHANVIEN,
            chucDanh: matched.TEN_CHUCDANH,
            chucVu: matched.TEN_CHUCVU,
            wasAlreadyEnabled: wasEnabled,
            status: wasEnabled ? 'ALREADY_ENABLED' : 'SUCCESS',
            ok: true,
            message: wasEnabled 
              ? `Tài khoản đã ở trạng thái kích hoạt sẵn (ENABLED=1)`
              : `Đã bật Enable thành công cho nhân viên: ${matched.TEN_NHANVIEN}`
          });
        } else {
          results.push({
            madonvi: unit,
            username: username,
            fullName: matched.TEN_NHANVIEN,
            officerId: matched.MA_NHANVIEN,
            status: 'ERROR',
            ok: false,
            message: upd.message
          });
        }
      }
    } catch (err) {
      for (const username of userList) {
        results.push({
          madonvi: unit,
          username: username,
          status: 'ERROR',
          ok: false,
          message: `Lỗi xử lý đơn vị ${unit}: ` + err.message
        });
      }
    }
  }

  return {
    ok: true,
    total: results.length,
    successCount: results.filter(r => r.ok).length,
    results
  };
}

module.exports = {
  loginHisThaiNguyen,
  switchUnit,
  getEmployees,
  updateEnableOfficer,
  processEnableUsers,
  getStatus: () => ({
    loggedIn: !!hisTnCookieJar,
    user: hisTnLoggedInUser,
    lastLoginTime
  })
};
