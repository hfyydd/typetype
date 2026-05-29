const NUMBER_WORDS: Record<string, string> = {
  '一': '一',
  '二': '二',
  '两': '二',
  '三': '三',
  '四': '四',
  '五': '五',
  '六': '六',
  '七': '七',
  '八': '八',
  '九': '九',
  '十': '十',
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
  '10': '十',
};

export interface VoiceFormattingOptions {
  partial?: boolean;
  enabled?: boolean;
}

export function applyVoiceFormattingCommands(
  text: string,
  options: VoiceFormattingOptions = {}
): string {
  if (!text || options.enabled === false) {
    return text;
  }

  return options.partial
    ? cleanupFormattedWhitespace(applyPartialFormatting(text))
    : cleanupFormattedWhitespace(applyFullFormatting(text));
}

function applyPartialFormatting(text: string): string {
  return text
    .replace(/(加个|加一个)?空一?格/g, ' ')
    .replace(/(换行|下一行|另起一行)/g, '\n');
}

function applyFullFormatting(text: string): string {
  let result = applyPartialFormatting(text);

  result = result
    .replace(/(另起一段|空一行|隔一行)/g, '\n\n')
    .replace(/隔两行/g, '\n\n\n')
    .replace(/冒号/g, '：')
    .replace(/破折号/g, '——')
    .replace(/左括号|前括号/g, '（')
    .replace(/右括号|后括号/g, '）')
    .replace(/左引号|前引号/g, '“')
    .replace(/右引号|后引号/g, '”');

  result = result.replace(/标题\s*([^\n]+?)(\n{2,}|(?=第[一二两三四五六七八九十0-9]+点|下一点|$))/g, (_match, title: string, separator: string) => {
    return `${title.trim()}${separator ? '\n\n' : '\n'}`;
  });

  result = result.replace(/(\n*)第([一二两三四五六七八九十0-9]+)点/g, (_match, leading: string, value: string) => {
    const prefix = leading.length >= 2 ? '\n\n' : '\n';
    return `${prefix}${NUMBER_WORDS[value] ?? value}、`;
  });

  result = result.replace(/下一点/g, '\n- ');
  result = result.replace(/“([^”\n]+)“/g, '“$1”');

  return result;
}

function cleanupFormattedWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/[ \t]*([：，。！？；、）”])/g, '$1')
    .replace(/([（“])[ \t]*/g, '$1')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}
