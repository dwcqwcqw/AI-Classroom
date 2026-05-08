/**
 * Build a bounded excerpt of PDF-derived text for LLM prompts.
 * Long PDFs were previously truncated from the start only, which drops later chapters (e.g. §5.3).
 */

const ANCHOR_PATTERNS: RegExp[] = [
  /5\s*\.\s*3[^\n]{0,48}图的遍历/,
  /5\s*\.\s*3[、.\s][^\n]{0,40}/,
  /第\s*5\s*[章节][^\n]{0,24}5\s*[\.．]\s*3/,
  /图的遍历/,
  /深度优先搜索|DFS/,
  /广度优先搜索|BFS/,
];

/** Try to locate a section in `fullText` using hints from user requirement (e.g. "5.3"). */
function anchorIndexFromRequirement(fullText: string, requirement: string | undefined): number {
  if (!requirement) return -1;
  const compact = requirement.replace(/\s+/g, '');
  if (/5\.3|5．3/.test(compact) || /5\s*[\.\．]\s*3/.test(requirement)) {
    const m = /5\s*\.\s*3|5．3/.exec(fullText);
    if (m && m.index !== undefined) return m.index;
  }
  return -1;
}

function findAnchorIndex(fullText: string, requirementHint?: string): number {
  for (const re of ANCHOR_PATTERNS) {
    const m = re.exec(fullText);
    if (m && m.index !== undefined) return m.index;
  }
  const fromReq = anchorIndexFromRequirement(fullText, requirementHint);
  if (fromReq >= 0) return fromReq;
  return -1;
}

/**
 * When `fullText` exceeds `maxChars`, prefer a window around a chapter anchor; otherwise head+tail.
 */
export function excerptPdfTextForPrompt(
  fullText: string,
  maxChars: number,
  requirementHint?: string,
): string {
  if (!fullText || fullText.length <= maxChars) return fullText;

  const total = fullText.length;
  const idx = findAnchorIndex(fullText, requirementHint);

  if (idx >= 0) {
    const margin = Math.floor(maxChars / 2);
    let start = Math.max(0, idx - margin);
    let end = Math.min(total, start + maxChars);
    if (end - start < maxChars) {
      start = Math.max(0, end - maxChars);
    }
    const slice = fullText.slice(start, end);
    const banner =
      start > 0 || end < total
        ? `\n\n[PDF 节选：全文 ${total} 字符；以下为围绕小节关键词定位的连续片段（位置 ${start}–${end}）。请同时遵守用户在「课堂需求」中的页码/小节范围说明。]\n`
        : '';
    return slice + banner;
  }

  const headLen = Math.floor(maxChars * 0.42);
  const tailLen = Math.max(0, maxChars - headLen - 120);
  const head = fullText.slice(0, headLen);
  const tail = fullText.slice(total - tailLen);
  return (
    head +
    `\n\n…（PDF 中间省略约 ${total - headLen - tailLen} 字；以下为文末节选，便于保留附录/例题）…\n\n` +
    tail +
    `\n\n[PDF 节选：全文 ${total} 字符；以上为文首+文末拼接。若用户指定了章节，请以需求文本为准并优先使用可用 PDF 图。]\n`
  );
}
