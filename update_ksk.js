/**
 * Script CLI: Đăng nhập, Lấy và Cập nhật cấu hình LIEN_THONG_KSK & DON_THUOC_DIEN_TU qua dòng lệnh
 * Sử dụng:
 *   node update_ksk.js login --username 06152.adminbv --password "pass" [--region region2]
 *   node update_ksk.js get [--token <token>]
 *   node update_ksk.js update --username <user> --password <pass> --senderId <id> --publicKey <key> --privateKey <key>
 *   node update_ksk.js test-login [--username <user>] [--password <pass>] [--url <url>]
 *   node update_ksk.js get-dtdt [--token <token>]
 *   node update_ksk.js update-dtdt --maLienThong <user> --passLienThong <pass> --maCskcbLienThong <ma> --maCskcb <ma>
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TOKEN_FILE = path.join(__dirname, '.token');

function getSavedToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  return "Bearer eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIwNjE1Mi5BRE1JTkJWIiwianRpIjoiMiIsImlhdCI6MTc5MjcxNjQ4NSwidHlwZSI6IkFDQ0VTU19UT0tFTiIsIlRFTkFOVC1DT0RFIjoiSElTX0RBVEFfMDYxNTIiLCJTQ0hFTUEtT0RTIjoiSElTX09EU18wNjE1MiIsIlNDSEVNQS1EV0giOiJISVNfRFdfMDYxNTIiLCJSRUdJT04tQ09ERSI6InJlZ2lvbjIiLCJET05WSV9JRCI6NjY5LCJNQV9DU1lUIjoiMDYxNTIiLCJJRF9DU1lUIjoiMSIsIkhPU1BJVEFMX0NPREUiOiIwNjE1MiIsIklTX1JPT1QiOjAsIlNFU1NJT05fSUQiOiIwNjE1Mi5BRE1JTkJWX2JkYTMxMTJmZTJkYzRkMjhiZTdmNWY1YzBkYjU2OWU4XzIwMjYxMDIzMDc0ODA1IiwiTUFfWEEiOiIwMjE0MyIsIk1BX1RJTkgiOiI2IiwiaXNzIjoiaHR0cDovL0hJU0hOLlZOIiwiZXhwIjoxNzkyNzQ1Mjg1fQ.fdVCRXCnJ3kODTcOTRN3z9cWUsQW_7RedXWFjwbUU3UUzRBsMpPnbz38L5rgOH-h6L9kDPczYvGA9E1ag8DwUA";
}

function requestAPI(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function login(username, password, region = 'region2') {
  console.log(`[Login] Đang đăng nhập tài khoản: ${username} (Region: ${region})...`);
  const postData = JSON.stringify({ username, password });
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/authen/public/login',
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Content-Type': 'application/json; charset=UTF-8',
      'REGION-CODE': region,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, postData);
  if (res.data && (res.data.code === 200 || res.data.code === 0) && res.data.data && res.data.data.accessToken) {
    const bearer = `Bearer ${res.data.data.accessToken}`;
    fs.writeFileSync(TOKEN_FILE, bearer, 'utf8');
    console.log(`[Success] Đăng nhập thành công! Token đã lưu vào: ${TOKEN_FILE}`);
    console.log(`Thời gian sống token (expiredTime): ${res.data.data.expiredTime}s`);
    return bearer;
  }
  throw new Error('Đăng nhập thất bại: ' + JSON.stringify(res.data || res.raw));
}

// ============================================
// LIEN_THONG_KSK APIs
// ============================================
async function getConfig(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/htcauhinh/search?filter=maCauHinh==%22*LIEN_THONG_KS*%22;nhomChId==1&page=0&size=50&sort=id&sort=desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content && res.data.data.content.length > 0) {
    return res.data.data.content[0];
  }
  throw new Error('Không tìm thấy cấu hình LIEN_THONG_KSK: ' + JSON.stringify(res));
}

async function updateConfig(updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log('[1/2] Lấy cấu hình KSK hiện tại từ máy chủ...');
  const current = await getConfig(authToken);
  const configId = current.id || 2332;

  let thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;

  if (updates.username !== undefined) thietLap.kskUsername.giatri = updates.username;
  if (updates.password !== undefined) thietLap.kskPassword.giatri = updates.password;
  if (updates.senderId !== undefined) thietLap.kskSenderId.giatri = updates.senderId;
  if (updates.publicKey !== undefined) thietLap.kskPublicKey.giatri = updates.publicKey;
  if (updates.privateKey !== undefined) thietLap.kskPrivateKey.giatri = updates.privateKey;

  const payload = {
    nhomChId: current.nhomChId || 1,
    maCauHinh: current.maCauHinh || "LIEN_THONG_KSK",
    tenCauHinh: current.tenCauHinh || "LIEN_THONG_KSK",
    trangThai: current.trangThai || 1,
    giaTriThietLap: JSON.stringify(thietLap),
    giaTriMacDinh: current.giaTriMacDinh || JSON.stringify(thietLap),
    id: configId
  };

  console.log('[2/2] Đang gửi yêu cầu PUT cập nhật KSK ID ' + configId + '...');
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/htcauhinh/update?id=${configId}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log('Kết quả cập nhật KSK:', JSON.stringify(res, null, 2));
  return res;
}

// ============================================
// DON_THUOC_DIEN_TU APIs
// ============================================
async function getDtdtConfig(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/htcauhinh/search?filter=maCauHinh==%22*DON_THUOC_DIEN_TU*%22;nhomChId==1&page=0&size=50&sort=id&sort=desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content && res.data.data.content.length > 0) {
    return res.data.data.content[0];
  }
  throw new Error('Không tìm thấy cấu hình DON_THUOC_DIEN_TU: ' + JSON.stringify(res));
}

async function updateDtdtConfig(updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log('[1/2] Lấy cấu hình ĐTĐT hiện tại từ máy chủ...');
  const current = await getDtdtConfig(authToken);
  const configId = current.id || 59;

  let thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;

  if (updates.maLienThong !== undefined) thietLap.dtDtMaLienThong.giatri = updates.maLienThong;
  if (updates.passLienThong !== undefined) thietLap.dtDtPassLienThong.giatri = updates.passLienThong;
  if (updates.maCskcbLienThong !== undefined) thietLap.maCoSoKcbLienThong.giatri = updates.maCskcbLienThong;
  if (updates.maCskcb !== undefined) thietLap.maCoSoKCB.giatri = updates.maCskcb;

  if (updates.dungTkChung !== undefined) thietLap.dungTkChung.giatri = updates.dungTkChung;
  if (updates.usernameBsiDungChung !== undefined) thietLap.usernameBsiDungChung.giatri = updates.usernameBsiDungChung;
  if (updates.passwordBsiDungChung !== undefined) thietLap.passwordBsiDungChung.giatri = updates.passwordBsiDungChung;
  if (updates.urlGuiDonThuoc !== undefined || updates.url !== undefined) {
    const urlVal = updates.urlGuiDonThuoc !== undefined ? updates.urlGuiDonThuoc : updates.url;
    if (!thietLap.urlGuiDonThuoc) thietLap.urlGuiDonThuoc = { mota: "url gửi đơn thuốc" };
    thietLap.urlGuiDonThuoc.giatri = String(urlVal);
  }

  const payload = {
    nhomChId: current.nhomChId || 1,
    maCauHinh: current.maCauHinh || "DON_THUOC_DIEN_TU",
    tenCauHinh: current.tenCauHinh || "Cấu hình đơn thuốc điện tử",
    trangThai: current.trangThai || 1,
    giaTriThietLap: JSON.stringify(thietLap),
    giaTriMacDinh: current.giaTriMacDinh || JSON.stringify(thietLap),
    id: configId
  };

  console.log('[2/2] Đang gửi yêu cầu PUT cập nhật ĐTĐT ID ' + configId + '...');
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/htcauhinh/update?id=${configId}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log('Kết quả cập nhật ĐTĐT:', JSON.stringify(res, null, 2));
  return res;
}

// ============================================
// KB_CHIDINHTVT APIs (Chỉ định thuốc vật tư)
// ============================================
async function getKbChiDinhConfig(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/htcauhinh/search?filter=maCauHinh==%22KB_CHIDINHTVT%22;nhomChId==1&page=0&size=50&sort=id&sort=desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content && res.data.data.content.length > 0) {
    const found = res.data.data.content.find(i => i.maCauHinh === 'KB_CHIDINHTVT') || res.data.data.content[0];
    return found;
  }
  throw new Error('Không tìm thấy cấu hình KB_CHIDINHTVT: ' + JSON.stringify(res));
}

async function updateKbChiDinhConfig(updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log('[1/2] Lấy cấu hình KB_CHIDINHTVT hiện tại từ máy chủ...');
  const current = await getKbChiDinhConfig(authToken);
  const configId = current.id || 154;

  let thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;

  if (updates.dtdtDayCongDTQG !== undefined) {
    if (!thietLap.dtdtDayCongDTQG) thietLap.dtdtDayCongDTQG = { mota: "0:Không sử dụng;\n            1: Đẩy cổng khi lưu đơn thuốc;\n            2: Sử dụng nút đẩy cổng đơn thuốc riêng" };
    thietLap.dtdtDayCongDTQG.giatri = String(updates.dtdtDayCongDTQG);
  }
  if (updates.dtdtDay !== undefined) {
    if (!thietLap.dtdtDay) thietLap.dtdtDay = { mota: "Cấu hình đẩy đơn thuốc điện tử\n+ 0: Nếu như không đẩy + 1: Đẩy cổng khi lưu đơn + 2: Đẩy cổng có ký số" };
    thietLap.dtdtDay.giatri = String(updates.dtdtDay);
  }

  const payload = {
    nhomChId: current.nhomChId || 1,
    maCauHinh: current.maCauHinh || "KB_CHIDINHTVT",
    tenCauHinh: current.tenCauHinh || "Chỉ định thuốc vật tư",
    trangThai: current.trangThai || 1,
    giaTriThietLap: JSON.stringify(thietLap),
    giaTriMacDinh: current.giaTriMacDinh || JSON.stringify(thietLap),
    id: configId
  };

  console.log('[2/2] Đang gửi yêu cầu PUT cập nhật KB_CHIDINHTVT ID ' + configId + '...');
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/htcauhinh/update?id=${configId}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log('Kết quả cập nhật KB_CHIDINHTVT:', JSON.stringify(res, null, 2));
  return res;
}

// ============================================
// VPI_BAOHIEM APIs (Viện phí bảo hiểm)
// ============================================
async function getVpiConfig(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/htcauhinh/search?filter=maCauHinh==%22*VPI_BAOHIEM*%22;nhomChId==1&page=0&size=50&sort=id&sort=desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content && res.data.data.content.length > 0) {
    const found = res.data.data.content.find(i => i.maCauHinh === 'VPI_BAOHIEM') || res.data.data.content[0];
    return found;
  }
  throw new Error('Không tìm thấy cấu hình VPI_BAOHIEM: ' + JSON.stringify(res));
}

async function updateVpiConfig(updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log('[1/2] Lấy cấu hình VPI_BAOHIEM hiện tại từ máy chủ...');
  const current = await getVpiConfig(authToken);
  const configId = current.id || 57;

  let thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;

  if (updates.tenKeToanBangKe !== undefined) {
    if (!thietLap.tenKeToanBangKe) thietLap.tenKeToanBangKe = { mota: "Hiển thị tên Kế toán viện phí trên bảng kê\n\n 1 - Người duyệt kế toán\n 2 - Theo cấu hình tenKeToanVienPhi\n Mặc định - Không hiển thị" };
    thietLap.tenKeToanBangKe.giatri = String(updates.tenKeToanBangKe);
  }
  if (updates.tenKeToanVienPhi !== undefined) {
    if (!thietLap.tenKeToanVienPhi) thietLap.tenKeToanVienPhi = { mota: "Giá trị tên kế toán viện phí khi cấu hình tenKeToanBangKe = 2. Nhập \".\" để lấy theo user đang đăng nhập" };
    thietLap.tenKeToanVienPhi.giatri = String(updates.tenKeToanVienPhi);
  }
  if (updates.chucDanhKeToanVienPhi !== undefined) {
    if (!thietLap.chucDanhKeToanVienPhi) thietLap.chucDanhKeToanVienPhi = { mota: "Chức danh thay thế \"KẾ TOÁN VIỆN PHÍ\" trên bảng kê 697 (khối chữ ký phải)\n\n 0/rỗng/không cấu hình: giữ mặc định \"KẾ TOÁN VIỆN PHÍ\"; có giá trị: hiển thị nguyên văn (vd \"Giám Đốc\")" };
    thietLap.chucDanhKeToanVienPhi.giatri = String(updates.chucDanhKeToanVienPhi);
  }
  if (updates.nguoiLapBangKe !== undefined) {
    if (!thietLap.nguoiLapBangKe) thietLap.nguoiLapBangKe = { mota: "Hiển thị tên người lập bảng kê:\n\n 1 - Theo cấu hình VPI_BAOHIEM / tenNguoiLapBangKe\n 2 - Lấy tên bác sĩ điều trị\n 3 - Lấy tên bác sĩ xử trí / kết thúc khám\n Mặc định - Để trống" };
    thietLap.nguoiLapBangKe.giatri = String(updates.nguoiLapBangKe);
  }
  if (updates.tenNguoiLapBangKe !== undefined) {
    if (!thietLap.tenNguoiLapBangKe) thietLap.tenNguoiLapBangKe = { mota: "Giá trị tên người lập bảng kê khi cấu hình nguoiLapBangKe = 1. Nhập \".\" để lấy theo user đang đăng nhập" };
    thietLap.tenNguoiLapBangKe.giatri = String(updates.tenNguoiLapBangKe);
  }

  const payload = {
    nhomChId: current.nhomChId || 1,
    maCauHinh: current.maCauHinh || "VPI_BAOHIEM",
    tenCauHinh: current.tenCauHinh || "Viện phí bảo hiểm",
    trangThai: current.trangThai || 1,
    giaTriThietLap: JSON.stringify(thietLap),
    giaTriMacDinh: current.giaTriMacDinh || JSON.stringify(thietLap),
    id: configId
  };

  console.log('[2/2] Đang gửi yêu cầu PUT cập nhật VPI_BAOHIEM ID ' + configId + '...');
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/htcauhinh/update?id=${configId}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log('Kết quả cập nhật VPI_BAOHIEM:', JSON.stringify(res, null, 2));
  return res;
}

/**
 * Lấy cấu hình Sổ theo dõi sức khỏe mẹ & bé (EMCH)
 */
