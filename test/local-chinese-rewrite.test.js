const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalRewritePromptContext,
  rewriteChineseLocally,
} = require("../dist-electron/local-chinese-rewrite.js");

test("local Chinese rewrite creates distinct refined raw text and structured draft", () => {
  const raw = "党支部党支部高度重视此次廉政档案自查工作将其作为检验队伍廉洁健康状况防范化解廉政风险的重要抓手对照廉政档案管理规范采取个人自查填表支部集中审阅逐项核对登记的方式对监区全体民警的廉政档案进行了全覆盖式的廉政体检此次自查重点围绕民警的填报格式领导干部的述职报告本人承诺等关键内容展开";
  const result = rewriteChineseLocally({
    rawText: raw,
    scenario: "official_report",
    preserveTerms: ["党支部", "廉政档案"],
    final: true,
  });

  assert.equal(result.refinedRawText.includes("。"), true);
  assert.equal(result.refinedRawText.includes("，"), true);
  assert.equal(result.structuredText.includes("报告"), true);
  assert.equal(result.structuredText.includes("一、报告事项"), true);
  assert.notEqual(result.structuredText, result.refinedRawText);
  assert.equal(result.refinedRawText.includes("党支部党支部"), false);
});

test("local Chinese rewrite structures notices and keeps placeholders instead of inventing facts", () => {
  const result = rewriteChineseLocally({
    rawText: "通知下周一下午三点召开安全生产会议地点三楼会议室各部门负责人参加要求带上本月整改台账",
    scenario: "business_notice",
    final: true,
  });

  assert.equal(result.structuredText.includes("通知对象：待补充"), true);
  assert.equal(result.structuredText.includes("联系人、联系电话、发文机关和日期待补充"), true);
  assert.equal(result.structuredText.includes("安全生产会议"), true);
});

test("local rewrite prompt context helps API rewrite with local preprocessing", () => {
  const result = rewriteChineseLocally({
    rawText: "首先今天讨论MiniMax然后安排张三下周提交材料",
    scenario: "meeting_notes",
    preserveTerms: ["MiniMax", "张三"],
    final: true,
  });
  const context = buildLocalRewritePromptContext(result);

  assert.equal(context.includes("本地修正原文"), true);
  assert.equal(context.includes("本地分段要点"), true);
  assert.equal(context.includes("本地结构化草稿"), true);
  assert.equal(context.includes("必须保留术语：MiniMax、张三"), true);
});

test("semantic punctuation handles long official academic dictation", () => {
  const raw = "在国家治理体系与治理能力现代化的进程中数据治理的相关研究多聚焦于政务与商业领域相较而言针对监狱这一兼具高封闭性与强安全需求的特殊场域其系统性数据管理框架的研究仍较薄弱亟待深入探索当前监狱信息化建设取得显著成果的同时也因历史发展与认知局限逐步暴露出深层的数据困境各类业务系统独立建设标准不一形成了难以互通的数据孤岛跨部门协作方面高度依赖人工对接文件流转效率较低且错误频发各类业务系统数据参差不齐存在安全隐患";
  const result = rewriteChineseLocally({
    rawText: raw,
    scenario: "official_report",
    final: true,
  });
  const strongPunctuationCount = (result.refinedRawText.match(/[。；：]/g) || []).length;

  assert.equal(result.refinedRawText.includes("在国家治理体系与治理能力现代化的进程中，"), true);
  assert.equal(result.refinedRawText.includes("相较而言，针对监狱"), true);
  assert.equal(result.refinedRawText.includes("数据管理框架"), true);
  assert.equal(result.refinedRawText.includes("亟待深入探索"), true);
  assert.equal(result.refinedRawText.includes("数据管，理"), false);
  assert.equal(result.refinedRawText.includes("亟，待"), false);
  assert.ok(strongPunctuationCount >= 4);
  assert.notEqual(result.structuredText, result.refinedRawText);
  assert.equal(result.structuredText.includes("一、报告事项"), true);
});

test("semantic punctuation protects dates standards model names and percentages", () => {
  const result = rewriteChineseLocally({
    rawText: "请按照GB/T 15834-2011要求在2026年6月2日完成MiniMax-M2.7模型测试准确率达到98.5%以后再提交报告",
    scenario: "work_report",
    preserveTerms: ["MiniMax-M2.7"],
    final: true,
  });

  assert.equal(result.refinedRawText.includes("GB/T 15834-2011"), true);
  assert.equal(result.refinedRawText.includes("2026年6月2日"), true);
  assert.equal(result.refinedRawText.includes("MiniMax-M2.7"), true);
  assert.equal(result.refinedRawText.includes("98.5%"), true);
});

test("local rewrite punctuates casual streaming speech with modal particles", () => {
  const result = rewriteChineseLocally({
    rawText: "啊现在啊我看看点精神不好抱个鸡呗就当没有这事得了呗不过玩意爆了昨昨的兄弟现在太幽默了这都是没啥事就么不管好人管刀人啊人真提出来一个没人送咋解释我这不是扯淡呢吗你整啥呢测试",
    scenario: "general",
    final: false,
  });

  assert.equal(result.refinedRawText.startsWith("啊"), false);
  assert.equal(result.refinedRawText.includes("得了呗。不过"), true);
  assert.equal(result.refinedRawText.includes("咋解释？"), true);
  assert.equal(result.refinedRawText.includes("扯淡呢吗？"), true);
  assert.equal(result.refinedRawText.includes("你整啥呢？"), true);
  assert.ok((result.refinedRawText.match(/[。？]/g) || []).length >= 5);
});

test("local rewrite restores semantic punctuation for streaming final text", () => {
  const result = rewriteChineseLocally({
    rawText: "下一个重点是讨论一下要怎么让更新通过线上更新来处理也就是说就算有报错也可以通过线上下载",
    scenario: "general",
    final: true,
  });

  assert.equal(result.refinedRawText.includes("下一个重点是讨论一下"), true);
  assert.equal(result.refinedRawText.includes("也就是说"), true);
  assert.equal(result.refinedRawText.endsWith("。"), true);
  assert.ok((result.refinedRawText.match(/[，。]/g) || []).length >= 2);
});
