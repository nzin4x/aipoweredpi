# AI Agent 운영 기준 — hcloud-ai-powered-po

이 저장소는 hCloud Product 운영을 위한 AI 기반 PO 도구이다.  
주요 기능: 회의록 정리 / Confluence 양방향 동기화 + AI Merge / JIRA 티켓 생성·관리

---

## 1. 요청 유형별 진입점

사용자 요청이 들어오면 아래 표를 기준으로 진입점을 먼저 파악하고, 해당 파일만 읽어서 처리한다.

| 요청 유형 | 실행 명령 / 진입 파일 | 핵심 처리 스크립트 |
|-----------|----------------------|------------------|
| **데일리 스크럼 정리** | `/po-daily` 또는 "오늘 스크럼 정리해줘" | `report/daily vtt/YYYYMMDD.vtt` → `report/daily vtt/YYYYMMDD.md` |
| Confluence push (로컬→서버) | `./sync.sh [space-path]` | `scripts/confluence/sync_markdown_to_confluence.py` |
| Confluence pull (서버→로컬) | `./sync.sh pull [path]` | `scripts/confluence/pull_and_merge.py` |
| Confluence 문서 직접 읽기 | `atlassian.Confluence` + `.env` `CONFLUENCE_TOKEN` | REST API `GET /rest/api/2/content/{id}` |
| JIRA 조회·날짜 관리 | `./tasks.sh <command>` | `scripts/jira/task_manager.py` |
| JIRA 이슈 생성 (AI 직접) | `JiraClient._post('/rest/api/2/issue', ...)` | `scripts/jira/client.py` |
| 회의록 정리 | Markdown 파일 직접 편집 | 아래 §4 규칙 적용 |
| PO 주간회의록 자동 합성 | `./tasks.sh po-weekly-report ...` | `scripts/weekly_po_meeting_orchestrator.py` |
| Product 지식 정리 | `products/<name>/` 버킷 편집 | 아래 §6 버킷 규칙 적용 |

---

## 2. 인증 원칙

- 토큰은 항상 `.env`에서 읽는다. 코드·문서에 하드코딩 금지.
- 우선 순위: `.env` `CONFLUENCE_TOKEN` → 환경 변수 → `confluence-sync/*.local.json`
- JIRA 토큰: `.env` `JIRA_TOKEN`
- AI Merge: `.env` `ANTHROPIC_API_KEY` (미설정 시 difflib fallback)
- 읽기 작업에도 별도 임시 토큰 발급 금지 — 기존 경로 재사용.

---

## 2.5 PO Daily Scrum 워크플로우

### 개요

매일 아침 스크럼 녹음 VTT를 기반으로 일별 증적 노트를 생성하고, 다음날 미팅 브리핑을 준비한다.

```
report/daily vtt/
  YYYYMMDD.vtt    ← 원본 녹음 (보존, 수정 금지)
  YYYYMMDD.md     ← po-daily 자동 생성 증적 노트
```

`report/Daily Scrum Note.md` 는 2026년 7월 초까지의 과거 이력 아카이브. 신규 입력 중단.

### 출력 구조 (순서 고정)

```
# PO Daily Scrum — YYYY-MM-DD

## 나에게 온 요청 (조치 필요)      ← VTT에서 전승호에게 직접 멘션된 요청
## 오늘 업무 현황                   ← 담당자별 VTT 요약 표, D+N 포함
## 미회신 메일 (구두 확인 필요)     ← Outlook.sqlite 14일 이내 미회신 발신 메일
## 내일 미팅 브리핑                 ← 완료확인·지연추적·팔로업 가이드
```

### 내일 미팅 브리핑 생성 원칙

- **완료 여부 확인**: 오늘 "시작" / "예정"으로 언급된 단기 작업 → 내일 확인
- **지연 추적 (D+3 이상)**: 동일 업무가 3일+ 반복 언급된 경우 명시
- **미회신 메일 구두 확인**: D+5 이상 미회신 메일 → 스크럼에서 구두 확인 요청
- 브리핑은 전승호가 미팅 시작 전 1분 안에 읽을 수 있는 분량으로 유지

