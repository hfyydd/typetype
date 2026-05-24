const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const XLSX = require("xlsx");
const {
  createDictionaryImportPreview,
  parseTextCandidates,
} = require("../dist-electron/dictionary-import.js");

test("paste import supports one-column terms and two-column corrections", () => {
  const candidates = parseTextCandidates([
    "typetype",
    "太普太普, typetype",
    "迷你麦克斯 => MiniMax",
    "迪普西克\tDeepSeek",
  ].join("\n"));

  assert.deepEqual(candidates.map((item) => ({
    kind: item.kind,
    term: item.term,
    aliases: item.aliases,
  })), [
    { kind: "term", term: "typetype", aliases: [] },
    { kind: "replacement", term: "typetype", aliases: ["太普太普"] },
    { kind: "replacement", term: "MiniMax", aliases: ["迷你麦克斯"] },
    { kind: "replacement", term: "DeepSeek", aliases: ["迪普西克"] },
  ]);
});

test("xlsx import treats one column as terms and two columns as corrections", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-dict-"));
  const filePath = path.join(tempDir, "dictionary.xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["可能识别错的词", "正确词"],
    ["太普太普", "typetype"],
    ["结构化润写"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "词典");
  XLSX.writeFile(workbook, filePath);

  const preview = await createDictionaryImportPreview({ file_path: filePath }, []);

  assert.equal(preview.summary.added, 2);
  assert.equal(preview.summary.replacements, 1);
  assert.equal(preview.summary.terms, 1);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("wps native files show a save-as guidance error", async () => {
  await assert.rejects(
    () => createDictionaryImportPreview({ file_path: "example.wps" }, []),
    /另存为/
  );
});
