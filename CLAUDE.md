# 투구 폼 분석기 — 작업 안내

- 사용자: 체육교사 이태성(마스터님). 답은 한국어로, "마스터님"으로 부른다.
- 공개 주소(GitHub Pages, main 브랜치 루트): https://master23wind-commits.github.io/pitch-analyzer/
- Claude 아티팩트 판(같은 앱): https://claude.ai/artifact/R4PVqJbdXeiUVvj6ndCPH2 — capabilities {downloads}. 수정하면 이 링크도 함께 다시 게시한다(publish_files, mode patch, index.html·analysis.js).

## 구조
- `index.html`: 화면·포즈 인식 실행·제구 기록·제출(결과 카드 PNG, 제출 코드)·선생님용 모으기(#teacher)
- `analysis.js`: 채점 엔진(키프레임 찾기, 5개 항목 점수). 기준값은 맨 위 `STD` 표(ref = 85점 A 한가운데)와 `SPREAD`(점수 간격)에 있음.
  - 기준(2026-11-13): 마스터님이 준 "보통 중학생 A 수준" 영상 2편(IMG_2405, IMG_2406, 측면·세로 4K 60fps 손으로 들고 촬영)을 각각 2번 분석한 평균. SPREAD 2.8, 결과 88~89점·81~82점(둘 다 A).
  - 초보 배려(2026-11-16): 기준보다 못한 쪽은 SPREAD_LOW 4로 더 완만하게, 항목 최저 FLOOR 40점. 피드백은 80점 미만이면 "고칠 점" 표시.
  - 키프레임: 보폭 최대 순간 → 그 전후 던지는 손목 최고속(골반 기준, 카메라 이동 상쇄)=릴리스 → 릴리스 전 0.7초 안 보폭 90% 도달=착지 → 착지 전 1.5초 안 앞무릎 최고=다리 들기.
  - '골반-어깨 분리'는 단일 카메라 깊이 추정으로 측정이 안 돼 '몸통 회전'(릴리스 때 어깨가 골반보다 더 돈 각도)으로 바꿈. 회전 순서는 최고속 시점이 아니라 '돌기 시작'(최고속 30%) 시점 비교.
  - 영상 장면 고르기: 프레임 경계를 피하려고 1/120초 뒤로(SEEK_OFS), 분석 전 pose.reset() — 같은 영상 반복 시 점수 차 1점 안팎.
  - 기준 영상의 관절 데이터로 다시 맞출 때: 앱에서 analyze 입력(frames)을 저장해 node로 STD를 바꿔 가며 확인.
- `mp/`: MediaPipe Pose 파일. `.data/.binarypb/.tflite`는 아티팩트 허용 확장자 때문에 `assets_data.wasm`, `graph_pb.wasm`, `landmark_full.wasm`으로 이름을 바꿨고 index.html의 `REN` 표로 연결.

## 주의
- 제출 코드 형식(`[투구평가]P1;…;확인값`)과 확인값 계산(`chk`)을 바꾸면 이전에 받은 코드가 ⚠로 보인다. 바꿔야 하면 버전(P2)을 올리고 두 형식을 모두 읽게 한다.
- 파일 저장: Claude 화면은 `claude.use('downloads')`, 일반 웹은 공유 시트 → 다운로드.
- 변경 내역은 Claude 프로젝트 문서 `claude/투구-폼-분석기.md`의 업데이트 기록에 최신이 위로.
