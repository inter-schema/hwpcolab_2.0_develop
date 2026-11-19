import { diff_match_patch } from "diff-match-patch";
import {
  normalizeMemoryBody,
  parseMemorySections,
  serializeMemorySections,
} from "./frontmatter.ts";
import {
  MAX_CHARS_PER_DOC,
  MAX_INPUT_DOCS,
  MAX_TOTAL_INPUT_CHARS,
} from "./generate.ts";
import {
  computeSha256_8,
  maskMemorySourceText,
  scanAndRedactPii,
} from "./piiPatterns.ts";
import {
  FIXED_MEMORY_SECTIONS,
  type MemoryDoc,
  type MemorySectionTitle,
  type ProposeRefinementArgs,
  type ProposeRefinementResult,
  type SectionDiff,
  type SectionDiffToken,
  type SourceDocRef,
} from "./types.ts";

export const REFINE_SYSTEM_PROMPT = `당신은 한국어 공문서·보고서·업무 양식의 작성 스타일 가이드(메모리)를 정밀 개선하는 전문가입니다.
기존 메모리 내용을 바탕으로 사용자의 다듬기 지시사항 및 추가 참고 문서를 분석하여, 개선된 전체 마크다운 스타일 가이드를 작성하십시오.

[절대 준수 규칙]
1. 반드시 아래 7개 H2(##) 섹션 제목을 정확한 이름과 순서로 모두 출력하십시오(YAML frontmatter나 코드펜스는 출력하지 마십시오):
## 문서 유형·양식
## 어투·문체
## 용어·표기
## 서식·표 규칙
## 구조(제목 체계)
## 금지·지양
## 예시 문구(일반화됨)
2. 개인정보(실명, 주민번호, 전화번호, 이메일, 계좌번호, 주소 등)는 절대 인용하지 말고 일반화된 플레이스홀더(<이름>, <일자>, <금액> 등)만 사용하십시오.
3. 수정이 필요 없는 섹션도 기존 내용을 유지하여 7개 섹션 전체를 온전히 출력하십시오.`;

export function computeSectionDiffs(
  beforeBody: string,
  afterBody: string
): SectionDiff[] {
  const dmp = new diff_match_patch();
  const beforeSections = parseMemorySections(beforeBody);
  const afterSections = parseMemorySections(afterBody);

  return FIXED_MEMORY_SECTIONS.map((sectionTitle) => {
    const beforeContent = beforeSections[sectionTitle];
    const afterContent = afterSections[sectionTitle];

    const rawDiffs = dmp.diff_main(beforeContent, afterContent);
    dmp.diff_cleanupSemantic(rawDiffs);

    const tokens: SectionDiffToken[] = rawDiffs.map(([op, text]) => ({
      op: op as -1 | 0 | 1,
      text,
    }));

    const changed = beforeContent.trim() !== afterContent.trim();

    return {
      sectionTitle,
      beforeContent,
      afterContent,
      changed,
      tokens,
    };
  });
}

function buildDeterministicRefinedBody(
  currentBody: string,
  instruction: string,
  extraDocs: Array<{ name: string; text: string }>
): string {
  const sections = parseMemorySections(currentBody);
  const instr = instruction.trim();

  if (instr) {
    if (/어투|문체|존댓말|격식|개조식|종결/.test(instr)) {
      sections["어투·문체"] = `${sections["어투·문체"].trim()}\n- [다듬기 반영] ${instr}`;
    } else if (/표|서식|셀|정렬|줄\s*간격/.test(instr)) {
      sections["서식·표 규칙"] = `${sections["서식·표 규칙"].trim()}\n- [다듬기 반영] ${instr}`;
    } else if (/용어|표기|날짜|숫자|단위/.test(instr)) {
      sections["용어·표기"] = `${sections["용어·표기"].trim()}\n- [다듬기 반영] ${instr}`;
    } else if (/금지|지양|피해/.test(instr)) {
      sections["금지·지양"] = `${sections["금지·지양"].trim()}\n- [다듬기 반영] ${instr}`;
    } else if (/예시|문구/.test(instr)) {
      sections["예시 문구(일반화됨)"] = `${sections["예시 문구(일반화됨)"].trim()}\n- [다듬기 반영] ${instr}`;
    } else if (/구조|제목|번호\s*체계|목차/.test(instr)) {
      sections["구조(제목 체계)"] = `${sections["구조(제목 체계)"].trim()}\n- [다듬기 반영] ${instr}`;
    } else {
      sections["문서 유형·양식"] = `${sections["문서 유형·양식"].trim()}\n- [다듬기 반영] ${instr}`;
    }
  }

  if (extraDocs.length > 0) {
    const docNames = extraDocs.map((d) => d.name).join(", ");
    sections["문서 유형·양식"] = `${sections["문서 유형·양식"].trim()}\n- 추가 참고 문서 반영: ${docNames}`;
  }

  return serializeMemorySections(sections);
}