async function getEmchConfig(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/htcauhinh/search?filter=maCauHinh==%22*emch*%22;nhomChId==1&page=0&size=50&sort=id&sort=desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content && res.data.data.content.length > 0) {
    const found = res.data.data.content.find(i => i.maCauHinh === 'EMCH') || res.data.data.content[0];
    return found;
  }
  throw new Error('Không tìm thấy cấu hình EMCH: ' + JSON.stringify(res));
}

/**
 * Cập nhật cấu hình EMCH (ID: 14)
 */
async function updateEmchConfig(updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log('[1/2] Lấy cấu hình EMCH hiện tại từ máy chủ...');
  const current = await getEmchConfig(authToken);
  const configId = current.id || 14;

  let thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : (current.giaTriThietLap || {});

  const username = updates.username !== undefined ? updates.username : (thietLap.eMCHUsername?.giatri || '');
  const password = updates.password !== undefined ? updates.password : (thietLap.eMCHPassword?.giatri || '');
  const baseUrl = updates.baseUrl !== undefined ? updates.baseUrl : (thietLap.eMCHBaseUrl?.giatri || 'https://skss.tkyt.vn/api/lien-thong/');
  const tenTTDV = updates.tenTTDV !== undefined ? updates.tenTTDV : (thietLap.eMCHTenTTDV?.giatri || '0');

  // 1. Cập nhật các trường bên ngoài
  if (!thietLap.eMCHUsername) thietLap.eMCHUsername = { loaiGiaTri: "string", regexString: "" };
  thietLap.eMCHUsername.giatri = String(username);

  if (!thietLap.eMCHPassword) thietLap.eMCHPassword = { loaiGiaTri: "string", regexString: "" };
  thietLap.eMCHPassword.giatri = String(password);

  if (!thietLap.eMCHBaseUrl) thietLap.eMCHBaseUrl = {};
  thietLap.eMCHBaseUrl.giatri = String(baseUrl);

  if (!thietLap.eMCHTenTTDV) thietLap.eMCHTenTTDV = { mota: "Họ và tên thủ trưởng đơn vị" };
  thietLap.eMCHTenTTDV.giatri = String(tenTTDV);

  // 2. Cập nhật chuỗi JSON lồng nhau EMCH_CONFIG
  let innerConfig = {};
  if (thietLap.EMCH_CONFIG && thietLap.EMCH_CONFIG.giatri) {
    try {
      innerConfig = typeof thietLap.EMCH_CONFIG.giatri === 'string' ? JSON.parse(thietLap.EMCH_CONFIG.giatri) : thietLap.EMCH_CONFIG.giatri;
    } catch (e) {
      innerConfig = {};
    }
  }

  if (!innerConfig.eMCHBaseUrl) innerConfig.eMCHBaseUrl = {};
  innerConfig.eMCHBaseUrl.giatri = String(baseUrl);

  if (!innerConfig.eMCHUsername) innerConfig.eMCHUsername = {};
  innerConfig.eMCHUsername.giatri = String(username);

  if (!innerConfig.eMCHPassword) innerConfig.eMCHPassword = {};
  innerConfig.eMCHPassword.giatri = String(password);

  if (!thietLap.EMCH_CONFIG) {
    thietLap.EMCH_CONFIG = {
      mota: "Cấu hình kết nối EMCH",
      loaiGiaTri: "string",
      regexString: ""
    };
  }
  thietLap.EMCH_CONFIG.giatri = JSON.stringify(innerConfig);

  const payload = {
    nhomChId: current.nhomChId || 1,
    maCauHinh: current.maCauHinh || "EMCH",
    tenCauHinh: current.tenCauHinh || "EMCH",
    trangThai: current.trangThai || 1,
    giaTriThietLap: JSON.stringify(thietLap),
    giaTriMacDinh: current.giaTriMacDinh || JSON.stringify(thietLap),
    id: configId
  };

  console.log('[2/2] Đang gửi yêu cầu PUT cập nhật EMCH ID ' + configId + '...');
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/htcauhinh/update?id=${configId}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log('Kết quả cập nhật EMCH:', JSON.stringify(res, null, 2));
  return res;
}