### D+N 계산

- 최초 VTT 언급일부터 오늘까지 영업일 카운트
- "완료", "배포 완료", "마무리" 등 완료 신호 감지 시 리셋
- 불명확하면 `?` 표기

### po-weekly-report와의 연계

- 주간 보고 **Factor 1 (Daily Scrum Factor)**: `report/daily vtt/*.md` 파일에서 해당 주 범위 수집
- 각 파일의 `## 오늘 업무 현황` 표를 담당자/프로덕트별로 병합하여 주간 요약 생성
- (기존 `Daily Scrum Note.md` 테이블 열 추출 방식은 폐기)

---

## 3. Confluence 동기화 규칙

### 3.1 Confluence 링크가 주어졌을 때

1. URL에서 `pageId` 추출
2. 로컬 `confluence/` 에 동일 문서가 있는지 확인
3. 없으면 REST API로 본문 읽기: `GET /rest/api/content/{pageId}?expand=body.storage`
4. 로컬 Markdown·회의록과 비교 분석 후 인라인 보강 — 바로 Confluence에 반영하지 않는다

### 3.2 문서 sync 구조

- `confluence/<space>/sync-base.json` — Space 접속 정보 (base_url, space_key 등)
- 각 Markdown 파일 frontmatter의 `confluence.page_id` — sync 정체성 기준 (파일명 아님)
- `confluence/<space>/<dir>/index.md` — 해당 디렉토리의 Confluence 컨테이너 페이지

### 3.3 # 개요 섹션

모든 Confluence 동기화 문서 본문 최상단에 필수 포함:

```markdown
# 개요

> **요약**: 문서 전체를 한 줄로 설명 (50자 이내, 한국어)
```

- pull/push 시 자동 갱신
- 변경 이력은 본문 미노출 — frontmatter `changelog` 필드에만 기록

### 3.4 pull 후 처리

- 충돌 시 파일 내 `<!--CONFLICT` 마커 수동 해결
- AI Merge 결과 검토 후 push (자동 push 금지)
- 회의록(`YYYYMMDD-` 제목 또는 `회의록` 태그)은 merge 없이 서버 버전으로만 현행화

---

## 4. 회의록 정리 규칙

### 4.0 PO 주간회의록 자동 생성 (4-Factor)

PO-meeting에 "주간회의록 정리해"를 요청하면 아래 4개 factor를 합성해 초안을 생성한다.

1. **Daily Scrum Factor**: `report/Daily Scrum Note.md`에서 주차 범위(week-start~+6일) 일간 노트를 추출
   - xlsx fallback: `--report-xlsx` 명시 시 xlsx 파일 사용 (DRM 파일은 Excel에서 먼저 열어둘 것)
2. **Mail Factor**: `po-email-agent` 실행 결과(`outputs/po_unanswered.md`)에서 주차 범위 메일 요약 추출
3. **Confluence Factor**: `confluence/*` 하위 `YYYYMMDD-*.md` 회의록을 주차 범위로 수집
4. **JIRA Factor**: JIRA에서 주간 변동 이슈를 프로덕트별로 분류
5. **지난주 대비 변경사항 추적 (필수)**: 직전 주 `hCloudPO주간업무.md`를 로드하여 `# 요약` 섹션과 비교
   - 각 Product bullet 끝에 `→ 변경: <내용>` 인라인 표기
   - 상태 이모지 변경 시 반드시 표기 (🟡→✅, 🟡→🔴 등)
   - 신규 항목: `→ 신규`, 완료/종료: `→ 완료` / `→ 종료`
   - 직전 주 파일 없으면 "초회 작성"으로 명시 후 계속 진행

실행 표준:

```bash
./tasks.sh po-email-agent --days 7 --out outputs/po_unanswered.md --csv outputs/po_unanswered.csv
./tasks.sh po-weekly-report \
  --base-day 2026-05-26 \
  --template "confluence/clouddevteam-private/22.회의록/20260526-hCloudPO주간업무.md" \
  --output "confluence/clouddevteam-private/22.회의록/20260526-hCloudPO주간업무.md"
```

