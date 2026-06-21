import * as fs from 'fs';
import * as path from 'path';
import { Tokenizer } from '@huggingface/tokenizers';
import { applyBasicTranscriptPunctuation } from './transcript-punctuation';

export type LocalPunctuationSource = 'model' | 'rules';

export interface LocalPunctuationEngineOptions {
  resourcesPath?: string;
  processResourcesPath?: string;
  appPath?: string;
  modelDir?: string;
  onnxRuntimeNativeDir?: string;
  onnxRuntimeLoader?: OnnxRuntimeLoader;
}

export interface LocalPunctuationRestoreOptions {
  final?: boolean;
  preserveTerms?: string[];
}

export interface LocalPunctuationRestoreResult {
  text: string;
  sentences: string[];
  source: LocalPunctuationSource;
  ready: boolean;
  error?: string;
}

type TokenizerLike = {
  encode: (text: string, options?: { add_special_tokens?: boolean }) => { ids: number[] };
  id_to_token?: (id: number) => string | undefined;
};

interface PunctuationSegment {
  ids: number[];
  index: number;
}

interface CollectedSegment {
  ids: number[];
  postPreds: Array<string | null>;
  segPreds: boolean[];
  index: number;
}

type OrtTensorData = ArrayLike<number | bigint | boolean>;

interface OrtTensorLike {
  data: OrtTensorData;
}

