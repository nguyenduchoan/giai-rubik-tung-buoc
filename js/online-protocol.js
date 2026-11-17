/*
 * Giao thức Thi trực tiếp dùng chung cho trình duyệt và máy chủ (Node): phiên bản, mã phòng, biệt danh, nước xoay,
 * mã kiểm tra trạng thái và thông báo lỗi. Phụ thuộc Rubik.cube và Rubik.playMoves (cùng mô hình xoay với Chơi tự do).
 * Trạng thái khối là chuỗi 54 ký tự URFDLB theo thứ tự của cube.js; nước xoay luôn theo hệ trục cố định của khối.
 */
(function (root) {
  'use strict';
  const C = root.Rubik.cube;
  const P = root.Rubik.playMoves;

  const PROTOCOL_VERSION = 1;
  // Bỏ 0 O 1 I khỏi bảng Crockford base32 để tránh đọc nhầm khi đọc mã cho nhau.
  const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_LENGTH = 8;
  const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

  // FNV-1a 32 bit: mã kiểm tra lệch trạng thái giữa hai bên, không phải bằng chứng chống gian lận.
  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  // Đổi phép xoay (bảng hoán vị) thì phiên bản mô hình đổi theo, máy cũ không thi cùng máy mới.
  const ENGINE_VERSION = 'pm1-' + fnv1a(JSON.stringify(Object.keys(P.PERM).sort().map((k) => [k, P.PERM[k]])));

  const MOVE_BASES = Object.keys(P.BASES);
  // Một nước = một lớp ngoài/giữa hoặc hai lớp, 90°/ngược/180°. Không nhận xoay cả khối hay chuỗi nhiều nước.
  function isMove(token) {
    if (typeof token !== 'string' || token.length > 4) return false;
    try { return P.normalize(token) === token && MOVE_BASES.includes(P.parse(token).base); } catch (e) { return false; }
  }

  const stateString = (state) => (typeof state === 'string' ? state : Array.from(state).join(''));
  const stateHash = (state) => fnv1a(stateString(state));
  const applyMove = (state, move) => P.apply(Array.from(stateString(state)), move).join('');
  const isSolved = (state) => P.isSolved(Array.from(stateString(state)));
  function isState(state) {
    if (typeof state !== 'string' || state.length !== 54) return false;
    const counts = {};
    for (const ch of state) {
      if (!C.FACES.includes(ch)) return false;
      counts[ch] = (counts[ch] || 0) + 1;
    }
    return C.FACES.every((f) => counts[f] === 9);
  }

  function normalizeCode(text) {
    return String(text || '').toUpperCase().replace(/[\s-]+/g, '');
  }
  const isCode = (code) => typeof code === 'string' && CODE_PATTERN.test(code);

  /*
   * Biệt danh: chuẩn hóa Unicode NFC, gộp khoảng trắng, 2–20 ký tự, không có ký tự điều khiển/định dạng ẩn.
   * key dùng để so trùng trong phòng (không phân biệt hoa thường).
   */
  // Ký tự điều khiển, định dạng ẩn (độ rộng 0, đổi chiều chữ…) làm hai tên trông giống nhau hoặc phá bố cục.
  const HIDDEN_RANGES = [[0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f],
    [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]];
  const hasHidden = (text) => [...text].some((ch) => {
    const cp = ch.codePointAt(0);
    return HIDDEN_RANGES.some(([a, b]) => cp >= a && cp <= b);
  });
  function normalizeNickname(value) {
    if (typeof value !== 'string') return null;
    const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    const length = [...name].length;
    if (length < 2 || length > 20 || hasHidden(name)) return null;
    return { name, key: name.toLocaleLowerCase('vi') };
  }

  const formatTime = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const cs = Math.floor(ms / 10);
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };

  // Thông báo cho người chơi theo mã lỗi (phụ lục A của kế hoạch); không hiện mã thô.
  const MESSAGES = {
    session_invalid: 'Phiên đã hết hạn. Nhập lại biệt danh để vào phòng.',
    session_in_other_room: 'Bạn đang ở một phòng khác. Rời phòng đó trước khi tạo hoặc vào phòng mới.',
    room_not_found: 'Không tìm thấy phòng với mã này. Kiểm tra lại mã mời.',
    room_full: 'Phòng đã đủ 8 người.',
    room_closed: 'Phòng đã đóng. Hãy tạo phòng mới.',
    room_expired: 'Phòng đã mở quá 4 giờ nên không mở ván mới. Hãy tạo phòng mới.',
    room_banned: 'Bạn đã bị chủ phòng mời ra và không thể vào lại phòng này.',
    not_member: 'Bạn không còn ở trong phòng này.',
    nickname_invalid: 'Biệt danh cần 2–20 ký tự, không chứa ký tự đặc biệt ẩn.',
    nickname_taken: 'Tên này đã có người dùng trong phòng. Chọn tên khác.',
    code_invalid: 'Mã mời gồm 8 ký tự chữ và số (không có 0, O, 1, I).',
    not_host: 'Chỉ chủ phòng làm được việc này.',
    wrong_room_state: 'Thao tác không còn phù hợp với trạng thái phòng. Đã đồng bộ lại.',
    not_all_ready: 'Chưa thể bắt đầu: còn người chưa sẵn sàng hoặc chưa kết nối.',
    too_few_players: 'Cần ít nhất 2 người sẵn sàng để bắt đầu.',
    version_mismatch: 'Ứng dụng của bạn đã cũ. Tải lại trang để cập nhật trước khi thi.',
    round_not_running: 'Ván chưa bắt đầu hoặc đã kết thúc.',
    wrong_round: 'Ván đã thay đổi. Đã đồng bộ lại.',
    attempt_finished: 'Lượt của bạn đã kết thúc.',
    not_participant: 'Bạn không thi ván này.',
    stale_epoch: 'Phòng đang được điều khiển ở tab khác.',
    seq_gap: 'Mất đồng bộ nước xoay. Đã dựng lại khối theo máy chủ.',
    state_mismatch: 'Khối lệch với máy chủ. Đã dựng lại khối theo máy chủ.',
    invalid_move: 'Nước xoay không hợp lệ.',
    command_conflict: 'Lệnh bị trùng mã. Đã đồng bộ lại.',
    too_many_pending: 'Mạng chậm: chờ máy chủ xác nhận các nước trước.',
    rate_limited: 'Thao tác quá nhanh. Chờ một chút rồi thử lại.',
    member_not_eligible: 'Không thể chọn người này.',
    service_unavailable: 'Dịch vụ thi đấu đang bận hoặc bảo trì. Thử lại sau.',
    payload_too_large: 'Dữ liệu gửi quá lớn.',
    malformed: 'Dữ liệu gửi không hợp lệ.',
    forbidden_origin: 'Yêu cầu không đến từ trang Rubik.',
    not_found: 'Không tìm thấy.',
  };
  const message = (code) => MESSAGES[code] || 'Không thực hiện được. Vui lòng thử lại.';

  const END_REASONS = {
    solved: 'Đã giải xong', timeout: 'Hết giờ', surrendered: 'Bỏ cuộc', left: 'Rời phòng', reconnect_timeout: 'Mất kết nối quá lâu',
  };
  const ROUND_REASONS = {
    timeout: 'có người chưa tải xong khối kịp giờ',
    member_disconnected: 'có người mất kết nối trước giờ bắt đầu',
    member_unready: 'có người chưa sẵn sàng',
    member_left: 'có người rời phòng trước giờ bắt đầu',
    engine_mismatch: 'có máy dùng phiên bản ứng dụng khác',
    service_restart: 'dịch vụ thi đấu vừa khởi động lại',
    storage_failure: 'máy chủ không lưu được kết quả',
    maintenance: 'dịch vụ đang bảo trì',
  };

  root.Rubik = root.Rubik || {};
  root.Rubik.onlineProtocol = {
    PROTOCOL_VERSION, ENGINE_VERSION, CODE_ALPHABET, CODE_LENGTH, MESSAGES, END_REASONS, ROUND_REASONS,
    fnv1a, isMove, stateHash, stateString, applyMove, isSolved, isState, normalizeCode, isCode, normalizeNickname,
    formatTime, message,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
