/* 투구 동작 분석 엔진
 * 입력: frames = [{ t, lm:[{x,y,v}]x33 (화면 정규화 좌표), wl:[{x,y,z}]x33 (월드 좌표, m) | null }]
 *       opts = { aspect: 영상 가로/세로, hand: 'auto'|'R'|'L' }
 * 출력: 키프레임, 측정값, 항목별 점수, 총점, 피드백
 */
(function (root) {
  const P = { LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24, LK: 25, RK: 26, LA: 27, RA: 28 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lin = (v, bad, good) => clamp(((v - bad) / (good - bad)) * 100, 0, 100);
  const deg = (r) => (r * 180) / Math.PI;
  const wrap = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  // 빠진 프레임 보간 + 3프레임 이동평균
  function prepare(frames) {
    const n = frames.length;
    const ok = frames.map((f) => !!f.lm);
    if (ok.filter(Boolean).length < 8) return null;
    const out = frames.map((f) => ({ t: f.t, lm: f.lm ? f.lm.map((p) => ({ ...p })) : null, wl: f.wl ? f.wl.map((p) => ({ ...p })) : null }));
    for (let i = 0; i < n; i++) {
      if (out[i].lm) continue;
      let a = i - 1; while (a >= 0 && !frames[a].lm) a--;
      let b = i + 1; while (b < n && !frames[b].lm) b++;
      const src = a >= 0 && b < n ? null : (a >= 0 ? a : b);
      if (src !== null) { out[i].lm = frames[src].lm.map((p) => ({ ...p })); out[i].wl = frames[src].wl ? frames[src].wl.map((p) => ({ ...p })) : null; continue; }
      const w = (i - a) / (b - a);
      out[i].lm = frames[a].lm.map((p, k) => { const q = frames[b].lm[k]; return { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w, v: Math.min(p.v, q.v) }; });
      if (frames[a].wl && frames[b].wl) out[i].wl = frames[a].wl.map((p, k) => { const q = frames[b].wl[k]; return { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w, z: p.z + (q.z - p.z) * w }; });
    }
    const sm = out.map((f, i) => {
      const idx = [i - 1, i, i + 1].filter((j) => j >= 0 && j < n);
      const avg = (key, k, c) => idx.reduce((s, j) => s + (out[j][key] ? out[j][key][k][c] : out[i][key][k][c]), 0) / idx.length;
      return {
        t: f.t,
        lm: f.lm.map((p, k) => ({ x: avg('lm', k, 'x'), y: avg('lm', k, 'y'), v: p.v })),
        wl: f.wl ? f.wl.map((p, k) => ({ x: avg('wl', k, 'x'), y: avg('wl', k, 'y'), z: avg('wl', k, 'z') })) : null,
      };
    });
    return sm;
  }

  function analyze(rawFrames, opts) {
    const aspect = opts.aspect || 16 / 9;
    const F = prepare(rawFrames);
    if (!F) return { error: '사람을 충분히 찾지 못했어요. 전신이 잘 보이도록 옆에서 다시 찍어 주세요.' };
    const n = F.length;
    const dt = n > 1 ? (F[n - 1].t - F[0].t) / (n - 1) : 1 / 30;
    // 화면 좌표(가로 비율 보정): x는 aspect를 곱해 세로와 같은 단위로
    const pt = (f, k) => ({ x: f.lm[k].x * aspect, y: f.lm[k].y });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    // 다리 길이(골반~발목) 기준 단위
    const legLen = median(F.map((f) => (dist(pt(f, P.LH), pt(f, P.LK)) + dist(pt(f, P.LK), pt(f, P.LA)) + dist(pt(f, P.RH), pt(f, P.RK)) + dist(pt(f, P.RK), pt(f, P.RA))) / 2)) || 0.4;

    // 손목 속도 → 던지는 팔 판별 & 릴리스
    const speed = (k) => F.map((f, i) => (i === 0 ? 0 : dist(pt(f, k), pt(F[i - 1], k)) / legLen / dt));
    const sR = speed(P.RW), sL = speed(P.LW);
    let hand = opts.hand;
    if (!hand || hand === 'auto') hand = Math.max(...sR) >= Math.max(...sL) ? 'R' : 'L';
    const T = hand === 'R'
      ? { S: P.RS, E: P.RE, W: P.RW, H: P.RH, K: P.RK, A: P.RA, lS: P.LS, lH: P.LH, lK: P.LK, lA: P.LA, sp: sR }
      : { S: P.LS, E: P.LE, W: P.LW, H: P.LH, K: P.LK, A: P.LA, lS: P.RS, lH: P.RH, lK: P.RK, lA: P.RA, sp: sL };
    // T.S/E/W/H/K/A = 던지는 쪽(뒷발 쪽), lS/lH/lK/lA = 앞발 쪽

    let rel = 0; T.sp.forEach((v, i) => { if (v > T.sp[rel]) rel = i; });

    // 다리 들기 최고점: 릴리스 이전 2초 안에서 앞무릎이 가장 높은 순간
    const winStart = Math.max(0, rel - Math.round(2 / dt));
    let kl = winStart;
    for (let i = winStart; i < rel; i++) if (F[i].lm[T.lK].y < F[kl].lm[T.lK].y) kl = i;

    // 착지(foot plant): 다리 들기 이후 앞발목이 바닥 높이에 처음 닿는 순간
    let ground = -Infinity;
    for (let i = kl; i <= Math.min(n - 1, rel + 3); i++) ground = Math.max(ground, F[i].lm[T.lA].y);
    let fp = rel;
    for (let i = kl; i <= rel; i++) { if (F[i].lm[T.lA].y >= ground - 0.04 * legLen) { fp = i; break; } }
    if (fp >= rel) fp = Math.max(kl, rel - 2);

    // 던지는 방향: 착지 순간 뒷발 → 앞발
    const dir = Math.sign(pt(F[fp], T.lA).x - pt(F[fp], T.A).x) || 1;

    // ---------- 측정 ----------
    // 1) 체중이동
    const stride = Math.abs(pt(F[fp], T.lA).x - pt(F[fp], T.A).x) / legLen;
    const hipC = (f) => mid(pt(f, P.LH), pt(f, P.RH));
    const rearX = pt(F[fp], T.A).x, frontX = pt(F[fp], T.lA).x;
    const shiftAt = (i) => (hipC(F[i]).x - rearX) / (frontX - rearX || 1e-6);
    const shiftKL = shiftAt(kl), shiftRel = shiftAt(rel);

    // 2) 골반-어깨 분리 & 회전 (월드 좌표의 수평면 각도)
    const hasW = F.every((f) => f.wl);
    let sepFP = null, sepMax = null, pelvisPeakT = null, trunkPeakT = null, pelvisPeakV = null, trunkPeakV = null;
    let hipAng = [], shAng = [];
    if (hasW) {
      const ang = (f, a, b) => deg(Math.atan2(f.wl[b].z - f.wl[a].z, f.wl[b].x - f.wl[a].x));
      const unwrap = (arr) => { const o = [arr[0]]; for (let i = 1; i < arr.length; i++) o.push(o[i - 1] + wrap(arr[i] - arr[i - 1])); return o; };
      hipAng = unwrap(F.map((f) => ang(f, P.LH, P.RH)));
      shAng = unwrap(F.map((f) => ang(f, P.LS, P.RS)));
      const sepAt = (i) => Math.abs(wrap(shAng[i] - hipAng[i]));
      sepFP = sepAt(fp);
      sepMax = Math.max(...F.map((_, i) => i).filter((i) => i >= kl && i <= rel).map(sepAt));
      const vel = (a) => a.map((v, i) => (i === 0 ? 0 : Math.abs(v - a[i - 1]) / dt));
      const vH = vel(hipAng), vS = vel(shAng);
      const s0 = Math.max(0, fp - Math.round(0.15 / dt)), s1 = Math.min(n - 1, rel + 1);
      let ph = s0, ps = s0;
      for (let i = s0; i <= s1; i++) { if (vH[i] > vH[ph]) ph = i; if (vS[i] > vS[ps]) ps = i; }
      pelvisPeakT = F[ph].t; trunkPeakT = F[ps].t; pelvisPeakV = vH[ph]; trunkPeakV = vS[ps];
    }

    // 3) 앞다리 버팀: 무릎 각도(엉덩이-무릎-발목)
    const jointAng = (f, a, b, c) => {
      const A = pt(f, a), B = pt(f, b), C = pt(f, c);
      const v1 = { x: A.x - B.x, y: A.y - B.y }, v2 = { x: C.x - B.x, y: C.y - B.y };
      const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
      return deg(Math.acos(clamp(cos, -1, 1)));
    };
    const kneeFP = jointAng(F[fp], T.lH, T.lK, T.lA);
    const kneeRel = jointAng(F[rel], T.lH, T.lK, T.lA);

    // 4) 릴리스
    const sc = (f) => mid(pt(f, P.LS), pt(f, P.RS));
    const tiltRel = deg(Math.atan2(dir * (sc(F[rel]).x - hipC(F[rel]).x), hipC(F[rel]).y - sc(F[rel]).y));
    const extRel = (dir * (pt(F[rel], T.W).x - hipC(F[rel]).x)) / legLen;
    const elbowRel = jointAng(F[rel], T.S, T.E, T.W);
    const elbowFPh = (pt(F[fp], T.S).y - pt(F[fp], T.E).y) / legLen; // +면 팔꿈치가 어깨보다 높음

    // ---------- 점수 ----------
    const items = [];
    {
      const s1 = lin(stride, 0.7, 1.5), s2 = lin(shiftRel, 0.15, 0.65);
      const score = Math.round(s1 * 0.5 + s2 * 0.5);
      items.push({
        key: 'weight', name: '체중이동', weight: 25, score,
        metrics: [
          { label: '보폭 (다리 길이 대비)', value: stride.toFixed(2) + '배', tip: '목표 1.3~1.6배' },
          { label: '릴리스 때 골반 위치', value: Math.round(clamp(shiftRel, -1, 2) * 100) + '%', tip: '뒷발 0% → 앞발 100%, 목표 60% 이상' },
        ],
        good: '뒷발에서 앞발로 체중을 힘 있게 옮기고 있어요.',
        fix: stride < 1.2 ? '보폭이 짧아요. 앞발을 홈 방향으로 한 발 더 멀리 내딛어 보세요.' : '골반이 앞발 쪽으로 충분히 이동하지 못했어요. 앞발 착지 후 배꼽을 포수 쪽으로 밀어 주세요.',
      });
    }
    {
      const score = sepFP === null ? null : Math.round(lin(Math.max(sepFP, sepMax * 0.85), 5, 35));
      items.push({
        key: 'sep', name: '골반-어깨 분리', weight: 20, score,
        metrics: [
          { label: '착지 순간 분리각', value: sepFP === null ? '-' : Math.round(sepFP) + '°', tip: '목표 30° 이상' },
          { label: '최대 분리각', value: sepMax === null ? '-' : Math.round(sepMax) + '°', tip: '' },
        ],
        good: '골반이 먼저 열리고 어깨가 늦게 따라오는 꼬임이 좋아요.',
        fix: '골반과 어깨가 동시에 돌아가요. 앞발 착지 순간까지 가슴은 3루(우투 기준) 쪽을 보게 버텨 보세요.',
      });
    }
    {
      let score = null, order = null, gapMs = null;
      if (pelvisPeakT !== null) {
        gapMs = Math.round((trunkPeakT - pelvisPeakT) * 1000);
        order = gapMs > 0;
        score = order ? Math.round(60 + lin(gapMs, 0, 50) * 0.4) : (gapMs === 0 ? 45 : 25);
      }
      items.push({
        key: 'seq', name: '관절 회전 순서', weight: 20, score,
        metrics: [
          { label: '회전 순서', value: order === null ? '-' : order ? '골반 → 몸통 ✓' : '몸통이 먼저 ✗', tip: '골반이 먼저 최고속도' },
          { label: '골반 → 몸통 시간차', value: gapMs === null ? '-' : gapMs + 'ms', tip: '목표 30~60ms' },
        ],
        good: '하체 → 골반 → 몸통 → 팔 순서로 힘이 잘 전달돼요.',
        fix: '몸통(어깨)이 골반보다 먼저 돌아요. "엉덩이 먼저, 어깨는 나중에" 순서를 의식해 보세요.',
      });
    }
    {
      const change = kneeRel - kneeFP;
      const score = Math.round(lin(change, -25, 0) * 0.6 + lin(kneeRel, 120, 160) * 0.4);
      items.push({
        key: 'block', name: '앞다리 버팀', weight: 15, score,
        metrics: [
          { label: '착지 → 릴리스 무릎 변화', value: (change >= 0 ? '+' : '') + Math.round(change) + '°', tip: '+면 펴짐, -면 무너짐' },
          { label: '릴리스 때 무릎 각도', value: Math.round(kneeRel) + '°', tip: '목표 150° 이상' },
        ],
        good: '앞다리가 단단한 벽이 되어 회전 힘을 받아 주고 있어요.',
        fix: '앞무릎이 굽혀지며 힘이 새고 있어요. 착지 후 앞다리를 펴며 "벽"을 만드는 연습을 해 보세요.',
      });
    }
    {
      const s1 = lin(tiltRel, 5, 32), s2 = lin(extRel, 0.05, 0.6), s3 = lin(elbowRel, 110, 155);
      const score = Math.round(s1 * 0.4 + s2 * 0.3 + s3 * 0.3);
      items.push({
        key: 'release', name: '릴리스', weight: 20, score,
        metrics: [
          { label: '상체 앞 숙임', value: Math.round(tiltRel) + '°', tip: '목표 25~40°' },
          { label: '공 놓는 위치 (몸 앞)', value: extRel.toFixed(2) + '배', tip: '다리 길이 대비, 목표 0.5배 이상' },
          { label: '팔꿈치 각도', value: Math.round(elbowRel) + '°', tip: '목표 150° 전후' },
        ],
        good: '몸 앞쪽 멀리에서 상체를 덮으며 공을 놓고 있어요.',
        fix: tiltRel < 20 ? '상체가 서 있는 채로 공을 놓아요. 가슴을 앞무릎 위로 덮으며 던져 보세요.' : '공을 너무 몸 가까이에서 놓아요. 팔을 앞으로 길게 뻗어 포수 쪽에서 놓는다는 느낌으로 던져 보세요.',
      });
    }

    // 총점: 측정 불가 항목은 빼고 가중 평균
    const valid = items.filter((it) => it.score !== null);
    const wsum = valid.reduce((s, it) => s + it.weight, 0);
    const total = Math.round(valid.reduce((s, it) => s + it.score * it.weight, 0) / (wsum || 1));
    const grade = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';

    return {
      hand, dir, legLen, dt, total, grade, items,
      keyframes: { kneeLift: kl, footPlant: fp, release: rel },
      times: { kneeLift: F[kl].t, footPlant: F[fp].t, release: F[rel].t },
      series: { t: F.map((f) => f.t), hip: hipAng, sh: shAng, wrist: T.sp },
      frames: F,
      extra: { elbowFPh, shiftKL, pelvisPeakV, trunkPeakV },
    };
  }

  const api = { analyze, P };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PitchAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