interface OrtInferenceSessionLike {
  run(inputs: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}

interface OrtModuleLike {
  InferenceSession: {
    create(
      modelPath: string,
      options: { executionProviders: string[] }
    ): Promise<OrtInferenceSessionLike>;
  };
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => unknown;
}

export type OnnxRuntimeLoader = () => Promise<OrtModuleLike> | OrtModuleLike;

export interface LocalPunctuationRuntimeDiagnostics {
  native_dir: string;
  binding_path: string;
  binding_exists: boolean;
  runtime_dll_path: string;
  runtime_dll_exists: boolean;
  directml_dll_path: string;
  directml_dll_exists: boolean;
  last_error: string;
  last_raw_error: string;
}

const MODEL_DIR_NAME = 'pcs-47lang';
const MODEL_RELATIVE_DIR = path.join('punctuation-models', MODEL_DIR_NAME);
const TOKENIZER_JSON = 'tokenizer.json';
const TOKENIZER_CONFIG_JSON = 'tokenizer_config.json';
const ONNX_MODEL = 'punct_cap_seg_47lang_int8.onnx';
const MAX_LENGTH = 128;
const OVERLAP = 16;
const BOS_ID = 1;
const EOS_ID = 2;
const NULL_LABEL = '<NULL>';
const POST_LABELS = [
  NULL_LABEL,
  '.',
  ',',
  '?',
  '？',
  '，',
  '。',
  '、',
  '・',
  '।',
  '؟',
  '،',
  ';',
  '።',
  '፣',
  '፧',
];

const CJK_RE = /[\u3400-\u9fff]/u;
const SENTENCE_END_RE = /[。！？!?]$/u;
const CLAUSE_PUNCTUATION_RE = /[，,。！？!?、；;：:]/gu;
const ONNX_RUNTIME_NODE_MODULE_DIR = path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
const ONNX_BINDING_FILE = 'onnxruntime_binding.node';
const ONNX_RUNTIME_DLL = process.platform === 'win32' ? 'onnxruntime.dll' : 'libonnxruntime.so';
const DIRECTML_DLL = 'DirectML.dll';

export function resolveBundledPunctuationModelPath(options: LocalPunctuationEngineOptions = {}): string | null {
  const candidates = [
    options.modelDir,
    options.processResourcesPath ? path.join(options.processResourcesPath, MODEL_RELATIVE_DIR) : null,
    options.resourcesPath ? path.join(options.resourcesPath, MODEL_RELATIVE_DIR) : null,
    options.appPath ? path.join(options.appPath, 'resources', MODEL_RELATIVE_DIR) : null,
    path.join(__dirname, '..', 'resources', MODEL_RELATIVE_DIR),
    path.join(__dirname, '..', '..', 'resources', MODEL_RELATIVE_DIR),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (hasRequiredPunctuationFiles(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function hasRequiredPunctuationFiles(modelDir: string): boolean {
  return [
    TOKENIZER_JSON,
    TOKENIZER_CONFIG_JSON,
    ONNX_MODEL,
  ].every((fileName) => fs.existsSync(path.join(modelDir, fileName)));
}

export function inspectOnnxRuntimeNativeFiles(
  options: LocalPunctuationEngineOptions = {}
): LocalPunctuationRuntimeDiagnostics {
  const nativeDir = resolveOnnxRuntimeNativeDir(options) ?? getOnnxRuntimeNativeDirCandidates(options)[0] ?? '';
  const bindingPath = nativeDir ? path.join(nativeDir, ONNX_BINDING_FILE) : '';
  const runtimeDllPath = nativeDir ? path.join(nativeDir, ONNX_RUNTIME_DLL) : '';
  const directmlDllPath = process.platform === 'win32' && nativeDir ? path.join(nativeDir, DIRECTML_DLL) : '';

  return {
    native_dir: nativeDir,
    binding_path: bindingPath,
    binding_exists: Boolean(bindingPath && fs.existsSync(bindingPath)),
    runtime_dll_path: runtimeDllPath,
    runtime_dll_exists: Boolean(runtimeDllPath && fs.existsSync(runtimeDllPath)),
    directml_dll_path: directmlDllPath,
    directml_dll_exists: process.platform === 'win32'
      ? Boolean(directmlDllPath && fs.existsSync(directmlDllPath))
      : true,
    last_error: '',
    last_raw_error: '',
  };
}

export function resolveOnnxRuntimeNativeDir(options: LocalPunctuationEngineOptions = {}): string | null {
  for (const candidate of getOnnxRuntimeNativeDirCandidates(options)) {
    if (fs.existsSync(path.join(candidate, ONNX_BINDING_FILE))) {
      return candidate;
    }
  }
  return null;
}

export class LocalPunctuationEngine {
  private modelDir: string | null;
  private tokenizer: TokenizerLike | null = null;
  private session: OrtInferenceSessionLike | null = null;
  private ort: OrtModuleLike | null = null;
  private loadPromise: Promise<void> | null = null;
  private lastError: Error | null = null;
  private lastRawError: Error | null = null;

  constructor(private options: LocalPunctuationEngineOptions = {}) {
    this.modelDir = resolveBundledPunctuationModelPath(options);
  }

  getStatus(): { ready: boolean; available: boolean; detail: string } {
    if (this.session && this.tokenizer) {
      return { ready: true, available: true, detail: '本地断句增强已就绪。' };
    }
    if (!this.modelDir) {
      return { ready: false, available: false, detail: '未找到本地断句增强资源，已使用基础断句。' };
    }
    if (this.lastError) {
      return { ready: false, available: true, detail: '本地断句增强需要系统运行库，基础断句已可用。' };
    }
    return { ready: false, available: true, detail: '本地断句增强等待后台加载。' };
  }

  getDiagnostics(): LocalPunctuationRuntimeDiagnostics {
    return {
      ...inspectOnnxRuntimeNativeFiles(this.options),
      last_error: this.lastError?.message ?? '',
      last_raw_error: this.lastRawError?.message ?? '',
    };
  }

  reset(): void {
    this.tokenizer = null;
    this.session = null;
    this.ort = null;
    this.loadPromise = null;
    this.lastError = null;
    this.lastRawError = null;
  }

  async warmup(): Promise<void> {
    await this.ensureLoaded();
  }

  async restorePunctuation(
    rawText: string,
    options: LocalPunctuationRestoreOptions = {}
  ): Promise<LocalPunctuationRestoreResult> {
    const normalized = normalizeModelInput(rawText);
    if (!normalized) {
      return { text: '', sentences: [], source: 'rules', ready: false };
    }

    try {
      await this.ensureLoaded();
      if (!this.session || !this.tokenizer) {
        throw new Error('本地断句模型未就绪');
      }

      const sentences = await this.restoreWithModel(normalized);
      const text = postProcessPunctuatedText(sentences.join('\n'), options.preserveTerms ?? [], options.final ?? false);
      const normalizedSentences = splitPunctuatedSentences(text);
      if (!hasUsefulModelPunctuation(text, normalized)) {
        throw new Error('本地断句模型未产生有效标点');
      }
      return {
        text,
        sentences: normalizedSentences,
        source: 'model',
        ready: true,
      };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      this.lastError = e;
      if (!this.lastRawError) {
        this.lastRawError = e;
      }
      const fallbackText = buildRuleFallbackText(rawText, options.final ?? false);
      return {
        text: fallbackText,
        sentences: splitPunctuatedSentences(fallbackText),
        source: 'rules',
        ready: false,
        error: e.message,
      };
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session && this.tokenizer) {
      return;
    }
    if (!this.modelDir) {
      this.modelDir = resolveBundledPunctuationModelPath(this.options);
    }
    if (!this.modelDir) {
      throw new Error('未找到本地断句模型资源');
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadModel(this.modelDir)
        .catch((error) => {
          this.lastRawError = error instanceof Error ? error : new Error(String(error));
          this.lastError = this.normalizeLoadError(error);
          throw this.lastError;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }
    await this.loadPromise;
  }

  private async loadModel(modelDir: string): Promise<void> {
    const ort = await this.loadOnnxRuntime();
    const tokenizerJson = JSON.parse(fs.readFileSync(path.join(modelDir, TOKENIZER_JSON), 'utf8'));
    const tokenizerConfig = JSON.parse(fs.readFileSync(path.join(modelDir, TOKENIZER_CONFIG_JSON), 'utf8'));
    this.tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig) as unknown as TokenizerLike;
    this.ort = ort;
    this.session = await ort.InferenceSession.create(path.join(modelDir, ONNX_MODEL), {
      executionProviders: ['cpu'],
    });
    this.lastError = null;
    this.lastRawError = null;
  }

  private async loadOnnxRuntime(): Promise<OrtModuleLike> {
    const loader = this.options.onnxRuntimeLoader ?? loadDefaultOnnxRuntime;
    const loaded = await loader();
    if (!loaded?.InferenceSession?.create || !loaded?.Tensor) {
      throw new Error('ONNX Runtime 组件不完整');
    }
    return loaded;
  }

  private normalizeLoadError(error: unknown): Error {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const diagnostics = inspectOnnxRuntimeNativeFiles(this.options);
    const details = [`ONNX Runtime 加载失败：${rawMessage}`];

    if (!diagnostics.binding_exists) {
      details.push(`缺少 ${diagnostics.binding_path || ONNX_BINDING_FILE}`);
    }
    if (process.platform === 'win32') {
      if (!diagnostics.runtime_dll_exists) {
        details.push(`缺少 ${diagnostics.runtime_dll_path || ONNX_RUNTIME_DLL}`);
      }
      if (!diagnostics.directml_dll_exists) {
        details.push(`缺少 ${diagnostics.directml_dll_path || DIRECTML_DLL}`);
      }
      details.push('请安装 Microsoft Visual C++ 2015-2022 x64，更新 Windows/显卡驱动，并检查安全软件是否拦截 typetype 目录内 DLL。');
    }

    return new Error(details.join(' '));
  }

  private async restoreWithModel(text: string): Promise<string[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('本地断句模型未加载');
    }

    const rawIds = this.tokenizer.encode(text, { add_special_tokens: false }).ids;
    if (rawIds.length === 0) {
      return [];
    }

    const segments = createOverlappingSegments(rawIds);
    const collected: CollectedSegment[] = [];
    for (const segment of segments) {
      collected.push(await this.runSegment(segment));
    }

    return produceSentencesFromSegments(collected, this.tokenizer);
  }

  private async runSegment(segment: PunctuationSegment): Promise<CollectedSegment> {
    if (!this.session || !this.ort) {
      throw new Error('本地断句模型未加载');
    }

    const inputIds = [BOS_ID, ...segment.ids, EOS_ID];
    const inputTensor = new this.ort.Tensor(
      'int64',
      BigInt64Array.from(inputIds.map((id) => BigInt(id))),
      [1, inputIds.length]
    );
    const outputs = await this.session.run({ input_ids: inputTensor });
    const postPredValues = tensorDataToNumbers(outputs.post_preds.data);
    const segPredValues = tensorDataToNumbers(outputs.seg_preds.data);
    const postPreds = postPredValues
      .slice(1, inputIds.length - 1)
      .map((value) => {
        const label = POST_LABELS[value] ?? NULL_LABEL;
        return label === NULL_LABEL ? null : label;
      });
    const segPreds = segPredValues
      .slice(1, inputIds.length - 1)
      .map(Boolean);

    return {
      ids: segment.ids,
      postPreds,
      segPreds,
      index: segment.index,
    };
  }
}

async function loadDefaultOnnxRuntime(): Promise<OrtModuleLike> {
  const loaded = await import('onnxruntime-node') as unknown as OrtModuleLike & { default?: OrtModuleLike };
  return (loaded.InferenceSession ? loaded : loaded.default) as OrtModuleLike;
}

function getOnnxRuntimeNativeDirCandidates(options: LocalPunctuationEngineOptions = {}): string[] {
  const arch = process.arch;
  const platform = process.platform;
  const relativeDir = path.join(ONNX_RUNTIME_NODE_MODULE_DIR, platform, arch);
  const candidates = options.onnxRuntimeNativeDir
    ? [options.onnxRuntimeNativeDir]
    : [
      options.processResourcesPath
        ? path.join(options.processResourcesPath, 'app.asar.unpacked', relativeDir)
        : null,
      options.appPath ? path.join(options.appPath, relativeDir) : null,
      path.join(__dirname, '..', relativeDir),
      path.join(__dirname, '..', '..', relativeDir),
    ];

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

function buildRuleFallbackText(rawText: string, final: boolean): string {
  const text = rawText.trim();
  if (!text) {
    return '';
  }
  return final ? applyBasicTranscriptPunctuation(text) : text;
}

function tensorDataToNumbers(data: OrtTensorData): number[] {
  const values = data as unknown as ArrayLike<number | bigint | boolean>;
  return Array.from({ length: values.length }, (_unused, index) => Number(values[index]));
}

function createOverlappingSegments(ids: number[]): PunctuationSegment[] {
  const maxPayload = MAX_LENGTH - 2;
  const segments: PunctuationSegment[] = [];
  let start = 0;
  let index = 0;
  while (start < ids.length) {
    const adjustedStart = Math.max(0, start - (index === 0 ? 0 : OVERLAP));
    const stop = adjustedStart + maxPayload;
    segments.push({
      ids: ids.slice(adjustedStart, stop),
      index,
    });
    start = stop;
    index += 1;
  }
  return segments;
}

function produceSentencesFromSegments(segments: CollectedSegment[], tokenizer: TokenizerLike): string[] {
  const merged = mergeOverlappingPredictions(segments);
  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < merged.ids.length; i += 1) {
    const token = tokenizer.id_to_token?.(merged.ids[i]) ?? '';
    const tokenText = token.startsWith('▁') ? token.slice(1) : token;
    if (!tokenText) {
      continue;
    }
    if (token.startsWith('▁') && current && shouldInsertSpace(current, tokenText)) {
      current += ' ';
    }
    current += tokenText;
    const punctuation = normalizeModelPunctuation(merged.postPreds[i]);
    if (punctuation) {
      current = current.replace(/[，,。！？!?、；;：:]+$/u, '') + punctuation;
    }
    if (merged.segPreds[i] && current.trim()) {
      sentences.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    sentences.push(current.trim());
  }

  return mergeTinySentences(sentences);
}

function mergeOverlappingPredictions(segments: CollectedSegment[]): {
  ids: number[];
  postPreds: Array<string | null>;
  segPreds: boolean[];
} {
  const ids: number[] = [];
  const postPreds: Array<string | null> = [];
  const segPreds: boolean[] = [];
  const sorted = segments.sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i += 1) {
    const segment = sorted[i];
    let start = 0;
    let stop = segment.ids.length;
    if (i > 0) {
      start += Math.floor(OVERLAP / 2);
    }
    if (i < sorted.length - 1) {
      stop -= Math.floor(OVERLAP / 2);
    }
    ids.push(...segment.ids.slice(start, stop));
    postPreds.push(...segment.postPreds.slice(start, stop));
    segPreds.push(...segment.segPreds.slice(start, stop));
  }
  return { ids, postPreds, segPreds };
}

function shouldInsertSpace(previous: string, next: string): boolean {
  const previousChar = Array.from(previous).pop() ?? '';
  const nextChar = Array.from(next)[0] ?? '';
  if (!previousChar || !nextChar) {
    return false;
  }
  if (CJK_RE.test(previousChar) || CJK_RE.test(nextChar)) {
    return false;
  }
  return !/\s/u.test(previousChar);
}

function normalizeModelInput(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CLAUSE_PUNCTUATION_RE, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeModelPunctuation(label: string | null): string {
  switch (label) {
    case '.':
      return '。';
    case ',':
      return '，';
    case '?':
      return '？';
    case ';':
      return '；';
    case '？':
    case '，':
    case '。':
    case '、':
      return label;
    default:
      return '';
  }
}

function mergeTinySentences(sentences: string[]): string[] {
  const merged: string[] = [];
  for (const raw of sentences.map((item) => item.trim()).filter(Boolean)) {
    const cjkLength = countCjk(raw);
    if (merged.length > 0 && cjkLength > 0 && cjkLength <= 5) {
      const previous = merged.pop() ?? '';
      const mergedPrefix = /[。！？；]$/u.test(previous)
        ? previous.replace(/[。！？；]+$/u, '')
        : `${previous}，`;
      merged.push(`${mergedPrefix}${raw}`);
      continue;
    }
    merged.push(raw);
  }
  return merged;
}

function postProcessPunctuatedText(text: string, preserveTerms: string[], final: boolean): string {
  let result = text
    .replace(/^[，,。！？!?、；;：:\s]+/u, '')
    .replace(/[ \t]*\n[ \t]*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[，,]{2,}/gu, '，')
    .replace(/[。]{2,}/gu, '。')
    .replace(/[？?]{2,}/gu, '？')
    .replace(/[！!]{2,}/gu, '！')
    .replace(/[；;]{2,}/gu, '；')
    .replace(/，([。！？；])/gu, '$1')
    .replace(/、([。！？；])/gu, '$1');

  result = repairKnownChineseBadSplits(result);
  for (const term of preserveTerms.filter((value) => value.trim().length >= 2)) {
    result = protectTermPunctuation(result, term.trim());
  }

  result = splitPunctuatedSentences(result)
    .map((sentence) => {
      const trimmed = sentence.trim().replace(/[，,、；;：:]+$/u, '');
      if (!trimmed) {
        return '';
      }
      if (!final && !SENTENCE_END_RE.test(trimmed) && countCjk(trimmed) < 18) {
        return trimmed;
      }
      return SENTENCE_END_RE.test(trimmed) ? trimmed : `${trimmed}。`;
    })
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  return result;
}

function splitPunctuatedSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[。！？；])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function repairKnownChineseBadSplits(text: string): string {
  return text
    .replace(/([一-龥])，([一-龥])/gu, (match, before: string, after: string) => {
      const pair = `${before}${after}`;
      return UNSAFE_COMMA_PAIRS.has(pair) ? pair : match;
    })
    .replace(/数据[，。]\s*中台/gu, '数据中台')
    .replace(/数据供给[，。]\s*源/gu, '数据供给源')
    .replace(/数据[，。]\s*供给/gu, '数据供给')
    .replace(/业务[，。]\s*模块/gu, '业务模块')
    .replace(/政策[，。]\s*规范/gu, '政策规范')
    .replace(/标准[，。]\s*化/gu, '标准化')
    .replace(/标准化[，。]\s*核心/gu, '标准化核心')
    .replace(/文件[，。]\s*流转/gu, '文件流转')
    .replace(/跨部门[，。]\s*协作/gu, '跨部门协作')
    .replace(/信息[，。]\s*化/gu, '信息化')
    .replace(/共[，。]\s*同/gu, '共同')
    .replace(/供[，。]\s*给/gu, '供给')
    .replace(/中[，。]\s*台/gu, '中台')
    .replace(/基[，。]\s*座/gu, '基座');
}

function protectTermPunctuation(text: string, term: string): string {
  if (!term || !/[，。！？；：、]/u.test(text)) {
    return text;
  }
  const chars = Array.from(term).map(escapeRegExp);
  if (chars.length < 2) {
    return text;
  }
  const pattern = new RegExp(chars.join('[，,。！？!?、；;：:\\s]*'), 'gu');
  return text.replace(pattern, term);
}

function hasUsefulModelPunctuation(text: string, rawText: string): boolean {
  const punctuationCount = (text.match(/[，。！？；、]/gu) ?? []).length;
  return punctuationCount >= Math.max(1, Math.min(4, Math.floor(countCjk(rawText) / 40)));
}

function countCjk(text: string): number {
  return Array.from(text).filter((char) => CJK_RE.test(char)).length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const UNSAFE_COMMA_PAIRS = new Set([
  '国家',
  '治理',
  '体系',
  '能力',
  '现代',
  '数据',
  '供给',
  '中台',
  '基座',
  '服务',
  '标准',
  '化核',
  '核心',
  '业务',
  '模块',
  '政策',
  '规范',
  '共同',
  '构成',
  '确保',
  '质量',
  '合规',
  '连接',
  '准确',
  '廉政',
  '档案',
  '监狱',
  '信息',
  '建设',
  '孤岛',
  '部门',
  '协作',
  '文件',
  '流转',
  '效率',
  '错误',
  '频发',
  '安全',
  '隐患',
]);
