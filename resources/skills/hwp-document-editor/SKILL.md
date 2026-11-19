---
name: hwp-document-editor
description: 한글(HWP/HWPX) 문서 구조 검사(inspect), 레이아웃 오버플로우 진단(layout-check), 공문서 표준 서식 적용(official-format), 중첩 표 삽입(nested-table), 정적 정책 검증(lint-ops), 본문/표 편집(edit) 및 OWPML 패키징을 수행하는 에이전트 CLI 스킬입니다.
license: GPL-3.0-or-later
---

# HWP Document Editor Skill (`hwp-cli`)

HOP-Claw 워크스페이스의 내장 에이전트 CLI 터미널(Claude Code, Gemini CLI, Codex 등)에서 현재 열려 있는 한글 문서(`$HWP_STAGING_PATH`)를 안전하게 검사·편집·검증할 수 있는 표준 CLI 도구입니다.

## 1. 환경 변수 (자동 주입)

터미널 패널에서 명령을 실행할 때 다음 환경 변수가 자동으로 주입됩니다:
- `$HWP_STAGING_PATH`: 현재 에디터에서 편집 중인 스테이징 문서 경로 (`.hwpx` 또는 `.hwp`). `hwp-cli`에서 파일 경로 인자를 생략하면 기본값으로 `$HWP_STAGING_PATH`를 사용합니다.
- `$HWP_ORIGINAL_PATH`: 원본 문서 경로.
- `$HWP_WRITING_MEMORY_PATH`: 현재 활성화된 **작성 메모리(Writing Memory)** 및 PII 보호 컨텍스트 마크다운 파일 경로.
- `$HWP_SELECTION_JSON`: 에디터에서 사용자가 선택한 영역(표 셀 범위 또는 본문 단락 범위)의 JSON 메타데이터.
- `$HWP_SKILLS_DIR`: 스킬 루트 디렉터리 (`/resources/skills`).

> **중요**: `$HWP_STAGING_PATH` 파일을 수정하면 HOP-Claw 에디터가 파일 변경을 즉시 감지하여 **`rhwp-studio` 시각적 문서 비교(Diff) 엔진**을 활성화합니다. 사용자는 변경 전/후 문단 및 표 셀을 비교한 뒤 **[수락]** 또는 **[반려]**할 수 있습니다.

---

## 2. CLI 명령어 레퍼런스

### 2.1 문서 구조 및 텍스트/표 조회 (`inspect`)
```bash
# 현재 스테이징 문서의 마크다운 요약 출력
hwp-cli inspect --markdown

# 문단 인덱스, 표(중첩 표 포함) 행/열 좌표, 셀 텍스트를 JSON으로 출력
hwp-cli inspect --json

# 표 구조 및 셀 좌표(tableIndex, depth, row, col, text)만 요약 출력
hwp-cli inspect --tables
```

### 2.2 레이아웃 및 표 셀 오버플로우 진단 (`layout-check`)
`@rhwp/core` WASM 레이아웃 엔진으로 페이지 수, 용지 규격, 표 셀 바운딩박스 및 셀 텍스트 줄바꿈/오버플로우 위험 셀을 진단합니다.
```bash
hwp-cli layout-check
```

### 2.3 편집 연산 정적 검증 (`lint-ops`)
편집 연산 JSON을 실제 문서에 반영하기 전에 좌표 유효성, 중첩 표 크기 제한(1x1 ~ 8x8), 빈 문자열 여부 등을 정적 검증합니다.
```bash
hwp-cli lint-ops --ops '[{"type":"set_cell_text","tableIndex":0,"row":1,"col":1,"text":"검토 완료"}]'
```

### 2.4 문서 편집 적용 (`edit`)
고수준 통합 편집 연산(`set_cell_text`, `insert_nested_table`, `set_paragraph_text`, `replace_body_text`, `append_paragraph`) 또는 `hwpx-edit.js` 네이티브 연산을 스테이징 문서에 적용합니다.
```bash
# 표 셀 텍스트 수정 + 문단 추가
hwp-cli edit --ops '[
  {"type":"set_cell_text","tableIndex":0,"row":0,"col":1,"text":"2026년 AI 행정 혁신안"},
  {"type":"append_paragraph","text":"3. 기대 효과: 문서 작성 시간 60% 단축"}
]'
```

### 2.5 표 안에 표(중첩 표) 삽입 (`nested-table`)
HWPX 문서의 특정 표 셀(`tableIndex`, `row`, `col`) 내부에 지정된 크기의 중첩 표(`<hp:tbl>`)를 삽입합니다.
```bash
# 표 #0의 (행 1, 열 1) 셀 내부에 2행 3열 중첩 표 삽입
hwp-cli nested-table --table 0 --row 1 --col 1 --rows 2 --cols 3
```

### 2.6 행정안전부 공문서 표준 서식 검사 및 자동 교정 (`official-format`)
행정안전부 공문서 작성 규격(개요 번호 위계 `1. → 가. → 1) → 가) → (1) → (가) → ①`, 줄간격 160%, 표준 본문 글꼴 및 표 헤더 서식)을 진단하고 자동 교정합니다.
```bash
# 공문서 규격 준수 여부 진단 리포트 출력
hwp-cli official-format

# 공문서 표준 줄간격(160%) 및 개요 번호/서식 자동 적용
hwp-cli official-format --apply
```

### 2.7 새 문서 생성 (`create`)
```bash
hwp-cli create --output /tmp/new_report.hwpx --title "2026년 업무 보고서"
```

---

## 3. 권장 에이전트 작업 루프 (Inspect → Lint → Edit → Layout-Check)

1. **맥락 확인**: `$HWP_WRITING_MEMORY_PATH`가 존재하면 먼저 읽어 기관 양식·어투·용어 규칙과 PII 마스킹 토큰(`{{PII_PERSON_1}}` 등) 보존 규칙을 숙지합니다.
2. **구조 파악**: `hwp-cli inspect --json` 또는 `hwp-cli inspect --tables`로 문단 번호(`paraIndex`)와 표/셀 좌표(`tableIndex`, `row`, `col`)를 확인합니다.
3. **편집 실행**: `hwp-cli edit --ops '...'` 또는 `hwp-cli nested-table ...`로 스테이징 문서(`$HWP_STAGING_PATH`)를 패치합니다.
4. **레이아웃 검증**: `hwp-cli layout-check`를 실행하여 셀 오버플로우나 의도치 않은 페이지 넘김이 없는지 확인합니다.