/**
 * Lấy danh sách mẫu in bảng kê chi phí KCB (dmcbaocao)
 */
async function getBangKeList(token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/dmcbaocao/search?filter=id%3E0;maBaoCao==%22*bang_ke*%22&page=0&size=50&sort=id,desc',
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options);
  if (res.data && res.data.data && res.data.data.content) {
    return res.data.data.content;
  }
  throw new Error('Không lấy được danh sách mẫu bảng kê: ' + JSON.stringify(res));
}

/**
 * Cập nhật một mẫu báo cáo bảng kê theo ID
 */
async function updateBangKeReport(id, updates = {}, token = null) {
  const authToken = token || getSavedToken();
  console.log(`[1/2] Lấy thông tin mẫu bảng kê ID ${id}...`);
  const list = await getBangKeList(authToken);
  const orig = list.find(x => x.id === Number(id));
  if (!orig) {
    throw new Error(`Không tìm thấy mẫu báo cáo có ID ${id}`);
  }

  const newTempCode = updates.templateCode || updates.tempCode || orig.tempCode || orig.templateCode || '';
  const newGhiChu = updates.ghiChu !== undefined ? updates.ghiChu : (orig.ghiChu || '');
  const newTrangThai = updates.trangThai !== undefined ? Number(updates.trangThai) : orig.trangThai;

  const payload = {
    id: orig.id,
    ten: orig.ten,
    templateCode: newTempCode,
    formId: orig.formId !== undefined ? orig.formId : -1,
    nhomBaoCao: orig.nhomBaoCao || 1,
    soNgayXem: orig.soNgayXem || orig.soNgayXemBc || 366,
    ghiChu: newGhiChu,
    trangThai: newTrangThai,
    service: orig.service || "BangKe",
    renderType: orig.renderType !== undefined && orig.renderType !== null ? orig.renderType : 0,
    tempCode: newTempCode,
    soNgayXemBc: orig.soNgayXemBc || 366,
    nhomBcCha: orig.nhomBcCha || 1,
    ngaySua: new Date().toISOString(),
    nguoiTao: orig.nguoiTao || 1,
    nguoiSua: 2
  };

  if (orig.maBaoCao) payload.maBaoCao = orig.maBaoCao;
  if (orig.phienBan) payload.phienBan = orig.phienBan;

  console.log(`[2/2] Đang gửi yêu cầu PUT cập nhật ID ${id} (${orig.maBaoCao}) -> ${newTempCode}...`);
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: `/api/common/dmcbaocao/update?id=${id}`,
    method: 'PUT',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const res = await requestAPI(options, payload);
  console.log(`Kết quả cập nhật ID ${id}:`, JSON.stringify(res, null, 2));
  return res;
}

