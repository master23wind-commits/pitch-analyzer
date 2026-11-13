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
  // ===== 채점 기준표 =====
  // 2026-11-13 마스터님이 "보통 중학생, A 수준"이라고 준 영상 2편(IMG_2405, IMG_2406)을 각각 2번씩 분석한 측정 평균을 ref로 삼음.
  // ref = 이 값이면 85점(A 한가운데), bad = 이 값이면 0점. 그 사이는 직선, ref를 넘으면 100점까지 올라감.
  const STD = {
    stride:  { bad: 0.6,  ref: 1.53, unit: '배' },  // 착지 순간 보폭 ÷ 다리 길이
    shift:   { bad: 0.2,  ref: 0.74, unit: '%' },   // 릴리스 때 골반 위치 (뒷발 0 → 앞발 1)
    turn:    { bad: 0,    ref: 33,   unit: '°' },   // 릴리스 때 어깨가 골반보다 더 돌아 나온 각도 (몸통 회전)
    lead:    { bad: -60,  ref: 70,   unit: 'ms' },  // 골반이 몸통보다 먼저 돌기 시작한 시간
    kneeChg: { bad: -75,  ref: -39,  unit: '°' },   // 착지 → 릴리스 앞무릎 각도 변화
    kneeRel: { bad: 95,   ref: 140,  unit: '°' },   // 릴리스 때 앞무릎 각도
    tilt:    { bad: -15,  ref: 12.5, unit: '°' },   // 릴리스 때 상체 앞 숙임
    ext:     { bad: -0.1, ref: 0.49, unit: '배' },  // 릴리스 때 손목이 골반보다 앞선 거리 ÷ 다리 길이
    elbow:   { bad: 100,  ref: 161,  unit: '°' },   // 릴리스 때 팔꿈치 각도
  };
  // SPREAD: 점수 간격 조절. 클수록 학생 간 점수 차이가 완만해짐 (A 기준 영상 2편이 모두 A가 되도록 2.8)
  const SPREAD = 2.8;
  const band = (v, k) => { const { bad, ref } = STD[k]; const b0 = ref - (ref - bad) * SPREAD; return lin(v, b0, b0 + (ref - b0) / 0.85); };
  const refTxt = (k, f) => 'A 기준 ' + (f ? f(STD[k].ref) : STD[k].ref + STD[k].unit);
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

    const hipC = (f) => mid(pt(f, P.LH), pt(f, P.RH));
    const secs = (x) => Math.max(1, Math.round(x / dt));
    const range = (a, b) => { const o = []; for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) o.push(i); return o; };
    const argmax = (idx, fn) => idx.reduce((best, i) => (fn(i) > fn(best) ? i : best), idx[0]);

    // ① 보폭이 가장 넓은 순간 = 던지는 동작의 중심 (같은 프레임 안의 두 발 거리라 카메라가 움직여도 안전)
    const sepRaw = F.map((f) => Math.abs(pt(f, P.LA).x - pt(f, P.RA).x) / legLen);
    const sepS = sepRaw.map((v, i) => (sepRaw[i - 1] ?? v) * 0.25 + v * 0.5 + (sepRaw[i + 1] ?? v) * 0.25);
    const iS = argmax(range(0, n - 1), (i) => sepS[i]);

    // ② 손목 속도: 골반 중심 기준(카메라 이동 상쇄), 순간이동 같은 튐은 잘라냄
    const relSpeed = (k) => F.map((f, i) => {
      if (i === 0) return 0;
      const a = pt(f, k), b = pt(F[i - 1], k), ha = hipC(f), hb = hipC(F[i - 1]);
      const v = Math.hypot((a.x - ha.x) - (b.x - hb.x), (a.y - ha.y) - (b.y - hb.y)) / legLen / dt;
      return Math.min(v, 45);
    });
    const sR = relSpeed(P.RW), sL = relSpeed(P.LW);
    const relWin = range(iS - secs(0.25), iS + secs(0.6));
    let hand = opts.hand;
    if (!hand || hand === 'auto') hand = Math.max(...relWin.map((i) => sR[i])) >= Math.max(...relWin.map((i) => sL[i])) ? 'R' : 'L';
    const T = hand === 'R'
      ? { S: P.RS, E: P.RE, W: P.RW, H: P.RH, K: P.RK, A: P.RA, lS: P.LS, lH: P.LH, lK: P.LK, lA: P.LA, sp: sR }
      : { S: P.LS, E: P.LE, W: P.LW, H: P.LH, K: P.LK, A: P.LA, lS: P.RS, lH: P.RH, lK: P.RK, lA: P.RA, sp: sL };
    // T.S/E/W/H/K/A = 던지는 쪽(뒷발 쪽), lS/lH/lK/lA = 앞발 쪽

    // ③ 릴리스: 보폭 최대 순간 전후에서 던지는 손목이 가장 빠른 순간
    const rel = argmax(relWin, (i) => T.sp[i]);

    // ④ 앞발 착지: 릴리스 전 0.7초 안에서 보폭이 최대치의 90%에 처음 도달한 순간
    const fpWin = range(rel - secs(0.7), rel);
    const sepMaxBefore = Math.max(...fpWin.map((i) => sepS[i]));
    let fp = fpWin.find((i) => sepS[i] >= 0.9 * sepMaxBefore);
    if (fp === undefined || fp >= rel) fp = Math.max(0, rel - 2);

    // ⑤ 다리 들기 최고점: 착지 전 1.5초 안에서 앞무릎이 뒷발목보다 가장 높이 올라간 순간
    const klWin = range(fp - secs(1.5), fp);
    const kl = argmax(klWin, (i) => (pt(F[i], T.A).y - pt(F[i], T.lK).y));

    // 던지는 방향: 착지 순간 뒷발 → 앞발
    const dir = Math.sign(pt(F[fp], T.lA).x - pt(F[fp], T.A).x) || 1;

    // ---------- 측정 ----------
    // 1) 체중이동 (모두 같은 프레임 안의 상대 위치)
    const stride = Math.abs(pt(F[fp], T.lA).x - pt(F[fp], T.A).x) / legLen;
    const shiftAt = (i) => { const r = pt(F[i], T.A).x, fr = pt(F[i], T.lA).x; return (hipC(F[i]).x - r) / (fr - r || 1e-6); };
    const shiftKL = shiftAt(kl), shiftRel = shiftAt(rel);

    // 2) 골반-어깨 분리 & 회전 (월드 좌표의 수평면 각도)
    const hasW = F.every((f) => f.wl);
    let leadMs = null, sepFP = null, sepMax = null, pelvisPeakT = null, trunkPeakT = null, pelvisPeakV = null, trunkPeakV = null;
    let hipAng = [], shAng = [];
    if (hasW) {
      const ang = (f, a, b) => deg(Math.atan2(f.wl[b].z - f.wl[a].z, f.wl[b].x - f.wl[a].x));
      const unwrap = (arr) => { const o = [arr[0]]; for (let i = 1; i < arr.length; i++) o.push(o[i - 1] + wrap(arr[i] - arr[i - 1])); return o; };
      hipAng = unwrap(F.map((f) => ang(f, P.LH, P.RH)));
      shAng = unwrap(F.map((f) => ang(f, P.LS, P.RS)));
      // 몸통 회전: 회전 방향 기준으로 어깨선이 골반선보다 더 돈 각도 (3프레임 중앙값으로 튐 제거)
      const rotDir = Math.sign(hipAng[Math.min(n - 1, rel + 1)] - hipAng[fp]) || 1;
      const tw = hipAng.map((h, i) => rotDir * (shAng[i] - h));
      const twm = tw.map((v, i) => [tw[i - 1] ?? v, v, tw[i + 1] ?? v].sort((a, b) => a - b)[1]);
      sepFP = twm[fp];
      sepMax = Math.max(...[rel - 1, rel, rel + 1].filter((i) => i >= 0 && i < n).map((i) => twm[i]));
      const vel = (a) => a.map((v, i) => (i === 0 ? 0 : Math.abs(v - a[i - 1]) / dt));
      const vH = vel(hipAng), vS = vel(shAng);
      const smv = (a) => a.map((x, i) => (a[i - 1] ?? x) * 0.25 + x * 0.5 + (a[i + 1] ?? x) * 0.25);
      const vHs = smv(vH), vSs = smv(vS);
      const s0 = Math.max(1, fp - Math.round(0.15 / dt)), s1 = Math.min(n - 1, rel + 1);
      let ph = s0, ps = s0;
      for (let i = s0; i <= s1; i++) { if (vHs[i] > vHs[ph]) ph = i; if (vSs[i] > vSs[ps]) ps = i; }
      pelvisPeakT = F[ph].t; trunkPeakT = F[ps].t; pelvisPeakV = vHs[ph]; trunkPeakV = vSs[ps];
      // 돌기 시작한 시점: 착지 이후 각자 최고 속도의 30%를 처음 넘는 순간 (프레임 사이는 보간)
      const onset = (v, peakI) => {
        const th = v[peakI] * 0.3;
        for (let i = Math.max(1, fp); i <= peakI; i++) if (v[i] >= th) { const a = v[i - 1], b = v[i]; return F[i - 1].t + ((th - a) / ((b - a) || 1)) * dt; }
        return F[peakI].t;
      };
      leadMs = Math.round((onset(vSs, ps) - onset(vHs, ph)) * 1000);
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

    // ---------- 점수 (기준표 STD 사용) ----------
    const items = [];
    {
      const s1 = band(stride, 'stride'), s2 = band(shiftRel, 'shift');
      const score = Math.round(s1 * 0.5 + s2 * 0.5);
      items.push({
        key: 'weight', name: '체중이동', weight: 25, score,
        metrics: [
          { label: '보폭 (다리 길이 대비)', value: stride.toFixed(2) + '배', tip: refTxt('stride') },
          { label: '릴리스 때 골반 위치', value: Math.round(clamp(shiftRel, -1, 2) * 100) + '%', tip: '뒷발 0% → 앞발 100%, ' + refTxt('shift', (v) => Math.round(v * 100) + '%') },
        ],
        good: '뒷발에서 앞발로 체중을 힘 있게 옮기고 있어요.',
        fix: s1 < s2 ? '보폭이 짧아요. 앞발을 던지는 방향으로 한 발 더 멀리 내딛어 보세요.' : '골반이 앞발 쪽으로 충분히 이동하지 못했어요. 앞발 착지 후 배꼽을 포수 쪽으로 밀어 주세요.',
      });
    }
    {
      const score = sepMax === null ? null : Math.round(band(sepMax, 'turn'));
      items.push({
        key: 'turn', name: '몸통 회전', weight: 20, score,
        metrics: [
          { label: '릴리스 때 어깨가 골반보다 더 돈 각도', value: sepMax === null ? '-' : Math.round(sepMax) + '°', tip: refTxt('turn') },
        ],
        good: '골반 위에서 몸통이 힘차게 돌아 나오며 공을 던지고 있어요.',
        fix: '몸통이 덜 돌아서 팔로만 던지고 있어요. 공을 놓을 때 뒤쪽 어깨가 앞으로 끝까지 돌아 나와 가슴이 포수를 향하도록 던져 보세요.',
      });
    }
    {
      const score = leadMs === null ? null : Math.round(band(leadMs, 'lead'));
      items.push({
        key: 'seq', name: '관절 회전 순서', weight: 20, score,
        metrics: [
          { label: '회전 순서', value: leadMs === null ? '-' : leadMs > 15 ? '골반 → 몸통 ✓' : leadMs >= -15 ? '거의 동시 △' : '몸통이 먼저 ✗', tip: '골반이 먼저 돌기 시작' },
          { label: '골반이 먼저 돈 시간', value: leadMs === null ? '-' : leadMs + 'ms', tip: refTxt('lead') },
        ],
        good: '하체 → 골반 → 몸통 → 팔 순서로 힘이 잘 전달돼요.',
        fix: '골반과 몸통이 동시에(또는 몸통이 먼저) 돌아요. "엉덩이 먼저, 어깨는 나중에" 순서를 의식해 보세요.',
      });
    }
    {
      const change = kneeRel - kneeFP;
      const score = Math.round(band(change, 'kneeChg') * 0.6 + band(kneeRel, 'kneeRel') * 0.4);
      items.push({
        key: 'block', name: '앞다리 버팀', weight: 15, score,
        metrics: [
          { label: '착지 → 릴리스 무릎 변화', value: (change >= 0 ? '+' : '') + Math.round(change) + '°', tip: '+면 펴짐, -면 굽혀짐 · ' + refTxt('kneeChg') },
          { label: '릴리스 때 무릎 각도', value: Math.round(kneeRel) + '°', tip: refTxt('kneeRel') },
        ],
        good: '앞다리가 단단한 벽이 되어 회전 힘을 받아 주고 있어요.',
        fix: '앞무릎이 많이 굽혀지며 힘이 새고 있어요. 착지 후 앞다리로 버티며 "벽"을 만드는 연습을 해 보세요.',
      });
    }
    {
      const s1 = band(tiltRel, 'tilt'), s2 = band(extRel, 'ext'), s3 = band(elbowRel, 'elbow');
      const score = Math.round(s1 * 0.4 + s2 * 0.3 + s3 * 0.3);
      const worst = Math.min(s1, s2, s3);
      items.push({
        key: 'release', name: '릴리스', weight: 20, score,
        metrics: [
          { label: '상체 앞 숙임', value: Math.round(tiltRel) + '°', tip: refTxt('tilt') },
          { label: '공 놓는 위치 (몸 앞)', value: extRel.toFixed(2) + '배', tip: '다리 길이 대비, ' + refTxt('ext') },
          { label: '팔꿈치 각도', value: Math.round(elbowRel) + '°', tip: refTxt('elbow') },
        ],
        good: '몸 앞쪽 멀리에서 상체를 덮으며 공을 놓고 있어요.',
        fix: worst === s1 ? '상체가 서 있는 채로 공을 놓아요. 가슴을 앞무릎 위로 덮으며 던져 보세요.'
          : worst === s2 ? '공을 너무 몸 가까이에서 놓아요. 팔을 앞으로 길게 뻗어 포수 쪽에서 놓는다는 느낌으로 던져 보세요.'
          : '팔꿈치가 굽은 채로 공을 놓아요. 팔을 채찍처럼 끝까지 펴며 던져 보세요.',
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
      extra: { elbowFPh, shiftKL, pelvisPeakV, trunkPeakV, leadMs, sepFP },
    };
  }

  const api = { analyze, P, STD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PitchAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