주의:
- 자동 생성 결과는 초안이며, 담당자가 핵심 결정/리스크를 최종 검토 후 push한다.
- 주간회의록 파일은 기존 page_id를 유지하는 업데이트를 우선한다.

**출력 섹션 구조 (순서 고정, `# 액션 아이템` 없음):**
```
# 요약
# 미회신 메일 (구두 확인 필요)
# 상세
# 수집 데이터 (4-Factor Raw)
```

**요약 섹션 형식 (사용자 확인 완료):**
- 핵심 진행사항은 bullet outline 형식: `- **Product — [핵심 테마]** [진행]: 상세 내용`
- 상태 태그: [진행] / [완료] / [위험] / [진행→위험] (이모지 사용 금지)
- JIRA 이슈 키(HMGHCLOUD-xxx) 직접 노출 금지
- Product별 최소 1개 핵심 업무 포함 필수
- 표(Table) 형식 사용 금지 — bullet 형식 고정
- 각 bullet 끝에 `→ 변경: <내용>` 인라인 표기 (지난주 `# 요약`과 historical 비교)

**미회신 메일 섹션 (매주 필수):**
- 기준 주차에 발신한 hCloud 관련 메일 중 스레드 내 수신 답장이 없는 항목을 나열
- Outlook.sqlite `Threads_ThreadID` / `Conversation_ConversationID`로 답장 여부 판별
- 제외: JIRA/Confluence 자동알림, 스크럼 캘린더 초대, 알람 메일, Canceled/FW:/RE: 메일
- 형식: `- **제목** (발송일) → 수신자 — 미회신`
- 주간 미팅 시 PO가 구두로 확인 요청

**수집 데이터 원문 첨부 (필수):**
회의록 MD 파일 맨 하단에 `# 수집 데이터 (4-Factor Raw)` 섹션을 반드시 추가한다:
- Factor 1. Daily Scrum: 해당 주차 날짜 열만 추출한 표 (빈 행 제외)
- Factor 2. 이메일: 송수신 전체 (hCloud 관련, 백종묵 Confluence bulk/자동차 광고 제외)
- Factor 3. 참조 Confluence 회의록: 날짜·제목·링크 목록
- Factor 4. JIRA: 주간 변동 이슈 전체 표 (이슈키, 상태, 제목, 담당자, 업데이트일)

### 4.1 구조

주간 PO 회의록 본문은 반드시 4개 H1으로만 구성한다:

```
# 요약
# 미회신 메일 (구두 확인 필요)
# 상세
# 수집 데이터 (4-Factor Raw)
```

- 제목은 frontmatter `title` / `confluence.title` / 파일명으로 처리 — 본문에 H1 제목 없음
- `confluence.title` 형식: `YYYYMMDD-<제목>` (날짜 뒤 반드시 `-`)

### 4.2 요약 섹션 필수 항목

- 주제 / 기준 문서·링크 / 참석자 / 회의 목적 / 핵심 결정·쟁점 요약

### 4.3 형식 규칙

- 액션 아이템: `- [ ]` 체크리스트 형식
- 참석자: 한 줄 인라인 (`ICT팀(황원일·배춘기) / HAE팀(한문배·전승호)`)
- 중첩 bullet: **1단계 이하**로 제한 — Confluence 변환 시 depth 깨짐 방지
- 중첩 bullet indent: **4 spaces** 사용 — 2 spaces로는 Confluence에서 indent 미적용
- 문체: 종결형 서술 최소화, `항목: 핵심 내용` bullet 압축 우선
- 중첩 불가피 시 표(Table)로 대체

---

## 5. JIRA 이슈 관리 규칙

### 5.1 프로젝트 라우팅