export async function proposeRefinement(
  args: ProposeRefinementArgs
): Promise<ProposeRefinementResult> {
  const hasInstruction = !!(args.instruction && args.instruction.trim().length > 0);
  const validExtraDocs = (args.extraDocs || []).filter(
    (d) => d && typeof d.text === "string" && d.text.trim().length > 0
  );

  if (!hasInstruction && validExtraDocs.length === 0) {
    throw new Error(
      "다듬기 지시사항을 입력하거나 추가 학습할 문서를 선택해 주세요."
    );
  }

  const warnings: string[] = [];
  let sanitizedInstruction = "";
  if (hasInstruction) {
    const scan = scanAndRedactPii(args.instruction!);
    sanitizedInstruction = scan.text;
    if (scan.totalCount > 0) {
      warnings.push(
        `지시사항에서 개인정보 패턴 ${scan.totalCount}건을 사전 비식별화했습니다.`
      );
    }
  }

  let docsToUse = validExtraDocs;
  if (docsToUse.length > MAX_INPUT_DOCS) {
    docsToUse = docsToUse.slice(0, MAX_INPUT_DOCS);
    warnings.push("추가 학습 문서는 최대 10개까지만 반영되었습니다.");
  }

  const extraSourceDocs: SourceDocRef[] = [];
  const processedDocs: Array<{ name: string; text: string }> = [];
  let inputRedactionCount = 0;
  let accumulatedChars = 0;

  for (const doc of docsToUse) {
    const sha256_8 = computeSha256_8(doc.text);
    extraSourceDocs.push({ name: doc.name, sha256_8 });

    let slicedText = doc.text;
    if (slicedText.length > MAX_CHARS_PER_DOC) {
      slicedText = slicedText.slice(0, MAX_CHARS_PER_DOC);
      warnings.push(
        `추가 문서 "${doc.name}"가 30,000자를 초과하여 앞부분만 반영되었습니다.`
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
        "추가 입력 텍스트가 80,000자 상한에 도달하여 일부 내용이 절단되었습니다."
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
      `추가 학습 문서에서 개인정보 패턴 ${inputRedactionCount}건을 사전 비식별화했습니다.`
    );
  }

  let rawRefinedContent = "";
  if (typeof args.provider?.turn === "function") {
    try {
      const promptParts: string[] = [
        `### [현재 작성 선호사항 가이드]\n${args.doc.body}`,
      ];
      if (sanitizedInstruction) {
        promptParts.push(`### [사용자 다듬기 지시사항]\n${sanitizedInstruction}`);
      }
      if (processedDocs.length > 0) {
        const extraDocsText = processedDocs
          .map((d, i) => `#### [추가 문서 ${i + 1}: ${d.name}]\n${d.text}`)
          .join("\n\n");
        promptParts.push(`### [추가 학습 예시 문서]\n${extraDocsText}`);
      }
      promptParts.push(
        "위 내용을 종합하여 현재 가이드의 7개 섹션을 개선한 완성본 마크다운을 작성해 주십시오."
      );
      const userPrompt = promptParts.join("\n\n");
      const resp = await args.provider.turn({
        systemPrompt: REFINE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        signal: args.signal,
      });
      rawRefinedContent = resp.content || "";
    } catch {
      rawRefinedContent = buildDeterministicRefinedBody(
        args.doc.body,
        sanitizedInstruction,
        processedDocs
      );
    }
  } else {
    rawRefinedContent = buildDeterministicRefinedBody(
      args.doc.body,
      sanitizedInstruction,
      processedDocs
    );
  }

  const normalized = normalizeMemoryBody(rawRefinedContent);
  const outputScan = scanAndRedactPii(normalized);
  if (outputScan.totalCount > 0) {
    warnings.push(
      `수정안 결과에 남은 개인정보 패턴 ${outputScan.totalCount}건(${outputScan.hits.join(", ")})을 플레이스홀더로 자동 치환했습니다.`
    );
  }

  const proposedBody = outputScan.text;
  const sectionDiffs = computeSectionDiffs(args.doc.body, proposedBody);

  return {
    proposedBody,
    sectionDiffs,
    warnings,
    extraSourceDocs,
  };
}

export function applySectionDecisions(
  doc: MemoryDoc,
  diffs: SectionDiff[],
  acceptedSectionTitles: string[],
  extraSourceDocs?: SourceDocRef[]
): MemoryDoc {
  const acceptedSet = new Set(acceptedSectionTitles);
  const diffMap = new Map(diffs.map((d) => [d.sectionTitle, d]));
  const existingSections = parseMemorySections(doc.body);

  const selectedMap = {} as Record<MemorySectionTitle, string>;
  for (const title of FIXED_MEMORY_SECTIONS) {
    const d = diffMap.get(title);
    if (d) {
      selectedMap[title] = acceptedSet.has(title)
        ? d.afterContent
        : d.beforeContent;
    } else {
      selectedMap[title] = existingSections[title];
    }
  }

  const mergedBody = scanAndRedactPii(serializeMemorySections(selectedMap)).text;

  const sourceDocMap = new Map<string, SourceDocRef>();
  for (const d of doc.meta.sourceDocs || []) {
    sourceDocMap.set(`${d.name}::${d.sha256_8}`, d);
  }
  for (const d of extraSourceDocs || []) {
    sourceDocMap.set(`${d.name}::${d.sha256_8}`, d);
  }

  const now = new Date().toISOString();
  return {
    meta: {
      ...doc.meta,
      sourceDocs: Array.from(sourceDocMap.values()),
      updatedAt: now,
      masked: true,
    },
    body: mergedBody,
  };
}
