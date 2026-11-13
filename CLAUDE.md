# 투구 폼 분석기 — 작업 안내

- 사용자: 체육교사 이태성(마스터님). 답은 한국어로, "마스터님"으로 부른다.
- 공개 주소(GitHub Pages, main 브랜치 루트): https://master23wind-commits.github.io/pitch-analyzer/
- Claude 아티팩트 판(같은 앱): https://claude.ai/artifact/R4PVqJbdXeiUVvj6ndCPH2 — capabilities {downloads}. 수정하면 이 링크도 함께 다시 게시한다(publish_files, mode patch, index.html·analysis.js).

## 구조
- `index.html`: 화면·포즈 인식 실행·제구 기록·제출(결과 카드 PNG, 제출 코드)·선생님용 모으기(#teacher)
- `analysis.js`: 채점 엔진(키프레임 찾기, 5개 항목 점수). 기준값은 각 `lin(값, 나쁨, 좋음)` 호출에 있음.
- `mp/`: MediaPipe Pose 파일. `.data/.binarypb/.tflite`는 아티팩트 허용 확장자 때문에 `assets_data.wasm`, `graph_pb.wasm`, `landmark_full.wasm`으로 이름을 바꿨고 index.html의 `REN` 표로 연결.

## 주의
- 제출 코드 형식(`[투구평가]P1;…;확인값`)과 확인값 계산(`chk`)을 바꾸면 이전에 받은 코드가 ⚠로 보인다. 바꿔야 하면 버전(P2)을 올리고 두 형식을 모두 읽게 한다.
- 파일 저장: Claude 화면은 `claude.use('downloads')`, 일반 웹은 공유 시트 → 다운로드.
- 변경 내역은 Claude 프로젝트 문서 `claude/투구-폼-분석기.md`의 업데이트 기록에 최신이 위로.
