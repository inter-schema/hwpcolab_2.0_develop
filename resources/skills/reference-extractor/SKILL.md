---
name: reference-extractor
description: 다양한 참고자료 파일(.xlsx, .xls, .csv, .docx, .pdf, .hwp, .hwpx, .txt, .md, .json)에서 본문 텍스트와 표(Table) 데이터를 Zip-Bomb 보안 한도 내에서 정밀 추출하여 마크다운 또는 JSON으로 변환하는 에이전트 CLI 스킬입니다.
license: GPL-3.0-or-later
---

# Reference Extractor Skill (`ref-extract`)

한글(HWP/HWPX) 문서를 작성하거나 표 셀을 채울 때 외부 참고자료(엑셀 예산표, 워드 기획서, 기존 HWP/HWPX 공문서, PDF, CSV 등)를 구조화된 마크다운 및 표 JSON으로 추출하는 CLI 도구입니다.

## 1. 지원 파일 포맷 및 보안

- **스프레드시트 (`.xlsx`, `.xls`, `.csv`)**: 모든 시트(Sheet)의 행·열 데이터를 마크다운 표 및 2차원 배열 JSON으로 추출합니다.
- **워드 문서 (`.docx`)**: `word/document.xml`을 안전하게 압축 해제하여 문단과 표를 순서대로 추출합니다.
- **한글 문서 (`.hwp`, `.hwpx`)**: `claw-hwp` 추출 엔진과 연동하여 본문 및 표 구조를 추출합니다.
- **텍스트/데이터 (`.txt`, `.md`, `.json`)**: UTF-8 원문 및 구조화 데이터를 추출합니다.
- **Zip-Bomb 방어**: 압축 해제 시 총 용량 100MB, 엔트리 수 2,500개, 압축률 120배 한도를 강제하여 악성 압축 파일로부터 런타임을 보호합니다.

---

## 2. CLI 명령어 레퍼런스

```bash
# 단일 참고자료 파일을 마크다운으로 추출 (기본값)
ref-extract samples/demo_budget_ref.xlsx

# 복수 참고자료 파일을 JSON으로 일괄 추출
ref-extract samples/demo_budget_ref.xlsx samples/demo_official_report.hwpx --json

# 추출 결과를 파일로 저장
ref-extract samples/demo_budget_ref.xlsx --output /tmp/extracted_ref.md
```
