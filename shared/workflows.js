export const workflows = [
  {id:'team-extract',title:'직원 일일업무 추출',subtitle:'발언과 메모를 검토 가능한 업무 기록으로.',category:'분석',icon:'inbox',description:'기준 날짜를 적은 스크럼 전사·메모·채팅을 입력합니다. AI가 직원별 업무 JSON을 추출하고 검토 후 팀 일일 기록에 저장합니다.',steps:[['code','자료 선택','날짜 · 스크럼 · 채팅'],['ai','업무 추출','담당자 · 상태 · 기한'],['human','JSON 검토','불명확한 항목 수정'],['code','일일 기록','주간 보고 입력으로 재사용']]},
  {id:'meeting',title:'회의록 만들기',subtitle:'대화록 · 내 메모 · 안건을 하나로.',category:'문서',icon:'mic',description:'대화록/VTT, 직접 적은 메모, 사전 안건을 구분해서 입력합니다. 애매한 용어는 내 메모를 우선하며 결정 사실은 근거로 확인합니다.',steps:[['code','자료 준비','3종 입력 · VTT 읽기'],['ai','통합 정리','용어 보정 · 결정 · 행동'],['human','회의록 검토','간단 요약 / Action Item / 상세'],['code','결과 저장','가이드 버전 · 카드']]},
  {id:'chat-daily',title:'채팅방 데일리 요약',subtitle:'한 방, 하루의 결정과 할 일.',category:'문서',icon:'teams',description:'관심 채팅의 지정일 캐시를 사용합니다. 참여자별 업무와 결정·미해결 요청을 정리합니다.',steps:[['code','일자 필터','방별 로컬 원문'],['ai','업무 정리','참여자 · 결정 · 요청'],['code','카드 저장','같은 입력 결과 재사용']]},
  { id:'briefing',title:'데일리 브리핑',subtitle:'오늘 확인할 일을 가볍게 정리하세요.',category:'분석',icon:'inbox',description:'로컬 캐시에서 코드로 모은 업무 후보 중 선택한 항목만 AI로 요약합니다. 완료 여부는 직접 확인합니다.',steps:[['code','후보 정렬','Teams 요청 · 메일 스레드'],['human','자료 선택','오늘 확인할 항목만'],['ai','브리핑 요약','우선순위 · 다음 행동'],['human','업무 처리','완료 · 제외 · JIRA 초안']] },
  { id:'ask',title:'새 질문',subtitle:'매번 빈 문맥에서 시작하는 짧은 업무.',category:'분석',icon:'report',description:'이전 대화는 자동으로 보내지 않습니다. 덱 선택 또는 이어 묻기를 할 때만 기록을 재사용합니다.',steps:[['human','질문 작성','기본 문맥 0개'],['ai','판단 · 정리','선택한 자료만 사용'],['code','카드로 기록','질문 · 응답 · 사용량']] },
  { id: 'teams-cache', title: 'Teams 채팅 캐싱', subtitle: '대화는 로컬에, 컨텍스트는 가볍게.', category: '수집', icon: 'teams', description: '내가 참여한 1:1·그룹·미팅 채팅의 메시지를 SQLite에 동기화합니다. 채널·첨부 파일 본문은 포함하지 않습니다.', steps: [ ['human','토큰 입력','브라우저에서 직접 붙여넣기'], ['code','Graph 조회','채팅 목록 · 페이지 순회'], ['code','변경분 저장','메시지 ID로 중복 제거'], ['code','로컬 검색','SQLite · LLM 호출 없음'] ] },
  { id: 'email-jira', title: '이메일 → JIRA', subtitle: '메일 속 요청을 실행 가능한 할 일로.', category: '분석', icon: 'mail', description: 'Outlook SQLite에서 가져온 메일을 선택해 이슈 초안을 만듭니다. 등록할 내용은 직접 검토합니다.', steps: [ ['code','메일 읽기','SQLite 읽기 전용 조회'], ['ai','요청 분석','선택한 메일만 구조화'], ['human','초안 확인','제목 · 설명 · 프로젝트'], ['code','JIRA 등록','확인한 초안만 REST API 호출'] ] },
  { id: 'unanswered', title: '미회신 메일 찾기', subtitle: '답을 기다리는 일, 답을 줘야 하는 일.', category: '분석', icon: 'inbox', description: '스레드의 마지막 발신자를 코드로 분류하고, 선택한 메일에 실제 답변이 필요한지 AI로 판단합니다.', steps: [ ['code','스레드 분류','마지막 발신자 · 경과일'], ['ai','답변 필요 판단','안내 메일과 요청 구분'], ['human','후속 업무 결정','확인할 항목 선택'] ] },
  { id: 'scrum', title: '데일리 스크럼 정리', subtitle: '발화에서 결정과 다음 행동으로.', category: '문서', icon: 'mic', description: 'VTT 또는 전사 텍스트에서 담당자·완료 업무·이슈를 정리합니다. 음성 파일 전사는 추후 연결합니다.', steps: [ ['code','전사 정리','VTT 타임스탬프 제거'], ['ai','핵심 추출','완료 · 예정 · 장애물'], ['code','결과 보관','근거와 함께 로컬 저장'] ] },
  { id: 'weekly', title: '주간 보고서', subtitle: '이번 주에 달라진 것에 집중하세요.', category: '문서', icon: 'report', description: '선택한 로컬 대화·메일 또는 붙여넣은 자료로 보고서를 만듭니다. Confluence·JIRA 직접 수집은 후속 연결입니다.', steps: [ ['code','자료 선택','필요한 기간 · 메시지만'], ['ai','보고서 작성','성과 · 이슈 · 다음 계획'], ['human','검토 및 사용','원문 근거 확인'], ['code','Markdown 저장','완성 결과 다운로드'] ] },
  { id: 'monthly', title: '월간 보고서', subtitle: '쌓인 기록을 한 달의 성과로.', category: '문서', icon: 'calendar', description: '주간 보고서와 근거 자료를 선택해 월간 성과를 정리합니다. 빠진 수치나 사실은 추정하지 않습니다.', steps: [ ['code','주간 결과 불러오기','로컬 실행 결과 재사용'], ['ai','월간 성과 정리','진척 · 리스크 · 다음 달'], ['human','최종 검토','수치와 사실 확인'] ] }
];
export const prompts = {
 'team-extract':'기준 날짜와 업무 자료에서 직원별 업무를 추출하세요. JSON 배열만 반환. 각 객체는 {"day":"YYYY-MM-DD","person":"명시된 담당자 또는 확인 필요","product":"프로덕트 또는 빈 문자열","work":"업무 내용","status":"예정|진행|차단|완료|확인 필요","due":"명시된 YYYY-MM-DD 또는 빈 문자열","source":"근거 메시지ID/발언"}. 기준 날짜가 없으면 배열을 비우고 담당자·기한은 추측하지 마세요. 발언자와 담당자를 혼동하지 마세요. 완료는 명시적 근거가 있을 때만. 최대 100건, 초과 시 임의 누락하지 말고 배열을 비워 입력 분할을 요구하세요.',
 meeting:'대화록, 직접 작성한 메모, 사전 안건을 합쳐 한국어 회의록을 작성하세요. 애매한 전문용어·명칭은 메모의 표기를 우선하되 사실 충돌을 임의로 해결하지 마세요. 안건은 배경이며 실제 논의·결정으로 간주하지 마세요. 출력은 정확히 # 간단 요약 / # Action Item / # 상세 순서. Action Item은 - [ ] 체크리스트이며 담당자·기한은 근거가 있을 때만 명시하세요. 불명확한 내용은 상세의 해당 항목에 확인 필요로 남기세요. 종결문보다 간결한 업무 bullet, 중첩은 1단계·4칸 들여쓰기. 참여자·일시를 추측하지 마세요.',
 'chat-daily':'선택된 한 채팅방의 하루 원문을 한국어로 요약하세요. 참여자별 업무 / 결정 / 남은 요청 순서로 작성하고 근거 메시지 ID를 남기세요. 발언자와 담당자를 혼동하지 마세요. 후속 발언이 있다는 것만으로 해결을 단정하지 마세요.',
 ask:'사용자의 짧은 업무 요청에 한국어로 간결하고 정확하게 답하세요. 제공된 자료에 없는 사실은 추정이라고 표시하세요.',
 briefing:'선택한 업무 후보만으로 오늘의 브리핑을 한국어로 작성하세요. 우선 확인할 일, 상대 회신 대기, 내가 결정할 일 순서로 정리하고 원문 ID 및 다음 행동을 적으세요. 요청 표현이나 마지막 발신자만으로 미처리를 확정하지 마세요. 기한과 우선순위를 임의로 확정하지 마세요.',
 'email-jira': '선택한 메일 또는 Teams 후보의 업무 유형을 분류하고 JIRA 이슈 초안 하나를 작성하세요. JSON만 반환: {"category":"장애|변경요청|온보딩|승인요청|문의|정보공유|기타","shouldCreate":true,"reason":"등록 추천 또는 비추천 근거","summary":"제목","description":"배경, 요청사항, 완료기준, 원문 ID"}. 정보공유·자동알림·실행할 요청 없음은 shouldCreate=false. 날짜·담당자·수치는 추측하지 마세요. 서로 다른 업무가 섞이면 분리 검토 필요를 reason에 쓰세요. 외부 등록은 사람이 승인합니다.',
 unanswered: '메일별로 답변 필요 여부, 기다리는 상대, 근거, 다음 행동을 한국어로 정리하세요. 마지막 발신자만으로 미회신을 확정하지 말고 자동 알림·참조 수신·다른 채널에서 해결했을 가능성을 구분하세요.',
 scrum: '스크럼 전사를 한국어로 정리하세요. 담당자별 완료한 일, 다음 할 일, 장애물, 결정사항을 구분하고 발화 근거를 남기세요. 언급하지 않은 기한·담당자를 만들지 마세요.',
 weekly: '제공된 자료로 한국어 주간 보고서를 작성하세요. 핵심 요약, 성과, 진행 중 업무, 리스크, 다음 주 계획 순서로 간결하게 작성하고 각 주요 항목에 원문 ID를 붙이세요. 근거 없는 진척률을 만들지 마세요.',
 monthly: '제공된 주간 보고서와 자료로 한국어 월간 보고서를 작성하세요. 성과, 목표 대비 진척, 미해결 이슈, 다음 달 계획을 정리하세요. 중복 성과는 합치고 수치·완료 여부는 근거가 있을 때만 쓰세요.'
};
export const defaultSettings = {
 mode: 'demo', monthlyBudget: 400, timezone: 'Asia/Seoul', baseUrl: 'https://api.openai.com/v1', maxOutputTokens: 1600,
 models: [
   { id:'fast', name:'빠른 모델', model:'company-fast-model', inputPrice:0.3, outputPrice:1.2, effortField:'', effortMap:{low:'low',high:'high',max:'max'}, tokenField:'max_completion_tokens' },
   { id:'balanced', name:'균형 모델', model:'company-balanced-model', inputPrice:1, outputPrice:5, effortField:'reasoning_effort', effortMap:{low:'low',high:'high',max:'max'}, tokenField:'max_completion_tokens' },
   { id:'deep', name:'심층 모델', model:'company-deep-model', inputPrice:3, outputPrice:15, effortField:'reasoning_effort', effortMap:{low:'low',high:'high',max:'max'}, tokenField:'max_completion_tokens' }
 ],
 preferences: {}, jira: { baseUrl:'', project:'', issueType:'Task', apiVersion:'2' },
 outlook: { path:'', query:'SELECT id, conversation_id AS thread_id, subject, sender, recipients, sent_at, body FROM messages LIMIT 500' }
};
