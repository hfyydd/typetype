import { LlmRewriteConfig, LlmRewriteOptions, LlmRewriteResponse, RewriteScenario } from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a professional voice-to-text structuring assistant. Transform raw speech transcription into clear, polished, complete, and structured text.

Core rules:
1. PUNCTUATION: Add appropriate punctuation where speech pauses naturally, and fix obvious sentence-boundary issues.
2. CLEANUP: Remove filler words (um, uh, 嗯, 那个, 就是说, like, you know) while preserving the speaker's meaning.
3. LOGIC: Reorder random, jumpy, or fragmented speech according to context and common sense so the final text is coherent, rigorous, and clearly expresses the speaker's core intent. Add only necessary connective words or context that is directly supported by the transcription; do not fabricate facts.
4. CORRECTION: Correct obvious slips of the tongue, typos, repeated fragments, and wording mistakes when the intended meaning is clear.
5. STRUCTURE: For long or multi-topic speech, organize the result with clear hierarchy. Prefer Chinese-style numbering for Chinese text: 一、 -> （一） -> 1. -> (1). For technical or highly nested content, use 1. -> 1.1 -> 1.1.1 when clearer.
6. VISUALIZATION: Use headings, short paragraphs, bullet lists, numbered steps, decisions, conclusions, risks, owners, deadlines, and action items when the content supports them, so information is easy to scan.
7. COMPLETENESS: Never omit any key information, data, conclusion, decision, condition, requirement, or important detail from the original transcription. Every substantive point must appear in the final document.
8. EXPRESSION: Preserve the original intent while improving word order, tone, and wording so the result is more professional, clear, precise, and rigorous.
9. SHORT TEXT: For one-sentence or casual text, do not over-structure; just clean it up, correct obvious issues, and add punctuation.
10. LANGUAGE: Preserve the original language unless translation is explicitly requested.
11. Output ONLY the processed text. No explanations, no quotes.

The user text will be enclosed in <transcription> tags.`;

const SCENARIO_PROMPTS: Record<RewriteScenario, string> = {
  general: 'Use the most natural structure for the content. For short messages, keep it concise.',
  meeting_notes: 'Format as meeting notes when possible: topic, key points, decisions, action items, owners, deadlines, and risks.',
  work_report: 'Format as a work report when possible: background, progress, problems, next steps, and support needed.',
  message_reply: 'Format as a clear message reply suitable for chat or email. Keep tone natural and avoid excessive headings.',
  todo_list: 'Extract tasks as a checklist with clear actions, owners, priorities, and dates when mentioned.',
  study_notes: 'Format as study notes with concepts, explanations, examples, and summary points.',
  customer_service: 'Format as a customer-service record with customer issue, facts, handling result, follow-up, and cautions.',
};

export class LlmRewriteEngine {
  private config: LlmRewriteConfig;
  private options: LlmRewriteOptions;

  constructor(config: LlmRewriteConfig, options: LlmRewriteOptions = {}) {
    this.config = config;
    this.options = options;
  }

  private getAccessToken(): string {
    return this.config.api_key;
  }

  private getTokenType(): string {
    return 'Bearer';
  }

  async rewrite(rawText: string): Promise<LlmRewriteResponse> {
    if (!rawText.trim()) {
      return { polished_text: rawText };
    }

    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildUserMessage(rawText);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    let apiUrl = this.config.base_url;
    // Support both /v1/chat/completions and raw base_url
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `${this.getTokenType()} ${token}`,
    };

    // Anthropic requires different headers
    if (this.config.provider === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Content-Type'];
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.3,
      max_tokens: this.config.max_tokens ?? 4096,
    };

    // Anthropic uses messages format, OpenAI compatible uses messages
    // Both use the same messages structure, so body is similar

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(formatLlmApiError(response.status, errorText || response.statusText));
      }

      const data = await response.json();
      const polishedText = this.stripReasoningBlocks(this.extractPolishedText(data));

      return { polished_text: polishedText || rawText };
    } catch (error) {
      console.error('[llm-rewrite] API call failed:', error);
      throw new Error(formatLlmRuntimeError(error));
    }
  }

  private extractPolishedText(data: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    // OpenAI compatible format
    const openAiText = d?.choices?.[0]?.message?.content;
    if (typeof openAiText === 'string') {
      return openAiText.trim();
    }

    // Anthropic format
    const anthropicText = d?.content?.[0]?.text;
    if (typeof anthropicText === 'string') {
      return anthropicText.trim();
    }

    return '';
  }

  private buildSystemPrompt(): string {
    const terms = (this.options.preserveTerms ?? [])
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (terms.length === 0) {
      return `${DEFAULT_SYSTEM_PROMPT}${this.buildScenarioPrompt()}`;
    }

    return `${DEFAULT_SYSTEM_PROMPT}${this.buildScenarioPrompt()}