| 트리거 | 프로젝트 | Issue Type | Component |
|--------|---------|------------|-----------|
| "ICT 포탈", "HCLOUDSR", "포탈 이슈 등록" 언급 | **HCLOUDSR** | GAIA (HCloud Portal) id=`17604` | GAIA Request id=`79409` |
| 일반 "이슈 만들어줘" 등 | **HMGHCLOUD** | 요청에 따름 | 요청에 따름 |

- 기본 assignee: `nz@hyundai-autover.com` (accountId: `1133664`)
- assignee 빠른 매핑:
  - 백종묵 / ine@hyundai-autoever.com → Jira name=`H199001107858`, key=`JIRAUSER122172`

### 5.2 읽기/쓰기 원칙

- 읽기(조회·검색): 사용자 확인 없이 실행 가능
- 쓰기(생성·수정·날짜 변경): 변경 내용 먼저 보여주고 확인 후 실행
- 이슈 삭제: 테스트 이슈 외 원칙적으로 수행 금지

### 5.1.1 `ai-powered-po` 라벨 필수 (모든 JIRA 관련 에이전트 공통 지침)

**AI-powered-po를 통해 생성되는 모든 JIRA 이슈에는 반드시 `ai-powered-po` 라벨을 포함한다.**

- `scripts/jira/client.py`의 `JiraClient.create_issue()`는 이 라벨을 자동으로 강제 추가한다 (호출부가 생략해도 누락되지 않음).
- `create_issue()`를 거치지 않고 `_post('/rest/api/2/issue', ...)`를 직접 호출하는 경우(예: `po-email2jira`처럼 Epic Link 등 추가 필드가 필요한 케이스), **payload의 `fields.labels`에 `"ai-powered-po"`를 반드시 포함**시킨다.
- 기존 라벨이 있는 이슈에 업데이트만 하는 경우 라벨을 건드리지 않는다 — 이 규칙은 **신규 생성** 시에만 적용된다.
- 이 지침은 `po-jira`, `po-email2jira`, `po-onboarding` 등 JIRA 이슈를 생성하는 모든 서브에이전트에 공통 적용된다.

### 5.2.1 이슈 제목(Summary) :: 상태 태그 규칙

모든 JIRA 이슈 업데이트 시 제목 끝에 현재 처리 상태를 `::` 뒤에 요약하여 반영한다.

- `::` 가 없으면 → 제목 끝에 `:: <상태 요약>` 추가
- `::` 가 이미 있으면 → `::` 뒤 내용을 새 상태 요약으로 교체
- 상태 요약은 **10~20자 이내 한국어**로 처리 결과를 명확히 표현
- 이슈 댓글 추가, 상태 전환, 필드 수정 등 **모든 쓰기 작업 시 적용**

```
# 예시
"Harbor Keycloak 연동 검토"                 → "Harbor Keycloak 연동 검토 :: ICT 최종 답변 완료"
"Harbor Keycloak 연동 검토 :: 협의 진행 중" → "Harbor Keycloak 연동 검토 :: ICT 최종 답변 완료"
```

summary 업데이트는 댓글·상태 전환과 **동일 실행 블록**에서 함께 처리한다.

### 5.3 날짜 기준

- **End Date** (`customfield_10101`) — BigGantt 기준, overdue 판정 기준
- Start Date: `customfield_11209`
- Due Date (`duedate`): 이메일 알림 전용 — 사용자가 "due date"라고 명시할 때만 조작

### 5.4 이슈 생성 표준 코드 패턴

이슈 생성은 반드시 `scripts/jira/client.py`의 `JiraClient.create_issue()`를 사용한다.  
AI가 `_post`를 직접 호출하지 않는다 — 항상 아래 패턴을 따른다.

```python
import sys
sys.path.insert(0, 'scripts')
from jira.client import JiraClient

c = JiraClient()

description = """h2. 배경

<배경 설명>

h2. 요건

<요건 설명>

h2. 개발 범위

* 항목1
* 항목2"""

result = c.create_issue(
    project_key="HCLOUDSR",          # 또는 "HMGHCLOUD"
    summary="이슈 제목",
    description=description,
    issuetype_id="17604",            # GAIA(HCloud Portal): 17604
    component_ids=["79409"],         # GAIA Request: 79409 (없으면 생략)
)
print(result["key"], result["url"])
```