/**
 * Tự động áp dụng và lưu 4 mẫu bảng kê chuẩn theo gợi ý của người dùng
 */
async function applySuggestedBangKe(token = null) {
  const authToken = token || getSavedToken();
  const suggestions = {
    'BANG_KE_BHYT': 'RPT000056_BANG_KE_CV697_F9_SIGNMARK_CHUCDANH',
    'BANG_KE_DICHVU': 'RPT000056_BANG_KE_CV697_F9_KBH_SIGNMARK_CHUCDANH',
    'BANG_KE_HAOPHI': 'RPT000056_BANG_KE_CV697_F9_HAOPHI_SIGNMARK_CHUCDANH',
    'BANG_KE': 'RPT000056_BANG_KE_CV697_F9_SIGNMARK_CHUCDANH'
  };

  console.log('=== ĐANG LẤY DANH SÁCH MẪU BẢNG KÊ ĐỂ ÁP DỤNG GỢI Ý ===');
  const list = await getBangKeList(authToken);

  for (const code of Object.keys(suggestions)) {
    const suggested = suggestions[code];
    const matching = list.filter(i => i.maBaoCao === code);
    // Prioritize active item
    const target = matching.find(i => i.trangThai === 1) || matching[0];

    if (target) {
      console.log(`\n=> Cập nhật [${code}] (ID: ${target.id}):`);
      console.log(`   Mẫu cũ:  ${target.tempCode || target.templateCode}`);
      console.log(`   Mẫu mới: ${suggested}`);
      await updateBangKeReport(target.id, { templateCode: suggested }, authToken);
    } else {
      console.log(`\n(Không tìm thấy bản ghi cho mã ${code})`);
    }
  }
  console.log('\n=== HOÀN TẤT ÁP DỤNG MẪU BẢNG KÊ CHUẨN ===');
}

