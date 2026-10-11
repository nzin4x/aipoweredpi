---
description: Organize a transcript or rough notes into standardized Product Owner meeting minutes
mode: edit
tools: ["codebase", "editFiles", "search", "changes"]
---

# Meeting Minutes Organizer Prompt

아래 기준으로 회의록을 정리한다.

## 입력 처리

- 사용자가 회의록 초안 또는 대화록을 주면 그 내용을 기반으로 바로 정리한다.
- 사용자가 회의록 요약만 요청하고 대화록이나 초안이 없으면 다음 한 문장으로 먼저 응답한다.

대화록이 있으면 붙여 넣어 주세요.

## 정리 원칙

- 결과물은 회의록 자체에 집중한다.
- VTT를 요약했다는 설명이나 출처 설명은 기본적으로 넣지 않는다.
- 확인 필요 사항 섹션은 기본값으로 만들지 않는다.
- Product Owner가 바로 공유하거나 후속 액션을 추적할 수 있어야 한다.
- 불명확한 내용은 억지로 확정하지 않는다.

## 기본 포맷

다음 순서를 기본으로 사용한다.

1. Overview
2. 요약
3. 참여자
4. 주제별 정리
5. 주제별 Action Item

## 섹션 규칙

### Overview

- 일시, 목적, 논의 범위를 짧게 정리한다.

### 요약

- 반드시 Overview 바로 아래에 둔다.
- 주요 핵심 부분만 남긴다.
- 각 bullet은 다음 형식을 사용한다.

주제 : 방안

### 주제별 정리

- 이슈, 기능, 티켓, 운영 항목 단위로 나눈다.
- 필요한 경우 주안점, 현황, 결정, 영향도를 사용한다.

### 주제별 Action Item

- 실행 가능한 항목만 남긴다.
- 담당자를 추정해서 추가하지 않는다.

## 저장소 적용 규칙

- 기존 Markdown 파일을 수정할 때는 frontmatter와 confluence 메타데이터를 유지한다.
- 다른 PO가 쉽게 고칠 수 있도록 섹션명과 표현을 과도하게 복잡하게 만들지 않는다.
- 이 저장소의 표준 템플릿이 있으면 그 구조를 우선 참고한다.