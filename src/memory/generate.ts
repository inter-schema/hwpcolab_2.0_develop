import { normalizeMemoryBody } from "./frontmatter.ts";
import { computeSha256_8, maskMemorySourceText, scanAndRedactPii } from "./piiPatterns.ts";
import type {
  GenerateMemoryArgs,
  GenerateMemoryResult,
  MemoryDoc,
  SourceDocRef,
} from "./types.ts";

export const MAX_INPUT_DOCS = 10;
export const MAX_CHARS_PER_DOC = 30_000;
export const MAX_TOTAL_INPUT_CHARS = 80_000;

export const MEMORY_GENERATION_SYSTEM_PROMPT = `당신은 한국어 공문서·보고서·업무 양식의 작성 스타일과 규칙을 추출하는 전문가입니다.
제공된 예시 문서들의 공통 문체, 어투, 용어 표기, 서식·표 구성 규칙, 제목 번호 체계, 지양 표현을 분석하여 재사용 가능한 마크다운 스타일 가이드(메모리)를 작성하십시오.

[절대 준수 규칙]
1. 반드시 아래 7개 H2(##) 섹션 제목을 정확한 이름과 순서로 모두 출력하십시오(YAML frontmatter나 코드펜스는 출력하지 마십시오):
## 문서 유형·양식
## 어투·문체
## 용어·표기
## 서식·표 규칙
## 구조(제목 체계)
## 금지·지양
## 예시 문구(일반화됨)
2. 개인정보(실명, 주민번호, 전화번호, 이메일, 계좌번호, 주소, 기관 고유 사건번호 등)는 절대 원문 그대로 인용하지 마십시오. 예시 문구에는 반드시 <이름>, <부서명>, <일자>, <금액>, <주소>, <전화번호> 같은 일반화된 플레이스홀더만 사용하십시오.
3. 문서의 구체적 사실관계(특정 사업명·수치)가 아니라 '반복 적용할 작성 양식·문체·서식 규칙'만 간결한 개조식(- 항목)으로 정리하십시오.`;

/**
 * 로컬 문서들의 구조·어투·표·번호 체계를 결정론적 휴리스틱으로 분석하여 7개 표준 작성 메모리 섹션을 생성합니다.
 * 내장 클라우드 LLM API 키가 없어도 100% 로컬에서 동작하며, 생성된 메모리는 $HWP_WRITING_MEMORY_PATH를 통해
 * 에이전트 CLI(Claude Code, Gemini CLI, Codex 등)에 즉시 주입됩니다.
 */