/**
 * Bóc tách dữ liệu phiếu in qua API /api/common/phieuin/data
 */
async function extractPhieuInData(paramObj, token = null) {
  const authToken = token || getSavedToken();
  const options = {
    hostname: 'ytcs-gw.hmis.vn',
    path: '/api/common/phieuin/data',
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'vi',
      'Authorization': authToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'Origin': 'https://ytcs.hmis.vn',
      'Referer': 'https://ytcs.hmis.vn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  console.log('=== GỬI YÊU CẦU BÓC DỮ LIỆU PHIẾU IN (/api/common/phieuin/data) ===');
  console.log('Payload:', JSON.stringify(paramObj, null, 2));

  const res = await requestAPI(options, paramObj);

  if (res.data && res.data.code === 0 && res.data.data) {
    const rawB64 = res.data.data;
    const decodedXml = Buffer.from(rawB64, 'base64').toString('utf8');
    console.log(`\n=> BÓC DỮ LIỆU THÀNH CÔNG!`);
    console.log(`- Độ dài Base64: ${rawB64.length} bytes`);
    console.log(`- Độ dài XML giải mã: ${decodedXml.length} ký tự\n`);
    console.log('--- NỘI DUNG XML ĐÃ GIẢI MÃ BASE64 ---');
    console.log(decodedXml);

    // Extract quick tags
    const fields = [];
    const regex = /<([a-zA-Z0-9_\-]+)(?:\s+[^>]*)?>([^<]*)<\/\1>|<([a-zA-Z0-9_\-]+)\s*\/>/g;
    let match;
    while ((match = regex.exec(decodedXml)) !== null) {
      if (match[1]) fields.push({ key: match[1], value: match[2].trim() });
      else if (match[3]) fields.push({ key: match[3], value: '' });
    }

    if (fields.length > 0) {
      console.log(`\n--- BẢNG TRÍCH XUẤT ${fields.length} TRƯỜNG DỮ LIỆU ---`);
      fields.forEach((f, idx) => {
        console.log(`  [${idx + 1}] ${f.key.padEnd(20)} : ${f.value || '(trống)'}`);
      });
    }

    return { raw: res.data, b64: rawB64, xml: decodedXml, fields };
  } else {
    console.error('Lỗi hoặc không nhận được dữ liệu:', JSON.stringify(res, null, 2));
    return res;
  }
}

/**
 * Kiểm tra kết nối API login KSK (https://api.emrhub.vn/api/auth/login)
 */
async function testKskLogin(username, password, customUrl = 'https://api.emrhub.vn/api/auth/login') {
  console.log(`[Test KSK Login] Đang kiểm tra đăng nhập tới: ${customUrl}`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password ? '********' : '(trống)'}`);

  const postData = JSON.stringify({ username, password });
  const urlObj = new URL(customUrl);

  const startTime = Date.now();
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  const client = urlObj.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - startTime;
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, latency, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, latency, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Lấy Public Key & Private Key từ cổng admin.emrhub.vn
 */
async function fetchEmrhubKeys(username, password, shouldSave = false) {
  console.log(`[EMRHub] [1/2] Đang đăng nhập admin.emrhub.vn với tài khoản: ${username}...`);
  const loginRes = await fetch('https://admin.emrhub.vn/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Language': 'vi',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://admin.emrhub.vn/auth/login',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    body: JSON.stringify({ username, password })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.header?.success) {
    throw new Error(loginData.header?.res_msg || loginData.message || 'Đăng nhập admin.emrhub.vn thất bại');
  }

  const setCookie = loginRes.headers.get('set-cookie');
  let webToken = '';
  if (setCookie) {
    const m = setCookie.match(/WEB_TOKEN=([^;]+)/);
    if (m) webToken = m[1];
  }
  if (!webToken) throw new Error('Không nhận được cookie WEB_TOKEN từ admin.emrhub.vn');

  console.log(`[EMRHub] [2/2] Đang trích xuất cặp khóa RSA từ /api/admin/facility/profile...`);
  const profileRes = await fetch('https://admin.emrhub.vn/api/admin/facility/profile', {
    headers: {
      'Cookie': `WEB_TOKEN=${webToken}`,
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://admin.emrhub.vn/facility/profile',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  const profileData = await profileRes.json();
  if (!profileRes.ok || !profileData.header?.success || !profileData.data) {
    throw new Error(profileData.header?.res_msg || 'Không lấy được hồ sơ cơ sở y tế');
  }

  const d = profileData.data;
  function toPem(rawKey, type) {
    if (!rawKey) return '';
    let clean = rawKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const lines = clean.match(/.{1,64}/g) || [clean];
    return `-----BEGIN ${type} KEY-----\n${lines.join('\n')}\n-----END ${type} KEY-----`;
  }

  const pubPem = toPem(d.public_key, 'PUBLIC');
  const privPem = toPem(d.private_key, 'PRIVATE');

  console.log('\n=== KẾT QUẢ TRÍCH XUẤT KHÓA RSA TỪ EMRHUB THÀNH CÔNG ===');
  console.log(`- Tên cơ sở:   ${d.ten_cskb}`);
  console.log(`- Mã cơ sở:    ${d.ma_cskb}`);
  console.log(`- Số GPHĐ:     ${d.so_gphd}`);
  console.log(`- Địa chỉ:     ${d.dia_chi}`);
  console.log(`- Public Key:  (${pubPem.length} ký tự)`);
  console.log(`- Private Key: (${privPem.length} ký tự)`);

  if (shouldSave) {
    console.log('\n[Auto-Save] Đang cập nhật PublicKey, PrivateKey & SenderId lên hệ thống ytcs-gw...');
    await updateConfig({
      publicKey: pubPem,
      privateKey: privPem,
      senderId: d.ma_cskb || username
    });
    console.log('[Auto-Save] Hoàn tất cập nhật lên hệ thống!');
  }

  return {
    facilityCode: d.ma_cskb,
    facilityName: d.ten_cskb,
    publicKey: pubPem,
    privateKey: privPem
  };
}

// CLI handler
const args = process.argv.slice(2);
const command = args[0] || 'get';

(async () => {
  try {
    if (command === 'login') {
      let username = '06152.adminbv';
      let password = 'hIs4Yte#2025#adMiN';
      let region = 'region2';
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'username') username = val;
        if (key === 'password') password = val;
        if (key === 'region') region = val;
      }
      await login(username, password, region);
    } else if (command === 'get') {
      const item = await getConfig();
      console.log('=== THÔNG TIN CẤU HÌNH LIEN_THONG_KSK ===');
      console.log('ID:', item.id);
      console.log('Ngày sửa cuối:', item.ngaySua);
      console.log('GiaTriThietLap:');
      console.log(JSON.stringify(JSON.parse(item.giaTriThietLap), null, 2));
    } else if (command === 'update') {
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'username') updates.username = val;
        if (key === 'password') updates.password = val;
        if (key === 'senderId') updates.senderId = val;
        if (key === 'publicKey') updates.publicKey = val;
        if (key === 'privateKey') updates.privateKey = val;
      }
      await updateConfig(updates);
    } else if (command === 'get-dtdt') {
      const item = await getDtdtConfig();
      console.log('=== THÔNG TIN CẤU HÌNH DON_THUOC_DIEN_TU ===');
      console.log('ID:', item.id);
      console.log('Ngày sửa cuối:', item.ngaySua || item.ngayTao);
      const thietLap = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      console.log('\n--- CÁC THÔNG SỐ CHÍNH ---');
      console.log('1. dtDtMaLienThong:  ', thietLap.dtDtMaLienThong ? thietLap.dtDtMaLienThong.giatri : '');
      console.log('2. dtDtPassLienThong:', thietLap.dtDtPassLienThong ? thietLap.dtDtPassLienThong.giatri : '');
      console.log('3. maCoSoKcbLienThong:', thietLap.maCoSoKcbLienThong ? thietLap.maCoSoKcbLienThong.giatri : '');
      console.log('4. maCoSoKCB:        ', thietLap.maCoSoKCB ? thietLap.maCoSoKCB.giatri : '');
      console.log('5. urlGuiDonThuoc:   ', thietLap.urlGuiDonThuoc ? thietLap.urlGuiDonThuoc.giatri : '');
      console.log('\nToàn bộ GiaTriThietLap:');
      console.log(JSON.stringify(thietLap, null, 2));
    } else if (command === 'update-dtdt') {
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'maLienThong' || key === 'username') updates.maLienThong = val;
        if (key === 'passLienThong' || key === 'password') updates.passLienThong = val;
        if (key === 'maCskcbLienThong') updates.maCskcbLienThong = val;
        if (key === 'maCskcb') updates.maCskcb = val;
        if (key === 'dungTkChung') updates.dungTkChung = val;
        if (key === 'usernameBsiDungChung') updates.usernameBsiDungChung = val;
        if (key === 'passwordBsiDungChung') updates.passwordBsiDungChung = val;
        if (key === 'urlGuiDonThuoc' || key === 'url') updates.urlGuiDonThuoc = val;
      }
      await updateDtdtConfig(updates);
    } else if (command === 'get-kb' || command === 'get-chidinh') {
      const item = await getKbChiDinhConfig();
      console.log('=== THÔNG TIN CẤU HÌNH KB_CHIDINHTVT ===');
      console.log('ID:', item.id);
      console.log('Mã:', item.maCauHinh);
      console.log('Tên:', item.tenCauHinh);
      console.log('Ngày sửa cuối:', item.ngaySua || item.ngayTao);
      const thietLap = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      console.log('\n--- 2 TRƯỜNG ĐẨY ĐƠN THUỐC ĐIỆN TỬ ---');
      console.log('1. dtdtDayCongDTQG:');
      console.log('   Giá trị hiện tại:', thietLap.dtdtDayCongDTQG ? thietLap.dtdtDayCongDTQG.giatri : '(chưa có)');
      console.log('   Mô tả:', thietLap.dtdtDayCongDTQG ? thietLap.dtdtDayCongDTQG.mota : '');
      console.log('\n2. dtdtDay:');
      console.log('   Giá trị hiện tại:', thietLap.dtdtDay ? thietLap.dtdtDay.giatri : '(chưa có)');
      console.log('   Mô tả:', thietLap.dtdtDay ? thietLap.dtdtDay.mota : '');
    } else if (command === 'update-kb' || command === 'update-chidinh') {
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'dtdtDayCongDTQG') updates.dtdtDayCongDTQG = val;
        if (key === 'dtdtDay') updates.dtdtDay = val;
      }
      await updateKbChiDinhConfig(updates);
    } else if (command === 'get-vpi' || command === 'get-baohiem') {
      const item = await getVpiConfig();
      console.log('=== THÔNG TIN CẤU HÌNH VPI_BAOHIEM ===');
      console.log('ID:', item.id);
      console.log('Mã:', item.maCauHinh);
      console.log('Tên:', item.tenCauHinh);
      console.log('Ngày sửa cuối:', item.ngaySua || item.ngayTao);
      const thietLap = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      console.log('\n--- 4 TRƯỜNG KẾ TOÁN & NGƯỜI LẬP BẢNG KÊ ---');
      console.log('1. tenKeToanBangKe:      ', thietLap.tenKeToanBangKe ? thietLap.tenKeToanBangKe.giatri : '');
      console.log('2. tenKeToanVienPhi:     ', thietLap.tenKeToanVienPhi ? thietLap.tenKeToanVienPhi.giatri : '');
      console.log('3. chucDanhKeToanVienPhi:', thietLap.chucDanhKeToanVienPhi ? thietLap.chucDanhKeToanVienPhi.giatri : '');
      console.log('4. nguoiLapBangKe:       ', thietLap.nguoiLapBangKe ? thietLap.nguoiLapBangKe.giatri : '');
      if (thietLap.tenNguoiLapBangKe) {
        console.log('   (tenNguoiLapBangKe):   ', thietLap.tenNguoiLapBangKe.giatri);
      }
    } else if (command === 'update-vpi' || command === 'update-baohiem') {
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'tenKeToanBangKe') updates.tenKeToanBangKe = val;
        if (key === 'tenKeToanVienPhi') updates.tenKeToanVienPhi = val;
        if (key === 'chucDanhKeToanVienPhi') updates.chucDanhKeToanVienPhi = val;
        if (key === 'nguoiLapBangKe') updates.nguoiLapBangKe = val;
        if (key === 'tenNguoiLapBangKe') updates.tenNguoiLapBangKe = val;
      }
      await updateVpiConfig(updates);
    } else if (command === 'get-emch' || command === 'get-mebe') {
      const item = await getEmchConfig();
      console.log('=== THÔNG TIN CẤU HÌNH EMCH (SỔ SỨC KHỎE MẸ & BÉ) ===');
      console.log('ID:', item.id);
      console.log('Mã:', item.maCauHinh);
      console.log('Tên:', item.tenCauHinh);
      console.log('Ngày sửa cuối:', item.ngaySua || item.ngayTao);
      const thietLap = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      console.log('\n--- CÁC TRƯỜNG KẾT NỐI EMCH ---');
      console.log('1. eMCHUsername: ', thietLap.eMCHUsername ? thietLap.eMCHUsername.giatri : '');
      console.log('2. eMCHPassword: ', thietLap.eMCHPassword ? '********' : '(trống)');
      console.log('3. eMCHBaseUrl:  ', thietLap.eMCHBaseUrl ? thietLap.eMCHBaseUrl.giatri : '');
      console.log('4. eMCHTenTTDV:  ', thietLap.eMCHTenTTDV ? thietLap.eMCHTenTTDV.giatri : '');
      console.log('5. EMCH_CONFIG:  ', thietLap.EMCH_CONFIG ? thietLap.EMCH_CONFIG.giatri : '');
    } else if (command === 'update-emch' || command === 'update-mebe') {
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'username' || key === 'eMCHUsername') updates.username = val;
        if (key === 'password' || key === 'eMCHPassword') updates.password = val;
        if (key === 'baseUrl' || key === 'eMCHBaseUrl') updates.baseUrl = val;
        if (key === 'tenTTDV' || key === 'eMCHTenTTDV') updates.tenTTDV = val;
      }
      await updateEmchConfig(updates);
    } else if (command === 'test-login' || command === 'test-ksk-login') {
      let username = '';
      let password = '';
      let url = 'https://api.emrhub.vn/api/auth/login';

      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'username') username = val;
        if (key === 'password') password = val;
        if (key === 'url') url = val;
      }

      if (!username || !password) {
        console.log('Không truyền đầy đủ --username/--password, đang tự động lấy từ cấu hình LIEN_THONG_KSK hiện tại...');
        try {
          const current = await getConfig();
          const thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;
          if (!username && thietLap.kskUsername) username = thietLap.kskUsername.giatri;
          if (!password && thietLap.kskPassword) password = thietLap.kskPassword.giatri;
          if (thietLap.kskUrlDomain && thietLap.kskLoginUrl) {
            const domain = thietLap.kskUrlDomain.giatri.replace(/\/+$/, '');
            const p = thietLap.kskLoginUrl.giatri.startsWith('/') ? thietLap.kskLoginUrl.giatri : '/' + thietLap.kskLoginUrl.giatri;
            url = domain + p;
          }
        } catch (e) {
          console.log('(Không thể lấy tự động từ hệ thống: ' + e.message + ')');
        }
      }

      if (!username) {
        console.error('Lỗi: Cần nhập username (--username <user>)');
        process.exit(1);
      }

      const res = await testKskLogin(username, password, url);
      console.log(`\n=== KẾT QUẢ KIỂM TRA ĐĂNG NHẬP API KSK (Status: ${res.status}, Latency: ${res.latency}ms) ===`);
      console.log(JSON.stringify(res.data || res.raw, null, 2));

      if (res.status === 200 || (res.data && res.data.header && res.data.header.success)) {
        console.log('\n=> KẾT QUẢ: ĐĂNG NHẬP THÀNH CÔNG!');
      } else {
        const msg = (res.data && res.data.header && res.data.header.res_msg) ||
                    (res.data && res.data.message) ||
                    'Đăng nhập không thành công';
        console.log(`\n=> KẾT QUẢ: ĐĂNG NHẬP THẤT BẠI: ${msg}`);
        if (res.data && res.data.data && res.data.data.remaining_attempts !== undefined) {
          console.log(`=> LƯU Ý: Số lần thử còn lại: ${res.data.data.remaining_attempts}/${res.data.data.max_attempts || 5}`);
        }
      }
    } else if (command === 'fetch-keys' || command === 'get-keys') {
      let username = '';
      let password = '';
      let shouldSave = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--save') {
          shouldSave = true;
        } else if (args[i] === '--username' && args[i + 1]) {
          username = args[++i];
        } else if (args[i] === '--password' && args[i + 1]) {
          password = args[++i];
        }
      }

      if (!username || !password) {
        try {
          const current = await getConfig();
          const thietLap = typeof current.giaTriThietLap === 'string' ? JSON.parse(current.giaTriThietLap) : current.giaTriThietLap;
          if (!username && thietLap.kskSenderId) username = thietLap.kskSenderId.giatri;
          if (!password && thietLap.kskPassword) password = thietLap.kskPassword.giatri;
        } catch (e) {}
      }

      if (!username || !password) {
        console.error('Lỗi: Cần nhập tài khoản (--username <senderId>) và mật khẩu (--password <pass>)');
        process.exit(1);
      }

      await fetchEmrhubKeys(username, password, shouldSave);
    } else if (command === 'get-bangke' || command === 'list-bangke') {
      const list = await getBangKeList();
      console.log(`=== DANH SÁCH MẪU BẢNG KÊ CHI PHÍ KCB (${list.length} BẢN GHI) ===\n`);
      list.forEach((item, idx) => {
        const status = item.trangThai === 1 ? '🟢 BẬT' : '⚪ TẮT';
        console.log(`[${idx + 1}] ID: ${item.id} | Mã: ${item.maBaoCao} | Trạng thái: ${status}`);
        console.log(`    Tên: ${item.ten || item.tenBaoCao || '(không tên)'}`);
        console.log(`    Mẫu hiện tại: ${item.tempCode || item.templateCode || '(trống)'}`);
        console.log(`    Ghi chú: ${item.ghiChu || '(không có)'}`);
        console.log(`    Ngày sửa: ${item.ngaySua || item.ngayTao || '(chưa rõ)'}\n`);
      });
    } else if (command === 'update-bangke') {
      let id = null;
      const updates = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'id') id = val;
        if (key === 'templateCode' || key === 'tempCode') updates.templateCode = val;
        if (key === 'ghiChu') updates.ghiChu = val;
        if (key === 'trangThai') updates.trangThai = parseInt(val, 10);
      }

      if (!id) {
        console.error('Lỗi: Cần truyền ID bản ghi bảng kê cần cập nhật (--id <id>)');
        process.exit(1);
      }
      if (Object.keys(updates).length === 0) {
        console.error('Lỗi: Cần truyền ít nhất một thông tin cần sửa (--templateCode, --ghiChu, --trangThai)');
        process.exit(1);
      }

      await updateBangKeReport(id, updates);
    } else if (command === 'apply-suggest-bangke' || command === 'suggest-bangke') {
      await applySuggestedBangKe();
    } else if (command === 'phieuin-data' || command === 'extract-data' || command === 'phieuin') {
      let report = 'GIAY_RA_VIEN';
      let khamBenhId = 402;
      let rawJson = '';

      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        if (key === 'report' || key === 'maBaoCao') report = val;
        if (key === 'khamBenhId' || key === 'id') khamBenhId = isNaN(Number(val)) ? val : Number(val);
        if (key === 'json') rawJson = val;
      }

      let payload = {
        maBaoCao: report,
        param: {
          khamBenhId: khamBenhId
        }
      };

      if (rawJson) {
        try {
          payload = JSON.parse(rawJson);
        } catch (e) {
          console.error('Lỗi định dạng JSON trong --json:', e.message);
          process.exit(1);
        }
      }

      await extractPhieuInData(payload);
    } else {
      console.log('Cách dùng:');
      console.log('  node update_ksk.js login --username <user> --password <pass> [--region region2]');
      console.log('  node update_ksk.js get');
      console.log('  node update_ksk.js update --username <user> --password <pass> --senderId <id>');
      console.log('  node update_ksk.js test-login [--username <user>] [--password <pass>] [--url <url>]');
      console.log('  node update_ksk.js fetch-keys [--username <user>] [--password <pass>] [--save]');
      console.log('  node update_ksk.js get-dtdt');
      console.log('  node update_ksk.js update-dtdt --maLienThong <user> --passLienThong <pass> --maCskcbLienThong <ma> --maCskcb <ma>');
      console.log('  node update_ksk.js get-kb');
      console.log('  node update_ksk.js update-kb --dtdtDayCongDTQG <0|1|2> --dtdtDay <0|1|2>');
      console.log('  node update_ksk.js get-vpi');
      console.log('  node update_ksk.js update-vpi --tenKeToanBangKe <val> --tenKeToanVienPhi <val> --chucDanhKeToanVienPhi <val> --nguoiLapBangKe <val>');
      console.log('  node update_ksk.js get-emch');
      console.log('  node update_ksk.js update-emch --username <user> --password <pass> [--baseUrl <url>] [--tenTTDV <ten>]');
      console.log('  node update_ksk.js get-bangke');
      console.log('  node update_ksk.js update-bangke --id <id> [--templateCode <code>] [--ghiChu <note>] [--trangThai <0|1>]');
      console.log('  node update_ksk.js apply-suggest-bangke');
      console.log('  node update_ksk.js extract-data [--report GIAY_RA_VIEN] [--khamBenhId 402]');
      console.log('  node update_ksk.js phieuin-data --json \'{"maBaoCao":"GIAY_RA_VIEN","param":{"khamBenhId":402}}\'');
    }
  } catch (e) {
    console.error('Lỗi thực thi:', e.message);
  }
})();
