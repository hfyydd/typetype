const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'resources', 'lexicons', 'system-lexicon.json');
const sourceRoots = {
  jieba: process.env.TYPETYPE_JIEBA_ROOT || 'C:/tmp/typetype_lexicon_jieba',
  thuocl: process.env.TYPETYPE_THUOCL_ROOT || 'C:/tmp/typetype_lexicon_thuocl',
  opencc: process.env.TYPETYPE_OPENCC_ROOT || 'C:/tmp/typetype_lexicon_opencc',
};

const thuoclCategories = {
  THUOCL_IT: 'IT/AI/互联网',
  THUOCL_caijing: '财经',
  THUOCL_car: '汽车/出行',
  THUOCL_chengyu: '成语',
  THUOCL_diming: '地名',
  THUOCL_food: '餐饮/饮食',
  THUOCL_law: '法律',
  THUOCL_lishimingren: '人名/历史名人',
  THUOCL_medical: '医学/健康',
  THUOCL_poem: '诗词',
  THUOCL_animal: '动物/生活',
};

const entries = [];
const seen = new Set();

function add(term, category, source, weight = 1) {
  const normalized = normalizeTerm(term);
  if (!isValidTerm(normalized)) {
    return;
  }

  const key = normalized.toLocaleLowerCase();
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  entries.push({
    term: normalized,
    category,
    source,
    weight,
  });
}

function normalizeTerm(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, '')
    .trim();
}

function isValidTerm(term) {
  if (!term || term.length < 2 || term.length > 80) {
    return false;
  }
  if (/^\d+$/.test(term)) {
    return false;
  }
  if (/^[\p{P}\p{S}\s]+$/u.test(term)) {
    return false;
  }
  return true;
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/g);
}

function addManualTerms() {
  const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  for (const entry of existing) {
    add(entry.term, entry.category || '人工高权重词', entry.source || 'manual-safe-v1', entry.weight ?? 10);
  }
}

function addJiebaTerms() {
  const dictFiles = [
    path.join(sourceRoots.jieba, 'extra_dict', 'dict.txt.big'),
    path.join(sourceRoots.jieba, 'jieba', 'dict.txt'),
  ];

  for (const filePath of dictFiles) {
    for (const line of readLines(filePath)) {
      const [term, rawFreq] = line.split(/\s+/g);
      const freq = Number(rawFreq || 1);
      add(term, '通用基础词库', 'jieba:MIT', Math.max(1, Math.min(8, Math.round(Math.log10(freq || 1)))));
    }
  }
}

function addThuoclTerms() {
  const dataDir = path.join(sourceRoots.thuocl, 'data');
  if (!fs.existsSync(dataDir)) {
    return;
  }

  for (const fileName of fs.readdirSync(dataDir)) {
    if (!fileName.endsWith('.txt')) {
      continue;
    }
    const baseName = path.basename(fileName, '.txt');
    const category = thuoclCategories[baseName] || 'THUOCL';
    for (const line of readLines(path.join(dataDir, fileName))) {
      const [term, rawFreq] = line.split(/\t+/g);
      const freq = Number(rawFreq || 1);
      add(term, category, 'THUOCL:MIT', Math.max(2, Math.min(9, Math.round(Math.log10(freq || 1)))));
    }
  }
}

function addOpenCcTerms() {
  const dictionaryDir = path.join(sourceRoots.opencc, 'data', 'dictionary');
  const files = [
    'STPhrases.txt',
    'TSPhrases.txt',
    'TWPhrases.txt',
    'TWPhrasesRev.txt',
    'HKVariantsRevPhrases.txt',
    'JPShinjitaiPhrases.txt',
  ];

  for (const fileName of files) {
    for (const line of readLines(path.join(dictionaryDir, fileName))) {
      if (!line || line.startsWith('#')) {
        continue;
      }
      const [sourceTerm, targets = ''] = line.split(/\t+/g);
      add(sourceTerm, '繁简/港澳台短语', 'OpenCC:Apache-2.0', 5);
      for (const target of targets.split(/\s+/g)) {
        add(target, '繁简/港澳台短语', 'OpenCC:Apache-2.0', 5);
      }
    }
  }
}

addManualTerms();
addThuoclTerms();
addOpenCcTerms();
addJiebaTerms();

entries.sort((a, b) => {
  const category = a.category.localeCompare(b.category, 'zh-CN');
  if (category !== 0) {
    return category;
  }
  if ((b.weight ?? 0) !== (a.weight ?? 0)) {
    return (b.weight ?? 0) - (a.weight ?? 0);
  }
  return a.term.localeCompare(b.term, 'zh-CN');
});

fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');

const categoryCounts = entries.reduce((acc, entry) => {
  acc[entry.category] = (acc[entry.category] || 0) + 1;
  return acc;
}, {});

console.log(`Wrote ${entries.length} system lexicon entries to ${outputPath}`);
console.log(categoryCounts);
