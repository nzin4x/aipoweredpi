# mytools — 팀 업무를 모아, 필요한 만큼만 AI

로컬 React PWA + Node.js + SQLite. PO/PM이 팀 전체 업무·일정을 수집하고 회의록·JIRA 초안·주간 보고로 연결합니다.
**수집·검색·검증·저장·시스템 이동은 코드. 요약·분류·의미 통합만 AI.**

## 0. 회사에서 이어받는 개발자 / 모델에게

README → TODO 순서로 읽으세요. 짧은 규칙은 AGENTS.md. ref 전체를 매번 읽거나 모델 프롬프트에 넣지 마세요. TODO의 P0부터 하나씩, 관련 모듈과 테스트만 확인하면 됩니다.

- 기준: 2026-10-09 KST. 회사 실제 연결·모델·단가·Outlook 스키마는 미검증.
- 검증: 단위/통합 35개 + 브라우저 13개. Windows 실제 자격 증명 관리자 긴 테스트 토큰 저장/복원/삭제 확인. macOS는 구현·모의 테스트만 완료, 실기 확인 필요. 실제 사내 Graph/HChat/JIRA를 호출한 검증은 아님.
- ref의 과거 .github 정의 21개는 참고 자료. 참조된 scripts/, tasks.sh, sync.sh는 이 프로젝트에 없습니다.
- 데모 응답은 고정 샘플이며 실제 요약 품질이나 모델 성능을 의미하지 않습니다.
- 우선 순서: 관심 채팅 1개 → 회사 모델 1개 → JIRA 조회 → Outlook 읽기 → 승인한 테스트 이슈 1개.

## 1. 실행·이관

Node.js **24 이상**, npm 필요. SQLite는 Node 내장 기능입니다.

    npm ci
    npm run build
    npm start

접속: **http://127.0.0.1:4310/**. 최초 데모 모드. 설치형 PWA도 로컬 서버가 실행 중이어야 합니다.

    npm run dev                      # API 4310 + UI 5173
    npm test                         # 임시/메모리 DB와 모의 API
    npx playwright install chromium
    npm run build
    npm run test:ui                  # 별도 4311, 메모리 DB
    npm run check                    # test → build → UI 테스트

### 옮길 파일

server/, src/, shared/, public/, test/, ref/, package*.json, vite.config.js, playwright.config.js, index.html, .env.example, .gitignore, AGENTS.md, README.md, TODO.md.

node_modules/, dist/, test-results/, playwright-report/, 개인 .env는 복사 불필요. 회사에서 승인된 npm 미러/패키지 반입 경로로 재설치·빌드. 현재 폴더는 Git 저장소로 초기화되지 않았습니다.

### 데이터·키

DB: data/mytools.sqlite (MYTOOLS_DATA_DIR로 위치 변경). 회사 데이터 이관은 별도 정책에 따릅니다. 실행 중 .sqlite 하나만 복사하면 WAL 변경이 빠질 수 있으므로 **서버 종료 후 DB와 WAL/SHM을 함께 보존하거나 SQLite backup API**를 사용하세요. data/와 .env는 Git 제외 대상입니다.

Graph 토큰은 UI 입력 후 **macOS Keychain / Windows 자격 증명 관리자**에 저장(기본 ON). 체크 해제하면 서버 세션 메모리만 사용. Graph는 .env에서 읽지 않습니다. LLM/JIRA 키는 종전대로 서버 메모리/선택적 환경변수이며 키체인 연동 범위는 현재 Graph입니다. 개인 .env는 배포본에 넣지 마세요. DB 본문은 암호화되어 있지 않으므로 OS 계정·디스크 암호화·회사 보존 정책이 필요합니다.

