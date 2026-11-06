/*
 * Nhận diện màu sticker từ ảnh/camera.
 *  - sampleGrid: lấy màu trung vị của 9 ô trong khung lưới.
 *  - classifyHeuristic: đoán màu một ô theo HSV (dùng cho xem trước).
 *  - classifyAll: phân loại cả 54 ô, dùng 6 ô tâm làm mốc và ép mỗi màu đúng 9 ô.
 */
(function (root) {
  'use strict';

  const PALETTE = [
    { id: 0, name: 'Trắng', hex: '#f4f4f4', ref: [235, 235, 235] },
    { id: 1, name: 'Vàng', hex: '#ffd500', ref: [230, 215, 40] },
    { id: 2, name: 'Đỏ', hex: '#d0102c', ref: [190, 30, 45] },
    { id: 3, name: 'Cam', hex: '#ff6d00', ref: [245, 120, 30] },
    { id: 4, name: 'Xanh dương', hex: '#0050c8', ref: [20, 80, 190] },
    { id: 5, name: 'Xanh lá', hex: '#00a650', ref: [20, 165, 90] },
  ];

  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }

  function rgbToLab([r, g, b]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /*
   * Khoảng cách màu kiểu LCh: ưu tiên khác biệt sắc độ (hue), giảm trọng số độ sáng
   * và độ bão hoà vì hai đại lượng này thay đổi nhiều theo ánh sáng/bóng đổ.
   */
  function labDist(a, b) {
    const c1 = Math.hypot(a[1], a[2]), c2 = Math.hypot(b[1], b[2]);
    const dl = (a[0] - b[0]) * 0.3;
    const dc = (c1 - c2) * 0.4;
    const dh2 = Math.max(0, (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 - (c1 - c2) ** 2);
    return Math.sqrt(dl * dl + dc * dc + dh2);
  }

  // Bài toán gán chi phí nhỏ nhất (thuật toán Hungarian), ma trận vuông n x n.
  // Trả về ans[hàng] = cột.
  function hungarian(cost) {
    const n = cost.length;
    const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
    const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(n + 1).fill(Infinity);
      const used = new Uint8Array(n + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const ans = new Array(n);
    for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
    return ans;
  }

  function classifyHeuristic(rgb) {
    const [h, s, v] = rgbToHsv(rgb);
    if (s < 0.25 || (s < 0.35 && v > 0.8 && (h < 40 || h >= 75))) return 0;
    if (h >= 345 || h < 10) return 2;
    if (h < 38) return 3;
    if (h < 75) return 1;
    if (h < 170) return 5;
    if (h < 270) return 4;
    return 2;
  }

  function quantile(hist, n, q) {
    let acc = 0;
    const target = n * q;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  /*
   * Lấy màu 9 ô trong hình vuông (gx, gy, size) trên canvas context.
   * Trả về { rgb: 9 x [r, g, b] (trung vị), spread: 9 x độ phân tán (IQR lớn nhất của 3 kênh) }.
   * Ô sticker thật có màu đồng đều nên spread nhỏ.
   */
  function sampleGridDetailed(ctx, gx, gy, size) {
    const cell = size / 3;
    const inner = Math.max(2, Math.floor(cell * 0.45));
    const rgb = [];
    const spread = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = Math.round(gx + c * cell + (cell - inner) / 2);
        const y = Math.round(gy + r * cell + (cell - inner) / 2);
        const data = ctx.getImageData(x, y, inner, inner).data;
        const hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          hists[0][data[i]]++; hists[1][data[i + 1]]++; hists[2][data[i + 2]]++;
        }
        rgb.push(hists.map((h) => quantile(h, n, 0.5)));
        spread.push(Math.max(...hists.map((h) => quantile(h, n, 0.75) - quantile(h, n, 0.25))));
      }
    }
    return { rgb, spread, lineRatio: gridLineRatio(ctx, gx, gy, size, rgb) };
  }

  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  /*
   * Độ sáng của các đường lưới bên trong so với sticker. Khối Rubik thật có khe nhựa tối
   * giữa các sticker nên tỉ lệ nhỏ; mặt tường/bàn đồng màu cho tỉ lệ ~1.
   */
  function gridLineRatio(ctx, gx, gy, size, rgb) {
    const cell = size / 3;
    const band = Math.max(1, Math.round(cell * 0.06));
    const lums = [];
    for (let i = 1; i < 3; i++) {
      const pos = Math.round(i * cell - band / 2);
      const v = ctx.getImageData(Math.round(gx + pos), Math.round(gy), band, Math.round(size)).data;
      const h = ctx.getImageData(Math.round(gx), Math.round(gy + pos), Math.round(size), band).data;
      for (const d of [v, h]) {
        for (let k = 0; k < d.length; k += 4) lums.push(luma(d[k], d[k + 1], d[k + 2]));
      }
    }
    lums.sort((a, b) => a - b);
    const lineLum = lums[Math.floor(lums.length * 0.3)] || 0;
    const stickerLums = rgb.map((c) => luma(c[0], c[1], c[2])).sort((a, b) => a - b);
    return lineLum / Math.max(1, stickerLums[4]);
  }

  const sampleGrid = (ctx, gx, gy, size) => sampleGridDetailed(ctx, gx, gy, size).rgb;

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const res = [];
    arr.forEach((x, i) => {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permutations(rest).forEach((p) => res.push([x].concat(p)));
    });
    return res;
  }
  const PERMS6 = permutations([0, 1, 2, 3, 4, 5]);

  /*
   * Phân loại 54 ô (mảng [r, g, b]) thành mã màu PALETTE.
   * Bước 1: gom cụm quanh 6 ô tâm, mỗi cụm đúng 9 ô (gán tối ưu bằng Hungarian),
   *         lặp lại vài lần với mốc là trung bình cụm.
   * Bước 2: ghép mỗi cụm với một màu trong bảng màu (tối ưu trên 720 hoán vị).
   */
  function classifyAll(rgbs) {
    const labs = rgbs.map(rgbToLab);
    const centers = [4, 13, 22, 31, 40, 49];

    const others = [];
    for (let i = 0; i < 54; i++) if (!centers.includes(i)) others.push(i);

    let refs = centers.map((ci) => labs[ci]);
    let assign = null;
    for (let iter = 0; iter < 4; iter++) {
      assign = new Array(54).fill(-1);
      centers.forEach((ci, k) => { assign[ci] = k; });
      // 48 ô còn lại x 48 "chỗ" (mỗi màu 8 chỗ).
      const cost = others.map((i) => {
        const d = refs.map((r) => labDist(labs[i], r));
        return Array.from({ length: 48 }, (_, slot) => d[(slot / 8) | 0]);
      });
      hungarian(cost).forEach((slot, row) => { assign[others[row]] = (slot / 8) | 0; });
      // Cập nhật mốc = trung bình cụm (ô tâm được tính gấp đôi cho ổn định).
      refs = centers.map((ci, k) => {
        const acc = [labs[ci][0] * 2, labs[ci][1] * 2, labs[ci][2] * 2];
        let n = 2;
        for (let i = 0; i < 54; i++) {
          if (assign[i] !== k || i === ci) continue;
          acc[0] += labs[i][0]; acc[1] += labs[i][1]; acc[2] += labs[i][2];
          n++;
        }
        return acc.map((v) => v / n);
      });
    }

    const votes = Array.from({ length: 6 }, () => new Array(6).fill(0));
    rgbs.forEach((rgb, i) => { votes[assign[i]][classifyHeuristic(rgb)]++; });
    const palLabs = PALETTE.map((p) => rgbToLab(p.ref));
    let bestPerm = PERMS6[0], bestCost = Infinity;
    for (const perm of PERMS6) {
      let cost = 0;
      for (let k = 0; k < 6; k++) cost += -votes[k][perm[k]] * 10 + labDist(refs[k], palLabs[perm[k]]) * 0.05;
      if (cost < bestCost) { bestCost = cost; bestPerm = perm; }
    }
    return assign.map((k) => bestPerm[k]);
  }

  root.Rubik = root.Rubik || {};
  const colorDistance = (rgb1, rgb2) => labDist(rgbToLab(rgb1), rgbToLab(rgb2));

  const ROTATE_CW = [6, 3, 0, 7, 4, 1, 8, 5, 2];

  /*
   * Phát hiện hai ảnh chụp trùng một mặt, dựa trên MÀU ẢNH GỐC (rgbs: 54 x [r,g,b]).
   * Phải kiểm tra trước classifyAll vì bước đó luôn ép 6 tâm thành 6 màu khác nhau (mặt trùng sẽ
   * bị gán thành màu còn thiếu). Coi là trùng khi tâm gần nhau hơn `centerMax` (cùng ngưỡng chặn tự
   * chụp trùng trong app) VÀ cả 9 ô khớp nhau sai khác một phép xoay (độ lệch trung bình < `patternMax`).
   * Điều kiện thứ hai tránh báo nhầm hai mặt khác nhau có tâm đỏ/cam hoặc trắng/vàng trông gần giống nhau:
   * trên dữ liệu mô phỏng, ảnh trùng thật lệch tối đa ~11, hai mặt khác nhau lệch tối thiểu ~20.
   * Trả về [p1, p2] (vị trí mặt 0..5 theo U R F D L B) của cặp giống nhau nhất, hoặc null.
   */
  function duplicateCenters(rgbs, { centerMax = 18, patternMax = 15 } = {}) {
    const face = (p) => rgbs.slice(p * 9, p * 9 + 9);
    let best = null, bestD = centerMax;
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        const fa = face(a);
        let fb = face(b);
        if (fa.some((c) => !c) || fb.some((c) => !c)) continue;
        const centerD = colorDistance(fa[4], fb[4]);
        if (centerD >= bestD) continue;
        let patternD = Infinity;
        for (let r = 0; r < 4; r++, fb = ROTATE_CW.map((k) => fb[k])) {
          patternD = Math.min(patternD, fa.reduce((s, c, k) => s + colorDistance(c, fb[k]), 0) / 9);
        }
        if (patternD < patternMax) { best = [a, b]; bestD = centerD; }
      }
    }
    return best;
  }

  /*
   * Đánh giá ô nào dễ bị nhận sai màu. rgbs: 54 x [r,g,b] (null nếu không có ảnh), colors: 54 mã màu.
   * Mốc mỗi màu = trung bình Lab các ô đang mang màu đó. ratio = khoảng cách tới màu đang gán /
   * khoảng cách tới màu gần thứ hai (càng gần 1 càng mơ hồ; > 1 nghĩa là giống màu khác hơn).
   * Trả về mảng { index, color, alt, ratio } sắp xếp giảm dần theo ratio (bỏ qua ô tâm).
   */
  function suspectCells(rgbs, colors) {
    const labs = rgbs.map((c) => (c ? rgbToLab(c) : null));
    const sums = new Map();
    labs.forEach((l, i) => {
      if (!l || colors[i] === null || colors[i] === undefined) return;
      const s = sums.get(colors[i]) || [0, 0, 0, 0];
      s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; s[3]++;
      sums.set(colors[i], s);
    });
    const refs = new Map([...sums].map(([c, s]) => [c, [s[0] / s[3], s[1] / s[3], s[2] / s[3]]]));
    const out = [];
    labs.forEach((l, i) => {
      if (!l || i % 9 === 4 || !refs.has(colors[i])) return;
      const own = labDist(l, refs.get(colors[i]));
      let alt = null, altD = Infinity;
      refs.forEach((r, c) => {
        if (c === colors[i]) return;
        const d = labDist(l, r);
        if (d < altD) { altD = d; alt = c; }
      });
      if (alt !== null) out.push({ index: i, color: colors[i], alt, ratio: own / Math.max(1e-6, altD) });
    });
    return out.sort((a, b) => b.ratio - a.ratio);
  }

  root.Rubik.vision = {
    PALETTE, rgbToHsv, rgbToLab, classifyHeuristic, sampleGrid, sampleGridDetailed, classifyAll, colorDistance,
    suspectCells, duplicateCenters,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
