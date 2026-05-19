import { LlmRewriteConfig, LlmRewriteOptions, LlmRewriteResponse } from './types';

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
        throw new Error(`LLM API error (${response.status}): ${errorText || response.statusText}`);
      }

      const data = await response.json();
      const polishedText = this.stripReasoningBlocks(this.extractPolishedText(data));

      return { polished_text: polishedText || rawText };
    } catch (error) {
      console.error('[llm-rewrite] API call failed:', error);
      throw error;
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
      return DEFAULT_SYSTEM_PROMPT;
    }

    return `${DEFAULT_SYSTEM_PROMPT}

Local dictionary terms detected in the current transcription:
${terms.map((term) => `- ${term}`).join('\n')}

When these terms appear in the transcription, preserve them exactly unless the surrounding text clearly indicates a correction already happened. Do not translate, paraphrase, or normalize these protected terms.`;
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
    const engine = new LlmRewriteEngine(config);
    // Send a minimal test request
    await engine.rewrite('测试连接');
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e) };
  }
}