키체인 구현: [@napi-rs/keyring 공식 저장소](https://github.com/Brooooooklyn/keyring-node). 서비스명 `mytools.graph.<DB 절대경로 SHA256 앞 24자>`, 계정별 OS 자격 증명 저장소. 긴 토큰은 Windows 항목 크기 제한을 고려해 조각과 manifest 모두 키체인 안에 저장하며 파일로 내리지 않습니다. 앱 복사/DB 경로 변경/다른 PC에서는 토큰 재입력 필요. OS 잠금/정책/네이티브 모듈 오류는 화면에 표시, 평문 fallback 없음. 동일 OS 사용자 권한을 얻은 악성 프로그램까지 차단하는 별도 격리 장치는 아닙니다.

## 2. 사용자 업무 / 구현 상태

| 목적·화면 | 입력 → 처리 → 결과 | AI 호출 |
| --- | --- | --- |
| 데일리 브리핑 | 채팅·메일 후보 + 임박/지연 JIRA → 확인할 일 | 선택 요약 실행 시 |
| 방별 캐시 현황 | 전체 목록 → 관심 ON/OFF → 증분 캐싱 → 날짜 원문 | 방별 요약 실행 시 |
| 팀 업무 / 주간 | 직원 일일 기록 → 기간 조회 → 주간 보고 | 추출·보고 작성 시 |
| 회의록 만들기 | 대화록/VTT + 내 메모 + 안건 → 3개 섹션 | 통합 정리 시 |
| 이메일 → JIRA | 유형·등록 추천·초안 → 검토 → JIRA | 분류·초안 작성 시 |
| 카드 & 덱 | 질문·응답 보관 → 태그·중요도 → 선택 재사용 | 다음 요청 실행 시 |
| 수집 / JIRA 일정 | 채팅 주기·JQL·마감 필드 설정 | 없음 |
| 업무 가이드 | 지침 편집 → 새 버전 → 줄 diff | 저장·diff는 없음 |

아침 순서: Graph 토큰 → 전체 목록·관심 선택·캐싱 → Outlook 가져오기 → JIRA 일정 가져오기 → 브리핑 검토 → 필요한 요청만 AI/JIRA. **Outlook·JIRA 수집은 현재 수동**, 주기 실행은 Teams만 해당합니다.

브리핑은 로컬 캐시의 **미처리 후보**입니다. 화면을 여는 것만으로 유료 AI·외부 수집을 실행하지 않습니다. 후속 메시지 있음 ≠ 해결, 발언에서 빠짐 ≠ 완료.

## 3. Teams 관심 캐싱

    전체 채팅 목록 조회 → chats 갱신 (메시지는 아직 조회하지 않음)
      관심 OFF → 메시지 수집 안 함 / 기존 캐시·체크포인트 보존
      관심 ON  → 마지막 성공 watermark - 5분부터 수정 메시지 조회
        모든 페이지 성공 → watermark 전진
        실패·401 → watermark 유지 / 재실행으로 복구

- 새 방은 기본 OFF. 관심 설정은 계정별 SQLite 저장.
- OFF→ON 이후 **다음 수동/주기 실행**에서 비활성 기간 누락분을 수집. 체크만으로 즉시 실행하지 않음.
- 최초 선택 방은 조회 가능한 전체 히스토리. 보존 기간·권한 밖 데이터는 복구 불가.
- lastModifiedDateTime 필터·내림차순, ID upsert, 전체 nextLink 순회. 오래된 메시지 수정/삭제 표시 반영.
- Graph 외 호스트/리다이렉트 토큰 전달 금지. 429·일시 장애 제한 재시도, 방별 실패 격리.
- 성공 기준시각(watermark)은 완료한 수집의 **시작** 시각. 최근 메시지 시각·검토 위치와 다름.
- 검토 마커는 변경 순번. 옛 메시지 수정도 다시 미검토. 미리보기는 100건, 검토 버튼은 표시 순번까지 방 전체.
- 방별 일일 요약은 설정 시간대의 지정일 원문만. 95,000자 초과는 자동 누락 없이 오류.
- 채널·첨부 다운로드·타인의 비공개 채팅·완전한 삭제 reconciliation은 미지원.
- OFF는 데이터 삭제가 아니므로 과거 브리핑 후보는 유지됨.

### 주기·인증

수동 캐싱 버튼은 언제나 **Teams 연결 마법사**를 엽니다. Graph Explorer 열기 → 토큰 붙여넣기/키체인에서 불러오기 → /me 계정 확인 → 전체 방 조회·관심 선택 → 캐싱 시작 → 진행·결과·활동 이력까지 한 창에서 이어집니다. 유효한 현재 세션 사용도 명시적으로 선택할 수 있습니다. 데모는 토큰 없이 모의 흐름임을 표시합니다.

서버 시작 때 이 앱의 키체인 항목 존재 여부만 확인하며 Graph로 자동 전송하지 않습니다. **키체인 토큰 불러와서 다음**을 누르면 서버에서만 복원하여 Graph /me로 재검증합니다. 저장은 만료를 연장하지 않습니다. 401/만료 토큰은 재입력 안내, 자동 refresh 없음. 저장된 만료 토큰은 사용자가 교체하거나 **키체인 토큰 삭제**로 지웁니다. 삭제는 이 DB 경로에 연결된 Graph 항목만 제거하며 복구하려면 다시 입력해야 합니다. **Graph 연결 해제**는 메모리 세션만 해제합니다.

수집 / JIRA 일정에서 ON, 5~1,440분 (기본 30분). 실제 모드·당일 검증한 유효 Graph 세션·미실행 상태에서만 동작. 첫 tick은 최대 약 30초 후. 중복 실행 없음, AI 호출 없음. PC 절전·서버 종료 시 동작하지 않음. 401이면 세션 해제 후 재입력 대기. 재시작 후 키체인 복원 또는 토큰 재입력. PWA service worker 스케줄이 아닙니다.

Graph Explorer에서 직접 복사한 토큰 사용. User.Read·Chat.Read 위임 권한 및 회사 정책 승인 필요. /me로 검증, JWT exp는 표시 힌트. MSAL·refresh token·브라우저 토큰 자동 추출 없음. 토큰은 DB·로그·LLM에 저장/전송하지 않습니다.

## 4. 회의록·직원 업무·보고서

### 회의록

- 대화록/VTT: 화자·시각을 포함한 발언 근거. .vtt/.srt/.txt/.md 읽기 또는 붙여넣기.
- 내 메모: 애매한 명칭·전문용어의 우선 표기. 사실 충돌은 임의 해결 금지.
- 사전 안건: 목적·배경이며 실제 결정으로 간주하지 않음.
- 출력: **간단 요약 / Action Item / 상세**. Action Item은 체크리스트. 담당자·기한은 근거가 있을 때만.
- 녹음 자동 전사는 **미연결**. 전사 텍스트가 필요. 현재 회의 VTT는 화자·시각 원문을 보존하며 범용 cue parser는 없음.

### 직원별 일일 기록

직접 등록 또는 ‘대화록에서 직원 업무 추출’ → 기준 날짜·자료 → AI JSON → 검토·수정 → 로컬 일괄 저장.

필드: day, person, product, work, status, due, source.
상태: 예정/진행/차단/완료/확인 필요.
날짜 검증·실행 출처 연결·같은 비교 실행의 중복 저장 방지·데모/실제 분리.

인원 수를 제한하지 않지만 직원 명부·별칭 통합·매일 자동 추출·동일 업무 추적은 미구현. 현재는 **일일 증적 행**이지 영구 Task ID 기반 일정 엔진이 아닙니다. 기간별 기록을 코드로 조립하여 주간 보고 생성. 월간은 선택한 주간 결과 재사용. 4-Factor 자동 수집과 지난주 diff는 TODO.

## 5. Email → JIRA / 일정

Outlook SQLite를 읽기 전용으로 쿼리. 필수 별칭: id, thread_id, subject, sender, recipients, sent_at, body. 시간은 ISO. 최대 500건. 회사 OS/Outlook 버전별 스키마 설정 필요. Windows/New Outlook에 동일 DB가 있다고 가정하지 않습니다. Legacy olk15Message 체인 추출은 미이식.

메일/채팅 선택 후 AI가 category, shouldCreate, reason, summary, description JSON을 생성합니다.
유형: 장애/변경요청/온보딩/승인요청/문의/정보공유/기타.
등록 비추천도 표시. 실제 생성은 제목·설명·프로젝트·유형 검토 후 승인할 때만.
현재는 선택 자료 전체에서 초안 하나이므로 **업무별로 선택**하세요. 무인 전체 메일 분류·자동 등록은 미구현.

JIRA 생성: Bearer PAT, REST v2/v3, ai-powered-po 라벨. 결과ID·브리핑 원문 중복 방지.
불확실한 전송은 __pending__ 유지로 중복 재전송 차단. JIRA에서 ‘mytools source: 결과ID’ 검색 후 연결 복구(복구 UI TODO).

### JIRA 일정 조회

- Server/DC REST v2 검색. 기본 JQL: HMGHCLOUD/HCLOUDSR 미완료 팀 이슈.
- 날짜 기본 duedate, 사내 End Date는 customfield_10101로 변경. 조회 기준만 바꾸며 쓰지 않음.
- 전체 페이지 성공 후 원자적 캐시 교체. 실패 시 이전 스냅샷 유지. 10,000건 한도.
- JQL/필드 변경 후 이전 스냅샷을 새 기준으로 보여주지 않음. 다시 수집 필요.
- 완료 statusCategory 제외, 지연·오늘·설정 일수 이내 기한, 담당자·상태·링크 표시.
- Jira Cloud 검색, Epic/Component/담당자 지정, 기한 수정, 간트·종속 일정은 TODO.
- 브리핑 화면에는 후보/일정이 함께 표시되지만 AI 입력은 버튼별 분리. 통합 AI 브리핑은 TODO.

## 6. API·모델·문맥·예산

| 프로토콜 | 실제 호출 | 범위 |
| --- | --- | --- |
| OpenAI 호환 | Base URL + /chat/completions | messages, 텍스트, usage, 모델별 추론 매핑 |
| HChat / Anthropic 호환 | Base URL + /messages | Bearer, system 분리, max_tokens, content text, input/output usage |

사내 endpoint는 ref/agents/po-hchat.agent.md 참고. 마지막 /messages를 제외한 주소를 Base URL로 입력. Anthropic 직접 API의 x-api-key 인증은 별도 미지원. Anthropic 모드는 모델 추론 필드를 **미지원**으로 설정(네이티브 thinking/effort TODO). Gemini 네이티브 미지원, OpenAI 호환 게이트웨이는 가능.

기본 model ID와 단가는 데모 자리표시자. 회사 제공값으로 교체. 원격 HTTPS, localhost HTTP만 허용. 회사 CA는 NODE_EXTRA_CA_CERTS 등으로 등록하고 TLS 검증을 끄지 마세요. URL/프로토콜 변경 시 메모리 API 키 제거.

- 일반 업무 모델 1개 기본, 명시적 비교 최대 3개. 직접 모델 실험실은 비교 선택 기본. 업무별 선호·추론 저장.
- 기본 fresh(/clear), 모든 질문·응답은 카드 보관. 이어 묻기는 선택 1쌍, 덱은 순서대로 최대 20쌍. 조상 대화 자동 포함 없음.
- 해당 업무 가이드만 전송. 가이드 버전·내용과 실제 messages를 실행에 고정 저장. 가이드 수정은 새 버전, 줄 diff, 이전 버전 복사, 동시 편집 충돌 감지.
- 캐시 키: 프로토콜·endpoint·모드·모델·추론·전체 요청·단가. 동일 요청 재사용, ‘새로 비교’는 재호출.
- 월 예산 $400. 병렬 요청 전체 예상 비용 선예약 → usage 정산. 입력/출력 USD/1M. 출력에 포함된 추론 중복 과금 방지.
- usage 누락·타임아웃은 추정 비용 유지. Anthropic 캐시 과금이 있으면 단가 미매핑으로 추정 유지. 공급자 청구 상한은 보장하지 않음, 다른 앱 비용 미집계.
- 입력 100,000자, 전체 요청 180,000자, 가이드 20,000자. 긴 자료 자동 분할 TODO.

## 7. 구현 지도

### 태그 · 명령 팔레트 · 실행 보드

- **활동 이력 & 태그**: 기존 AI/코드 실행 + 도입 이후 서버에서 처리한 POST/PUT/DELETE 변경 요청을 하나의 목록으로 조회. 종류/작업명·모델 검색, 정확한 태그 필터, 50개씩 pagination. 각 실행/행동에 최대 12개 태그 저장. 채팅방·카드 태그와는 별도 메타데이터.
- 감사 이벤트는 작업명·모드·시작·종료·HTTP 결과만 기록. 토큰/키/요청·응답 본문/원격 오류 원문은 감사 로그에 기록하지 않음. AI 원문·결과는 기존 실행 저장소에서 상세 조회. 실행과 그것을 시작한 HTTP 요청은 별개로 표시. GET 조회·예산 추정·화면 이동/타이핑/로컬 다운로드는 기록 대상 아님. 이전 설정 변경 내역을 소급 생성하지 않음.
- **같은 작업 다시 준비**: AI는 원문·작성 기준·모델·추론·가이드 버전·명시적 문맥 선택을 복사하여 실행 화면으로 이동(자동 유료 호출 없음). 원래 포함한 카드/후보 참조가 현재 존재해야 하며 변경된 브리핑 후보 등은 현재 데이터를 다시 해석하므로 실행 전 확인. CODE/변경 요청은 해당 준비 화면으로 이동. 캐싱은 인증 마법사부터, JIRA 등록은 기존 결과·중복 여부 확인 후 별도 승인. 키/토큰을 재실행 입력에 복사하지 않음.

- **방별 캐시 현황 → 태그별 모아보기**: 채팅방 선택 후 쉼표로 태그 입력(방당 12개, 각 40자). 빈 입력 저장은 해당 방 태그 해제. 로컬 계정별 저장이며 Teams 서버 태그·관심 여부·체크포인트는 변경하지 않음. 태그는 대소문자를 구분하는 정확한 일치, 앞뒤 공백과 유니코드 폭만 정규화.
- 태그 선택 → 날짜 선택 → **태그 원문 모아보기** → 방별 원문 확인 → **방별 요약 배치에 담기**. 관심 OFF 방의 기존 캐시도 포함하며, 해당 날짜에 실제 캐싱된 원문만 사용. 빈 방은 배치에서 제외. 날짜는 설정 시간대 기준. 모아보기 최대 100개 방/전체 500,000자, 개별 방 하루 95,000자; 초과분을 조용히 잘라내지 않음.
- **Ctrl+P / ⌘P** 또는 상단 명령 검색: 업무·화면 검색, ↑↓/Enter 선택, Esc 닫기. 브라우저 인쇄 대신 앱 팔레트를 엶. 업무 선택은 입력/승인 준비 화면을 열며 유료 호출·JIRA 등록을 즉시 실행하지 않음. 다른 모달이 열린 동안 중복 팔레트는 열지 않음.
- 업무 화면에서 입력·모델·문맥·가이드 준비 후 **배치에 담기**. 실행 보드에서 모델/추론·동시 실행 수·예상 예약 비용 확인 후 **확인하고 배치 실행**. 업무 최대 12개, 업무별 모델 1~3개, 모델 요청 기준 동시 실행 1~3개. 한 번에 활성 배치 1개. 배치와 별도 AI 실행은 동시 시작 불가. 코드 수집은 병행 가능.
- 배치 초안은 브라우저 메모리(새로고침·모드 변경 시 삭제). 제출 이후에는 입력/문맥/가이드 버전/모델 설정을 고정하고 모든 요청 비용을 한 트랜잭션에서 예약한 뒤 서버가 실행. 화면 이동·브라우저 닫기는 중단하지 않지만 로컬 Node 서버/PC는 계속 실행되어야 함. 키는 서버 메모리에만 유지.
- 실행 보드: 배치 파이프라인 + 개별 AI 요청 + 코드 수집/등록 내역. 요청별 대기/실행/완료/실패, 생성·시작·종료, 실행 소요시간(큐 대기 제외), 입력/출력/총 토큰, 비용, 결과. 모델명을 누르면 입력·결과 상세, **결과 비교 / 후속 업무 열기**에서 선호 모델 선택/JIRA 초안 검토. AI 사용량 미제공·실패는 미확인, 데모는 모의, 캐시/코드는 0으로 구분.
- **대기 작업만 취소**는 전송 전 요청만 취소하여 예약 해제. 이미 실행 중인 호출은 끝까지 정산. 일부 실패는 다른 요청을 막지 않음. 서버 재시작은 미전송 배치 작업 취소, 전송 중 요청 uncertain + 예약 유지, 배치 interrupted. 자동 재시도 없음. 오래된 실행의 미기록 시각은 — 표시.
- 상태 1초 polling, 최근 배치 30개/개별 요청 100개/코드 실행 50개 표시(원본 DB는 보존). CI/CD 스타일 가시화이며 임의 agent CLI 실행, 의존성 DAG, 자동 외부 쓰기, 실시간 모델 스트리밍은 아님.

| 변경할 것 | 파일 |
| --- | --- |
| HTTP·검증·메모리 키·진입점 | server/index.js |
| Graph OS 키체인·연속 캐싱 UI | server/vault.js, src/TeamsWizard.jsx |
| 감사 이력·활동 태그·재실행 준비 | server/activity.js, src/ActivityPanel.jsx |
| DB·예산·upsert | server/store.js |
| Graph·관심·증분 | server/graph.js |
| 주기·JIRA 읽기·팀 기록·일자 | server/operations.js |
| 카드·덱·후보·검토 마커 | server/knowledge.js |
| 가이드·실행·모델 어댑터 | server/guides.js, ai.js, provider.js |
| Outlook·JIRA 등록 | server/outlook.js, jira.js |
| 초기 업무·프롬프트 | shared/workflows.js |
| 회의 입력·line diff | shared/text.js |
| 앱·실행·비교·설정 | src/main.jsx |
| 브리핑·카드·관심 방 | src/KnowledgePanels.jsx |
| 방 태그·날짜별 모아보기 | server/tags.js, src/RoomTagsPanel.jsx |
| 배치 예약·worker·실행 보드 | server/pipelines.js, src/PipelinePanel.jsx |
| Ctrl+P 명령 팔레트 | src/CommandPalette.jsx |
| 가이드·회의 입력·운영·팀 | src/OperationsPanels.jsx |
| 파랑 디자인 | src/blue.css, pipelines.css (base CSS 위 적용) |
| 테스트 | test/core.test.js, knowledge.test.js, operations.test.js, pipelines.test.js, mcp.test.js, browser/app.spec.js |

주요 DB: chats/messages→chat_preferences/chat_state/message_revisions, results→analysis_inputs/request_context/execution_guides→card_meta/decks, brief_items→brief_jira→jira_links, jira_cache/jira_snapshots, team_entries/team_imports, guide_versions.
태그는 chat_tags(account,chat_id,tag). 배치는 pipelines→pipeline_jobs→results. results.started/finished는 추가 컬럼 migration, 기존 데이터 보존. 배치 API: POST /api/pipelines/estimate, POST /api/pipelines, POST /api/pipelines/:id/cancel, GET /api/executions. 태그 API: PUT /api/rooms/tags, GET /api/rooms/collection?tag=&day=.

보안: loopback + Host/Origin 검사 + 변경 API 세션 CSRF. 원격 다중 사용자 서버 아님. 서비스 워커는 UI만 캐싱, /api 제외.

## 8. MCP·회사 점검

npm run mcp: 읽기 전용 stdio 도구 list_workflows, search_local_messages(20×2,000자), recent_reports(5×4,000자).
클라이언트에 node와 server/mcp.js 절대 경로, MYTOOLS_DATA_DIR 등록. 자유 SQL·쓰기·Claude CLI 자동 실행 없음. Claude 사용료는 이 앱 비용에 미포함.

| 증상 | 확인 |
| --- | --- |
| Teams 0건 | 목록 갱신 후 관심 ON |
| 401 / 403 | 토큰 재입력 / 권한·정책 |
| JIRA 비어 있음 | PAT·JQL·날짜 필드·v2 확인 후 수집 |
| 모델 400 | 프로토콜·model ID·추론/출력 필드 |
| 인증서 오류 | 회사 CA 등록, TLS 검증 해제 금지 |
| Outlook 실패 | 실제 OS 원본 형식·SQL 별칭 |
| pending 등록 | JIRA 성공 여부 확인, 무조건 재전송 금지 |

공식 참고: [Graph 변경 필터](https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0), [Jira Server 검색](https://developer.atlassian.com/server/jira/platform/rest/v10000/api-group-search/), [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Claude Messages](https://platform.claude.com/docs/en/api/http/messages). 사내 게이트웨이 규격이 우선입니다.