**프로젝트별 issuetype_id / component_id 참조:**

| 프로젝트 | 용도 | issuetype_id | component_id |
|---------|------|-------------|-------------|
| HCLOUDSR | ICT 포탈(GAIA) 문의 | `17604` | `79409` |
| HMGHCLOUD | 일반 개발·운영 이슈 | 요청에 따름 | 요청에 따름 |

### 5.5 JIRA Description 마크업

JIRA `description`은 **JIRA Wiki Markup** 사용 (Markdown 아님):

```
h2. 섹션 제목
*굵게*, _기울임_
* 비순서 목록
# 순서 목록
{code}코드{code}
{{인라인 코드}}
```

표준 섹션 구성 (내용에 따라 필요한 것만 사용):

```
h2. 배경
h2. 요건 / 요청 내용
h2. 개발 범위
h2. 참고 / 배경 경위
```

---

## 6. Product 버킷 규칙

`products/<ProductName>/` 구조:

| 버킷 | 용도 |
|------|------|
| `01_inbox/` | 원본 보존 — 수정 금지 |
| `02_knowledge/` | 정리문·문맥·변경 이력 |
| `03_architecture/` | PlantUML 소스 |
| `04_status/` | 월간·분기 현황 보고 |
| `05_outputs/` | AI 생성 산출물 |
| `99_archive/` | 장기 보관 |

- 폴더 추가보다 메타데이터 확장 우선
- PlantUML 파일명: 목적 중심 (`sequence-login-v1.puml`)

---

## 7. Markdown 정리 규칙

- 이미지: `![alt](<relative/path.png>)` 표준 형식 — Obsidian `![[...]]` 형식 발견 시 자동 변환
- 이미지 경로: 해당 문서 기준 상대경로, `<...>`로 감싸기
- 워크스페이스 루트 기준 절대경로 사용 금지
- "정리해달라" 요청 시 이미지 상대경로 변환 기본 적용

---

## 8. 금지 사항

- 원본(`01_inbox/`) 재작성 시 원본 맥락 삭제 금지
- Product마다 임의 폴더 구조 생성 금지
- 이미지로만 지식 저장하고 텍스트 메타 생략 금지
- 토큰·민감 정보 코드·문서에 하드코딩 금지
- AI Merge 결과 자동 push 금지

---

## 9. draw.io 다이어그램 자동화 규칙

### 9.1 핵심 제약

Confluence는 **draw.io 플러그인 API를 통해 생성된 다이어그램만 렌더링**된다.  
단순 파일 첨부(`POST /rest/api/content/{id}/child/attachment`)로 올린 `.drawio` 파일은 drawio 매크로에서 표시되지 않는다.

### 9.2 Markdown 작성 문법

Markdown 파일에 아래 형식으로 draw.io 블록을 삽입한다. `sync.sh` 실행 시 자동으로 플러그인 API를 통해 업로드된다.

```
# 방식 1: XML 직접 내장 (AI 생성에 최적)
```drawio:my-diagram
<mxfile version="29.5.2">...</mxfile>
```

# 방식 2: 기존 .drawio 파일 참조 (파일명.drawio 가 같은 디렉토리에 있어야 함)
```drawio:my-diagram
```
```

- `sync.sh` 실행 시: XML이 `my-diagram.drawio`로 저장 → 플러그인 API로 업로드 → `drawio` 매크로 자동 삽입

### 9.3 draw.io 플러그인 API 순서

**신규 다이어그램 생성:**

