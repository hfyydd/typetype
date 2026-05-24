import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import { DictionaryEntry, DictionaryImportPreview, DictionaryImportRequest } from './types';
import {
  DictionaryCandidate,
  buildImportPreview,
  normalizeDictionaryText,
  splitAliasText,
} from './dictionary-engine';

const UNSUPPORTED_WPS_EXTENSIONS = new Set(['.wps', '.et']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const WORD_EXTENSIONS = new Set(['.docx']);

export async function createDictionaryImportPreview(
  request: DictionaryImportRequest,
  existingEntries: DictionaryEntry[]
): Promise<DictionaryImportPreview> {
  const sourceName = getSourceName(request);
  const candidates = await parseDictionaryCandidates(request);
  return buildImportPreview(candidates, existingEntries, sourceName);
}

export async function parseDictionaryCandidates(request: DictionaryImportRequest): Promise<DictionaryCandidate[]> {
  if (request.file_path) {
    return parseDictionaryFile(request.file_path);
  }

  return parseTextCandidates(request.content ?? '');
}

async function parseDictionaryFile(filePath: string): Promise<DictionaryCandidate[]> {
  const extension = path.extname(filePath).toLocaleLowerCase();

  if (UNSUPPORTED_WPS_EXTENSIONS.has(extension)) {
    throw new Error('第一版暂不直接读取 WPS 专有格式。请在 WPS 中另存为 .docx、.xlsx、.xls、.csv 或 .txt 后再导入。');
  }

  if (extension === '.txt') {
    return parseTextCandidates(fs.readFileSync(filePath, 'utf-8'));
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return parseSpreadsheetCandidates(filePath);
  }

  if (WORD_EXTENSIONS.has(extension)) {
    return parseDocxCandidates(filePath);
  }

  throw new Error('暂不支持该文件格式。请使用 txt、csv、xlsx、xls 或 docx。');
}

function parseSpreadsheetCandidates(filePath: string): DictionaryCandidate[] {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(workbook.Sheets[firstSheetName], {
    header: 1,
    blankrows: false,
    raw: false,
  });

  return rowsToCandidates(rows.map((row) => row.map((cell) => normalizeDictionaryText(String(cell ?? '')))));
}

async function parseDocxCandidates(filePath: string): Promise<DictionaryCandidate[]> {
  const result = await mammoth.extractRawText({ path: filePath });
  return parseTextCandidates(result.value);
}

export function parseTextCandidates(rawText: string): DictionaryCandidate[] {
  const lines = rawText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  return rowsToCandidates(lines.map((line) => splitTextLine(line)));
}

function rowsToCandidates(rows: string[][]): DictionaryCandidate[] {
  const candidates: DictionaryCandidate[] = [];
  const cleanedRows = rows
    .map((row) => row.map(normalizeDictionaryText).filter(Boolean))
    .filter((row) => row.length > 0);

  const startIndex = shouldSkipHeader(cleanedRows[0]) ? 1 : 0;
  for (const row of cleanedRows.slice(startIndex)) {
    const [first, second] = row;
    if (!first) {
      continue;
    }

    if (second) {
      candidates.push({
        kind: 'replacement',
        term: second,
        aliases: splitAliasText(first),
        replacement: second,
        raw: row.join(' | '),
      });
      continue;
    }

    candidates.push({
      kind: 'term',
      term: first,
      aliases: [],
      replacement: first,
      raw: first,
    });
  }

  return candidates;
}

function splitTextLine(line: string): string[] {
  const tabParts = line.split(/\t+/g).map(normalizeDictionaryText).filter(Boolean);
  if (tabParts.length >= 2) {
    return tabParts;
  }

  const arrowMatch = line.match(/^(.+?)(?:=>|->|→|＝>|—>|：|:)(.+)$/);
  if (arrowMatch) {
    return [normalizeDictionaryText(arrowMatch[1]), normalizeDictionaryText(arrowMatch[2])];
  }

  const csvParts = parseLooseCsvLine(line).map(normalizeDictionaryText).filter(Boolean);
  if (csvParts.length >= 2) {
    return csvParts;
  }

  return [normalizeDictionaryText(line)];
}

function parseLooseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if ((char === ',' || char === '，') && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts;
}

function shouldSkipHeader(row?: string[]): boolean {
  if (!row || row.length === 0) {
    return false;
  }

  const joined = row.join('').toLocaleLowerCase();
  const headerHints = ['正确词', '常用词', '目标词', '替换词', '可能识别错', '错词', 'alias', 'term', 'replacement'];
  return headerHints.some((hint) => joined.includes(hint.toLocaleLowerCase()));
}

function getSourceName(request: DictionaryImportRequest): string {
  if (request.file_name) {
    return request.file_name;
  }
  if (request.file_path) {
    return path.basename(request.file_path);
  }
  return '粘贴内容';
}
