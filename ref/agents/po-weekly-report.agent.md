# PO Weekly Report Agent (po-weekly-report-agent)

요약
- PO-meeting 요청 1회로 4개 입력 소스를 병렬 수집하고, 주간회의록 초안을 자동 생성한다.
- 입력 소스: 데일리 스크럼 노트(Markdown), PO 메일 요약, Confluence 회의록, JIRA 주간 변동.

4-Factor Workflow
1) Daily Scrum Factor (주 소스)
- 입력 (우선): report/daily vtt/YYYYMMDD.md — po-daily가 생성한 일별 증적 파일
  - 해당 주 범위(week-start~+6일)에 해당하는 YYYYMMDD.md 파일 전체 수집
  - 각 파일의 `## 오늘 업무 현황` 표에서 담당자/프로덕트/업무 행 추출
  - 같은 담당자의 여러 날 항목을 시계열로 병합하여 주간 흐름 요약
- 입력 (fallback): report/Daily Scrum Note.md — 7월 초 이전 과거 이력 아카이브
  - daily vtt/*.md 파일이 해당 주차에 없을 경우에만 사용
  - 처리: 해당 날짜 열 필터 후 Product/담당/업무 요약 라인 생성
- fallback: --report-xlsx 지정 시 xlsx 파일로 대체 (DRM 파일은 Excel에서 먼저 열어둘 것)

2) Mail Factor
- 입력 생성: po-email-agent 실행 결과 (outputs/po_unanswered.md, outputs/po_unanswered.csv)
- 처리: 주간 범위 메일만 추출해 핵심 제목/수신자 중심 요약

3) Confluence Factor
- 입력: confluence/* 하위 날짜 prefix(YYYYMMDD-) 문서
- 처리: 주간 범위 회의록 목록화(주간보고 파일 제외)

4) JIRA Factor
- 입력: JIRA JQL (기본: [HAE] hCloud 고도화 updated >= -7d)
- 처리: 주간 변동 이슈를 프로덕트별로 분류

5) 지난주 대비 변경사항 추적 (필수)
- 입력: 직전 주 hCloudPO주간업무.md (날짜 기준 자동 탐색)
- 처리: 지난 주 `# 요약` 섹션의 Product별 항목과 이번 주 항목을 비교
- 출력: `# 요약` 각 Product bullet 끝에 변경 사항을 `→ 변경: <내용>` 형식으로 인라인 표기
  - 지난주 대비 상태 이모지 변경 시 반드시 표기 (🟡→✅, 🟡→🔴 등)
  - 신규 Product 항목이면 `→ 신규` 표기
  - 완료/종료된 항목이면 `→ 완료` 또는 `→ 종료` 표기
- 직전 주 파일을 찾지 못하면 "지난주 파일 없음 (초회 작성)" 으로 명시하고 계속 진행

합성
- 템플릿 파일(예: 20260519-hCloudPO주간업무.md) 하단에 자동 요약 섹션을 append
- 출력 파일(예: 20260526-hCloudPO주간업무.md) 생성

출력 섹션 구조 (# 액션 아이템 없음, 순서 고정)
```
# 요약
# 미회신 메일 (구두 확인 필요)
# 상세
# 수집 데이터 (4-Factor Raw)
```

요약 섹션 형식 규칙 (사용자 확인 완료)
1. 핵심 진행사항: bullet outline 형식 사용 (표 금지)
   - 형식: `- **Product — [핵심 테마]** [진행]: 상세 내용 → 변경: <지난주 대비>`
   - 상태 태그: [진행] / [완료] / [위험] / [진행→위험] 등 (이모지 금지)
   - JIRA 이슈 키(HMGHCLOUD-xxx) 직접 노출 금지
   - Product별 최소 1개 핵심 업무 포함 필수
   - 각 bullet 끝에 `→ 변경:` 인라인 표기 (지난주 파일 `# 요약`과 비교, historical 누적 맥락 유지)

2. 미회신 메일 섹션 (매주 필수)
   - 발신 메일(기준 주차) 중 Outlook 스레드에 수신 답장 없는 항목을 나열
   - 쿼리 방법: Outlook.sqlite Threads_ThreadID 또는 Conversation_ConversationID로 답장 여부 확인
   - 제외: JIRA/Confluence 자동알림, 스크럼 캘린더 초대, 알람 메일, Canceled/FW:/RE: 메일
   - 형식: `- **제목** (발송일) → 수신자 — 미회신`
   - 구두 확인이 필요한 항목이므로 주간 미팅 시 PO가 직접 언급

3. 수집 데이터 원문 첨부: 회의록 MD 파일 하단에 반드시 "# 수집 데이터 (4-Factor Raw)" 섹션 추가
   - Factor 1. Daily Scrum: 해당 주차 날짜 열만 추출한 표 (빈 행 제외)
   - Factor 2. 이메일: 송수신 전체 (hCloud 관련, 백종묵 Confluence bulk 제외)
   - Factor 3. 참조 Confluence 회의록: 링크 포함 목록
   - Factor 4. JIRA: 주간 변동 이슈 전체 표 (이슈키, 상태, 제목, 담당자, 업데이트일)

실행 예시
- 메일 요약 먼저 생성
  - ./tasks.sh po-email-agent --days 7 --out outputs/po_unanswered.md --csv outputs/po_unanswered.csv
- 주간 보고 생성 (Daily Scrum Note.md 사용 — 기본)
  - ./tasks.sh po-weekly-report --base-day 2026-05-26 --template "confluence/clouddevteam-private/22.회의록/20260526-hCloudPO주간업무.md" --output "confluence/clouddevteam-private/22.회의록/20260526-hCloudPO주간업무.md"
- xlsx fallback 명시 시
  - ./tasks.sh po-weekly-report --base-day 2026-05-26 --report-xlsx "report/Product 담당자별 데일리스크럼 통합기록 (hcloud 관련부).xlsx" --template "..." --output "..."

관련 파일
- scripts/weekly_po_meeting_orchestrator.py
- report/Daily Scrum Note.md
- scripts/po_email_agent.py