```python
# Step 1: 빈 다이어그램 생성 (POST)
POST /rest/drawio/1.0/diagram/crud/{diagram_name}/{page_id}
Content-Type: application/json
Authorization: Bearer {CONFLUENCE_TOKEN}
X-Atlassian-Token: no-check

{"imageData": "<3x3 blank PNG base64>", "xml": "<mxfile>...빈 XML...</mxfile>"}
# → 응답: {"revision": 1, "attachmentId": ...}

# Step 2: 실제 내용으로 업데이트 (PUT)
PUT /rest/drawio/1.0/diagram/crud/{diagram_name}/{page_id}
{"imageData": "<PNG base64>", "xml": "<mxfile>...실제 XML...</mxfile>",
 "revision": 1, "overwriteChanges": true}
# → 응답: {"revision": 2, ...}
```

**기존 다이어그램 업데이트:**

```python
# Step 1: 현재 revision 조회 (GET)
GET /rest/drawio/1.0/diagram/crud/{diagram_name}/{page_id}
# → 응답: {"revision": N, ...}

# Step 2: 내용 갱신 (PUT) — 페이지 이력도 함께 생성됨
PUT /rest/drawio/1.0/diagram/crud/{diagram_name}/{page_id}
{"imageData": "<PNG base64>", "xml": "<mxfile>...신규 XML...</mxfile>",
 "revision": N, "overwriteChanges": true}
```

- `diagram_name`은 URL encode 필수 (`urllib.parse.quote(name, safe="")`)
- `imageData`는 3×3 blank PNG(`BLANK_PNG_B64` 상수)를 재활용해도 무방 — Confluence가 렌더링 시 재생성
- Bearer 토큰으로 인증 가능 (쿠키 불필요)

### 9.4 Confluence 매크로 Storage XML

```xml
<ac:structured-macro ac:name="drawio" ac:schema-version="1">
  <ac:parameter ac:name="border">true</ac:parameter>
  <ac:parameter ac:name="diagramName">{diagram_name}</ac:parameter>
  <ac:parameter ac:name="revision">{revision}</ac:parameter>
  <ac:parameter ac:name="simpleViewer">false</ac:parameter>
  <ac:parameter ac:name="width"/>
  <ac:parameter ac:name="links">auto</ac:parameter>
  <ac:parameter ac:name="tbstyle">top</ac:parameter>
  <ac:parameter ac:name="lbox">true</ac:parameter>
  <ac:parameter ac:name="diagramWidth">1200</ac:parameter>
  <ac:parameter ac:name="height">800</ac:parameter>
</ac:structured-macro>
```

- `revision` 파라미터는 썸네일 캐시 무효화용 — 최신 revision 값 사용 권장
- `make_drawio_macro(name, revision=N)` 함수가 이 XML을 생성

### 9.5 구현 위치

| 항목 | 파일 | 함수 |
|------|------|------|
| Markdown drawio 블록 파싱 | `scripts/confluence/sync_markdown_to_confluence.py` | `preprocess_drawio_blocks` |
| 플러그인 API 업로드 | 동일 | `upload_drawio_attachments` |
| 매크로 XML 생성 | 동일 | `make_drawio_macro` |
| 상수 (blank PNG) | 동일 | `BLANK_PNG_B64` |

### 9.6 로컬 draw.io 파일 업로드 절차

AI가 draw.io 다이어그램을 생성하거나 수정한 뒤 Confluence에 올리는 표준 절차:

1. Markdown 파일에 ` ```drawio:diagram-name ``` ` 블록으로 XML 작성
2. `./sync.sh confluence/<space>/<path>` 실행
3. 스크립트가 플러그인 API로 다이어그램 생성·갱신 후 페이지 본문에 매크로 삽입
4. Confluence에서 결과 확인 — 다이어그램이 렌더링되면 완료

> **주의**: `sync.sh` 없이 직접 `.drawio` 파일을 첨부 업로드하면 매크로가 렌더링되지 않는다.

---

## 6. Naming Standardization 규칙

### 6.1 표준화 원칙

- 모든 Product 이름은 최신 표준 명칭을 사용해야 한다.
- 표준 명칭은 `/asset/up-to-date/` 폴더 내 각각의 문서로 관리된다.
- 문서 작성 시 표준 명칭을 자동으로 적용하도록 AI Agent가 지원한다.