Local dictionary terms detected in the current transcription:
${terms.map((term) => `- ${term}`).join('\n')}

When these terms appear in the transcription, preserve them exactly unless the surrounding text clearly indicates a correction already happened. Do not translate, paraphrase, or normalize these protected terms.`;
  }

  private buildScenarioPrompt(): string {
    const scenario = this.options.scenario ?? 'general';
    const voiceFormatting = this.options.voiceFormattingEnabled === false
      ? ''
      : '\nVoice formatting commands such as spaces, line breaks, blank lines, titles, and numbered points may already have been converted locally. Preserve intentional line breaks and hierarchy unless they are clearly wrong.';

    return `

Scenario mode:
${SCENARIO_PROMPTS[scenario] ?? SCENARIO_PROMPTS.general}${voiceFormatting}`;
  }

  private buildUserMessage(rawText: string): string {
    return `<transcription>\n${rawText}\n</transcription>`;
  }

  private stripReasoningBlocks(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .trim();
  }
}

export async function testLlmConnection(config: LlmRewriteConfig): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const engine = new LlmRewriteEngine({
      ...config,
      max_tokens: Math.min(config.max_tokens ?? 4096, 96),
    });
    // Send a minimal test request
    await engine.rewrite('测试连接');
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: formatLlmRuntimeError(e) };
  }
}

function formatLlmApiError(status: number, detail: string): string {
  const cleanDetail = compactErrorDetail(detail);
  const lower = cleanDetail.toLowerCase();

  if (status === 401 || lower.includes('unauthorized') || lower.includes('invalid authentication')) {
    return `LLM API error (${status}): 认证失败。请检查 API Key 是否复制完整、是否属于当前选择的平台/国内国际地址、账户是否有额度和权限。${cleanDetail}`;
  }

  if (status === 403) {
    return `LLM API error (${status}): 权限不足。该 API Key 可能没有开通当前模型、账户额度不足，或平台限制了调用权限。${cleanDetail}`;
  }

  if (status === 404) {
    return `LLM API error (${status}): 模型或接口地址不存在。请检查 Base URL 和模型名是否来自同一个平台。${cleanDetail}`;
  }

  if (status === 429) {
    return `LLM API error (${status}): 请求过快或额度不足。请稍后重试，或检查平台余额、并发和限速。${cleanDetail}`;
  }

  if (status === 400) {
    if (lower.includes('temperature') && lower.includes('only 1')) {
      return `LLM API error (${status}): 当前模型只允许 temperature=1，已建议使用该模型对应的预设；请重新选择厂家预设后再测试。${cleanDetail}`;
    }
    return `LLM API error (${status}): 请求参数不被平台接受。常见原因是模型名填错、模型和 Base URL 不匹配，或该模型不支持当前参数。${cleanDetail}`;
  }

  if (status >= 500) {
    return `LLM API error (${status}): 模型平台服务异常或网络网关异常，请稍后重试或换一个平台测试。${cleanDetail}`;
  }

  return `LLM API error (${status}): ${cleanDetail}`;
}

function formatLlmRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = compactErrorDetail(raw);
  const lower = clean.toLowerCase();

  if (lower.includes('fetch failed') || lower.includes('econn') || lower.includes('enotfound') || lower.includes('etimedout')) {
    return `网络连接失败：无法连接到模型平台。请检查网络、代理、公司防火墙、系统时间和 TLS/证书设置；如果同一电脑浏览器也打不开该平台，就是网络问题。${clean}`;
  }

  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate') || lower.includes('schannel')) {
    return `安全连接失败：TLS/证书握手没有成功。请检查代理、杀毒软件 HTTPS 扫描、系统证书和平台域名是否可访问。${clean}`;
  }

  return clean;
}

function compactErrorDetail(detail: string): string {
  return String(detail ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}