export function buildDeterministicMemoryMarkdown(
  processedDocs: Array<{ name: string; text: string }>
): string {
  const combined = processedDocs.map((d) => d.text).join("\n");
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hasTable = combined.includes("|") || /표\s*\d+|항목|구분|세부내용|예산/.test(combined);
  const hasOfficialEndings = /(?:함|바랍니다|바람|임|됨|계획임)\.?$/m.test(combined);
  const hasRomanHeadings = /^[ⅠⅡⅢⅣⅤI1]\.\s+/m.test(combined);
  const hasHangulSubheadings = /^[가나다라마바사]\.\s+/m.test(combined);
  const hasLessonPlanTerms = /교수[·.]?학습|차시|학습목표|도입|전개|정리/.test(combined);
  const hasAdminReportTerms = /추진\s*배경|현황|세부\s*추진|기대\s*효과|행정|예산/.test(combined);

  const docTypeLabel = hasLessonPlanTerms
    ? "교육과정 교수·학습과정안 및 수업 설계 양식"
    : hasAdminReportTerms
    ? "공공·행정 기획안 및 업무 보고서 표준 양식"
    : "기관 표준 업무 보고서 및 공문서 양식";

  const toneBullet1 = hasOfficialEndings
    ? "- 명사형·개조식 종결 어미(~함, ~임, ~계획임, ~기 바람)를 일관되게 유지"
    : "- 간결하고 명확한 개조식 문장과 격식 있는 보고서 어투를 유지";

  const structureBullet1 = hasRomanHeadings || hasHangulSubheadings
    ? "- 행정안전부 공문서 표준 항목 기호 체계(1. → 가. → 1) → 가) → (1) → (가))를 준수"
    : "- 대제목 → 중제목 → 세부 항목 순의 계층적 문단 번호 체계를 유지";

  const sampleSentences = lines
    .filter((l) => l.length >= 12 && l.length <= 95 && !l.startsWith("|") && !l.startsWith("#"))
    .slice(0, 3)
    .map((l) =>
      l
        .replace(/\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?/g, "<일자>")
        .replace(/\d+(?:,\d{3})*(?:\.\d+)?\s*(?:원|억원|만원|명|%)/g, "<수치>")
    );

  return [
    "## 문서 유형·양식",
    `- 대상 문서 분류: ${docTypeLabel} (${processedDocs.map((d) => d.name).join(", ")})`,
    "- 상단 제목·기본 메타 정보 표와 본문 세부 항목이 결합된 구조 유지",
    "",
    "## 어투·문체",
    toneBullet1,
    "- 불필요한 수식어와 장황한 서술형 문장을 배제하고 핵심 조치·결과 중심으로 기술",
    "",
    "## 용어·표기",
    "- 날짜 표기는 'YYYY. M. D.' 또는 '<일자>' 표준 형식을 준수하고, 금액·수치는 천 단위 콤마(,)와 단위를 명시",
    "- 기관·부서·직위 명칭은 약칭 대신 공식 명칭을 우선 사용",
    "",
    "## 서식·표 규칙",
    hasTable
      ? "- 표 헤더 행(구분·항목·세부내용·비고 등)은 가운데 정렬 및 명확한 열 구분을 유지하고, 셀 내부 텍스트는 개조식으로 간결히 기재"
      : "- 핵심 요약 및 비교 데이터는 본문 서술 대신 정형화된 표(Table)로 구조화",
    "- 표 너비는 본문 폭에 맞추고 셀 여백과 줄 간격(160%)이 넘치지 않도록 관리",
    "",
    "## 구조(제목 체계)",
    structureBullet1,
    "- 각 수준별 들여쓰기(2타/4타/6타)를 계층에 맞게 정렬",
    "",
    "## 금지·지양",
    "- 실명·주민등록번호·전화번호·계좌번호 등 민감 개인정보(PII)의 원문 노출 금지",
    "- 모호한 추측성 표현(~일 것으로 보임, ~듯함) 및 비공식 구어체 표현 지양",
    "",
    "## 예시 문구(일반화됨)",
    ...(sampleSentences.length > 0
      ? sampleSentences.map((s) => `- "${s}"`)
      : [
          '- "<일자> 기준 <부서명> 소관 세부 추진 계획을 아래와 같이 보고함."',
          '- "향후 추진 일정 및 <수치> 규모 예산 집행 현황을 점검하여 차질 없이 이행할 계획임."',
        ]),
  ].join("\n");
}

