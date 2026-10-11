# PO Email Agent (po-email-agent)

요약
- 최근 N일(기본 30일)간 발송한 메일 중 회신을 받지 못한 주요 메일을 찾아 요약·표로 출력한다.
- Outlook Legacy 프로필의 Outlook.sqlite를 직접 읽어 빠르고 결정론적 분석을 수행한다.

주요 기능
- Sent 폴더(Record_FolderID=128)에서 기준 기간 내 발송 메일 수집
- 같은 Conversation ID로 Inbox(109)에 수신 항목이 있는지 확인하여 미수신(응답 없음) 판정
- **메일 본문 세그멘팅 (필수)**: olk15Message 파일(UTF-16-LE HTML)을 읽어 전체 텍스트를 추출한 뒤, `보낸사람:` / `보낸날짜:` / `From:` / `Sent:` 패턴으로 시작하는 블록을 각각 독립된 메일로 분리한다
  - 분리 기준 패턴: `보낸사람:`, `보낸 사람:`, `From:` (단독 행 시작)
  - 각 세그먼트에서 발신자, 날짜, 수신자, 본문을 파싱하여 시간순 정렬
  - olk15Message 경로: `~/…/Main Profile/Data/Messages/<N>/<UUID>.olk15Message` (DB의 PathToDataFile 기준)
- 핵심 의사결정·변화 추적을 표(마크다운)로 요약

## 이메일 스레드 분석 표준 절차 (항상 적용)

특정 메일 스레드를 분석할 때 **반드시** 아래 순서를 따른다:

### Step 1: DB에서 Conversation_ConversationID로 스레드 메일 목록 조회
```python
SELECT m.Record_RecordID, m.Record_FolderID,
       datetime(m.Message_TimeSent,'unixepoch','localtime'),
       m.Message_SenderAddressList, m.Message_Preview, m.PathToDataFile
FROM Mail m
WHERE m.Conversation_ConversationID = <conv_id>
ORDER BY m.Message_TimeSent ASC
```

### Step 2: 가장 최신(또는 가장 큰) olk15Message 파일에서 전체 체인 추출
```python
BASE = "~/…/Main Profile/Data/"
path = os.path.join(BASE, row["PathToDataFile"])
with open(path, 'rb') as f:
    raw = f.read()
# UTF-16-LE HTML 추출
html_start = raw.find('<html'.encode('utf-16-le'))
html_str = raw[html_start:].decode('utf-16-le', errors='ignore')
```

### Step 3: From:/보낸사람: 기준으로 세그멘팅
```python
import re
# 패턴: 줄 시작에 "보낸사람:", "보낸 사람:", "From:" 등장
SEG_PATTERN = re.compile(
    r'(?:^|\n)((?:보낸\s*사람|From)\s*[:：])',
    re.MULTILINE
)
segments = SEG_PATTERN.split(plain_text)
# 각 segment에서 날짜, 발신자, 수신자, 본문 파싱
```

### Step 4: 시간순 정렬 후 표 출력
| 번호 | 날짜/시간 | 발신자 | 수신자 | 핵심 내용 | 결정/요청 |
|---|---|---|---|---|---|

입출력
- 입력: 로컬 Outlook.sqlite (경로: ~/Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data/Outlook.sqlite)
- 출력: Markdown 요약(예: ./outputs/po_unanswered.md), CSV(예: ./outputs/po_unanswered.csv), 선택적 /tmp/mail_content.html (중간 아카이브)

실행 예시
- 직접 실행: python3 scripts/po_email_agent.py --days 30 --out ./outputs/po_unanswered.md --csv ./outputs/po_unanswered.csv
- tasks.sh: ./tasks.sh po-email-agent --days 30 --out ./outputs/po_unanswered.md --csv ./outputs/po_unanswered.csv

보안·운영 주의사항
- 완전한 로컬 작동: 외부 전송 없음(스크립트 기본 동작). 민감 데이터는 로컬에서만 보관·검토할 것.
- Outlook이 Legacy 모드여야 전체 DB가 읽힌다.
- olk15Message 파싱은 HTML/VML/이미지 노이즈를 포함할 수 있으니 결과를 검증할 것.

제한사항
- 외부 IMAP/Exchange API 사용 아님 — 로컬 DB 접근 권한이 필요함
- 일부 복잡한 포워드 체인(비표준 헤더)은 수동 보정 필요

관련 파일
- scripts/po_email_agent.py — 분석 스크립트
- AGENTS.md — 레지스트리 항목(간단 설명)
- .github/agents/po-email-agent.yaml — 에이전트 메타데이터

문의
- 소유자: nz@hyundai-autoever.com
- 추가 스케줄링(launchd/cron)이나 결과 보관 정책을 원하면 알려주세요.