### 6.2 적용 방법

1. 문서 작성 또는 수정 시, AI Agent가 `/asset/up-to-date/` 폴더의 문서를 참고하여 표준 명칭을 확인하고 제안한다.
2. 기존 문서에서 표준 명칭이 아닌 경우, AI Agent가 수정 사항을 표시한다.
3. 표준 명칭은 Confluence, JIRA, Markdown 문서 등 모든 산출물에 일관되게 적용된다.

### 6.3 예외 처리

- 표준 명칭이 적용되지 않는 경우, 반드시 사유를 명시해야 한다.
- 예외 사항은 `/asset/up-to-date/` 폴더 내 문서에 기록하여 관리한다.

---

## 7. Ghost 블로그 관리 규칙

### 7.1 진입점

| 요청 유형 | 진입점 | 핵심 스크립트 |
|-----------|--------|--------------|
| 블로그 포스트 조회·수정 | `scripts/ghost/client.py` | Ghost Admin API |
| 포스트 목록 조회 | `GhostClient.list_posts()` | `GET /ghost/api/admin/posts/` |
| 포스트 업데이트 | `GhostClient.update_post()` | `PUT /ghost/api/admin/posts/{id}/` |

### 7.2 인증 원칙

- `GHOST_ADMIN_TOKEN` 은 `.env`에서만 읽는다. 코드·문서에 하드코딩 금지.
- 토큰 형식: `{id}:{secret}` (64자리 hex secret → HS256 JWT 서명)
- JWT payload: `{"iat": now, "exp": now+300, "aud": "/admin/"}`
- 헤더: `Authorization: Ghost <jwt>`, `X-Ghost-Version` 불필요

### 7.3 Ghost Admin API 기본 패턴

```python
import jwt, time, requests, re
from dotenv import load_dotenv; load_dotenv()
import os

raw = os.getenv("GHOST_ADMIN_TOKEN", "")
token_id, token_secret = raw.split(":", 1)

def make_token():
    iat = int(time.time())
    return jwt.encode({"iat": iat, "exp": iat+300, "aud": "/admin/"},
                      bytes.fromhex(token_secret), algorithm="HS256",
                      headers={"alg": "HS256", "typ": "JWT", "kid": token_id})

BASE = "https://cloud.hyundai-autoever.com/hcloud"
hdrs = lambda: {"Authorization": f"Ghost {make_token()}", "Content-Type": "application/json"}

# 포스트 목록
posts = requests.get(f"{BASE}/ghost/api/admin/posts/",
                     params={"limit": 20, "fields": "id,title,status,slug"},
                     headers=hdrs(), verify=False).json()["posts"]

# 포스트 업데이트 (HTML 방식)
post = requests.get(f"{BASE}/ghost/api/admin/posts/{post_id}/",
                    params={"formats": "html,lexical"}, headers=hdrs(), verify=False).json()["posts"][0]
modified_html = post["html"].replace("old text", "new text")
requests.put(f"{BASE}/ghost/api/admin/posts/{post_id}/",
             json={"posts": [{"html": modified_html, "updated_at": post["updated_at"]}]},
             headers=hdrs(), verify=False).raise_for_status()
```

### 7.4 운영 원칙

- **읽기**(포스트 조회·목록): 사용자 확인 없이 실행 가능
- **쓰기**(포스트 수정·생성): 변경 내용 미리보기 후 확인 받고 실행
- `updated_at` 필드를 PUT 시 반드시 포함 (충돌 방지)
- HTML 수정 후 PUT 하면 Ghost가 lexical 포맷으로 자동 변환
- SSL 인증서 검증 비활성화 필요 (`verify=False`) — 사내 도메인 특성
- `verify=False` 사용 시 `urllib3.disable_warnings()` 함께 호출

### 7.5 블로그 URL

- 사이트: `https://cloud.hyundai-autoever.com/hcloud`
- Admin API: `https://cloud.hyundai-autoever.com/hcloud/ghost/api/admin/`