export async function generateMemory(
  args: GenerateMemoryArgs
): Promise<GenerateMemoryResult> {
  const trimmedName = args.name?.trim();
  if (!trimmedName) {
    throw new Error("작성 선호사항 이름을 입력해 주세요.");
  }

  const validDocs = (args.docs || []).filter(
    (d) => d && typeof d.text === "string" && d.text.trim().length > 0
  );
  if (validDocs.length === 0) {
    throw new Error(
      "분석할 문서 텍스트가 없습니다. 내용이 있는 문서를 선택해 주세요."
    );
  }

  const warnings: string[] = [];

  let inputDocsToUse = validDocs;
  if (inputDocsToUse.length > MAX_INPUT_DOCS) {
    inputDocsToUse = inputDocsToUse.slice(0, MAX_INPUT_DOCS);
    warnings.push("최대 10개 문서까지만 반영되어 나머지 문서는 제외되었습니다.");
  }

  const sourceDocs: SourceDocRef[] = [];
  const processedDocs: Array<{ name: string; text: string }> = [];
  let inputRedactionCount = 0;
  let accumulatedChars = 0;

  for (const doc of inputDocsToUse) {
    const sha256_8 = computeSha256_8(doc.text);
    sourceDocs.push({ name: doc.name, sha256_8 });

    let slicedText = doc.text;
    if (slicedText.length > MAX_CHARS_PER_DOC) {
      slicedText = slicedText.slice(0, MAX_CHARS_PER_DOC);
      warnings.push(
        `"${doc.name}" 문서가 30,000자를 초과하여 앞부분만 반영되었습니다.`
      );
    }

    const masked = maskMemorySourceText(slicedText);
    inputRedactionCount += masked.totalCount;

    if (accumulatedChars + masked.text.length > MAX_TOTAL_INPUT_CHARS) {
      const allowed = MAX_TOTAL_INPUT_CHARS - accumulatedChars;
      if (allowed > 0) {
        processedDocs.push({
          name: doc.name,
          text: masked.text.slice(0, allowed),
        });
        accumulatedChars += allowed;
      }
      warnings.push(
        "전체 입력 텍스트가 80,000자 상한에 도달하여 일부 내용이 절단되었습니다."
      );
      break;
    } else {
      processedDocs.push({
        name: doc.name,
        text: masked.text,
      });
      accumulatedChars += masked.text.length;
    }
  }

  if (inputRedactionCount > 0) {
    warnings.push(
      `입력 문서에서 개인정보 패턴 ${inputRedactionCount}건을 사전 비식별화하여 추출했습니다.`
    );
  }

  // Try provider adapter only if an explicit adapter/key is supplied (e.g. unit test mock), otherwise use local deterministic analysis
  let rawGeneratedContent = "";
  if (args.provider && args.provider.apiKey && args.provider.apiKey.trim().length > 0) {
    try {
      const { createProviderAdapter } = await import("../services/agent/adapters/index.ts");
      const docsText = processedDocs
        .map((d, i) => `### [문서 ${i + 1}: ${d.name}]\n${d.text}`)
        .join("\n\n");
      const userPrompt = `아래 ${processedDocs.length}개 예시 문서들의 공통 작성 스타일, 어투, 용어 표기, 서식/표 규칙, 제목 체계, 지양 표현을 분석하여 마크다운 스타일 가이드(메모리)를 작성해 주십시오.\n\n${docsText}`;
      const adapter = createProviderAdapter(args.provider);
      const resp = await adapter.turn({
        systemPrompt: MEMORY_GENERATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        tools: [],
        toolChoice: "none",
        reasoningEffort: "medium",
        timeoutMs: 180_000,
        signal: args.signal,
      });
      rawGeneratedContent = resp.content || "";
    } catch {
      rawGeneratedContent = buildDeterministicMemoryMarkdown(processedDocs);
    }
  } else {
    rawGeneratedContent = buildDeterministicMemoryMarkdown(processedDocs);
  }

  if (!rawGeneratedContent || rawGeneratedContent.trim().length === 0) {
    throw new Error("작성 선호사항 규칙을 생성하지 못했습니다.");
  }

  const normalized = normalizeMemoryBody(rawGeneratedContent);
  const outputScan = scanAndRedactPii(normalized);
  const outputRedactionCount = outputScan.totalCount;

  if (outputRedactionCount > 0) {
    warnings.push(
      `생성 결과에 남은 개인정보 패턴 ${outputRedactionCount}건(${outputScan.hits.join(", ")})을 플레이스홀더로 자동 치환했습니다.`
    );
  }

  const now = new Date().toISOString();
  const doc: MemoryDoc = {
    meta: {
      schemaVersion: 1,
      id: `mem_${crypto.randomUUID()}`,
      name: trimmedName,
      description: (args.description || "").trim(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      sourceDocs,
      masked: true,
    },
    body: outputScan.text,
  };

  return {
    doc,
    warnings,
    inputRedactionCount,
    outputRedactionCount,
  };
}
