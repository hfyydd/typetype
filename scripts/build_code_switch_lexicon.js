const fs = require("fs");
const path = require("path");

const TARGET_ENTRY_COUNT = 10000;
const repoRoot = path.join(__dirname, "..");
const lexiconPath = path.join(repoRoot, "resources", "lexicons", "code-switch-lexicon.json");

const REGIONS = ["CN", "HK", "TW"];

const DOMAIN_GROUPS = [
  {
    category: "ai",
    tags: ["ai", "machine-learning"],
    context: ["AI", "模型", "提示词", "语音", "识别", "生成", "训练", "智能"],
    prefixes: [
      "AI", "AIGC", "AGI", "LLM", "GPT", "agent", "copilot", "assistant", "prompt", "RAG",
      "embedding", "vector", "multimodal", "vision", "speech", "voice", "ASR", "STT", "TTS", "VAD",
      "OCR", "NLP", "CV", "translation", "transcription", "summarization", "rerank", "classification",
      "recommendation", "search", "knowledge", "fine-tune", "training", "inference", "eval", "benchmark",
      "guardrail", "moderation", "hallucination", "grounding", "dataset", "annotation", "LoRA", "adapter",
      "checkpoint", "quantization", "distillation", "token", "context", "reasoning", "tool calling",
      "function calling", "workflow", "automation", "memory", "planning", "retrieval", "ranking"
    ],
  },
  {
    category: "china-ai-models",
    tags: ["ai", "model", "china-ai"],
    context: ["AI", "大模型", "国产模型", "推理", "编程", "接口", "API", "智能体", "提示词"],
    prefixes: [
      "DeepSeek", "DeepSeek V4", "DeepSeek V4 Pro", "DeepSeek V4 Flash", "DeepSeek R1",
      "DeepSeek V3.2", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat",
      "deepseek-reasoner", "深度求索",
      "Qwen", "Qwen3", "Qwen3.6", "Qwen3.6 Plus", "Qwen3.6 Flash", "Qwen3.6 Max",
      "Qwen3.6 Max Preview", "Qwen3.5", "Qwen3.5 Plus", "Qwen3.5 Flash",
      "Qwen3 Coder", "Qwen3 Coder Next", "Qwen3 Next", "Qwen Omni", "Qwen VL",
      "qwen3.6-plus", "qwen3.6-flash", "qwen3.6-max-preview", "qwen3.5-plus",
      "qwen3.5-flash", "通义千问", "千问", "阿里百炼", "Model Studio",
      "Kimi", "Kimi K2", "Kimi K2.5", "Kimi K2.6", "Kimi K2 Thinking", "Moonshot",
      "moonshot-v1-8k", "moonshot-v1-32k", "月之暗面",
      "MiniMax", "MiniMax M2", "MiniMax M2.5", "MiniMax M2.7", "MiniMax M3",
      "MiniMax Text", "abab", "abab6", "MiniMax-M2.7",
      "GLM", "GLM-4", "GLM-4.7", "GLM-5", "GLM-5.1", "ChatGLM", "Zhipu",
      "Z.ai", "智谱", "智谱清言", "glm-4.7-flash", "glm-5.1",
      "Doubao", "Doubao Seed", "Doubao Seed 1.6", "Doubao Seed 2.0", "Doubao Seed 2.0 Code",
      "doubao-seed", "doubao-seed-1-6", "doubao-seed-2-0-code", "豆包", "火山方舟",
      "Hunyuan", "Tencent Hunyuan", "混元", "腾讯混元", "hunyuan-turbos",
      "ERNIE", "ERNIE Bot", "ERNIE 5.0", "Wenxin", "文心一言", "文心大模型", "百度千帆",
      "Baichuan", "Baichuan4", "百川智能", "Yi", "Yi Large", "零一万物",
      "Step", "Step 3.5", "Step 3.5 Flash", "阶跃星辰", "阶跃模型",
      "MiMo", "MiMo V2.5", "Xiaomi MiMo", "小米 MiMo", "讯飞星火", "SparkDesk",
      "商汤日日新", "SenseNova", "天工", "Tiangong", "360 智脑",
      "Wan", "Wan2.6", "Wan2.7", "通义万相", "CogVideo", "Kling", "可灵", "即梦",
      "Vidu", "海螺 AI", "Hailuo", "Sora", "Runway", "Pika"
    ],
  },
  {
    category: "development",
    tags: ["code", "engineering"],
    context: ["代码", "接口", "合并", "上线", "服务", "分支", "仓库", "测试", "开发"],
    prefixes: [
      "API", "SDK", "CLI", "UI", "UX", "frontend", "backend", "fullstack", "web", "mobile",
      "desktop", "Electron", "React", "Vue", "Angular", "Node", "TypeScript", "JavaScript", "Python",
      "Java", "Go", "Rust", "CSharp", "Swift", "Kotlin", "Flutter", "Next.js", "Express", "NestJS",
      "Spring", "Django", "FastAPI", "GraphQL", "REST", "gRPC", "WebSocket", "webhook", "callback",
      "database", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "RabbitMQ", "cache", "queue",
      "Docker", "Kubernetes", "k8s", "container", "image", "pod", "cluster", "namespace", "DevOps",
      "CI", "CD", "CI/CD", "pipeline", "build", "deploy", "release", "rollback", "hotfix", "staging",
      "production", "monitoring", "logging", "trace", "observability", "alert", "incident", "postmortem",
      "auth", "OAuth", "SSO", "JWT", "token", "cookie", "session", "TLS", "DNS", "CDN", "gateway",
      "proxy", "serverless", "microservice", "repo", "branch", "commit", "merge", "PR", "MR", "diff",
      "review", "lint", "unit test", "integration test", "e2e", "QA", "UAT"
    ],
  },
  {
    category: "product",
    tags: ["product", "growth", "agile"],
    context: ["产品", "需求", "版本", "增长", "用户", "数据", "迭代", "体验"],
    prefixes: [
      "product", "PRD", "MRD", "BRD", "MVP", "MLP", "PMF", "roadmap", "backlog", "sprint",
      "scrum", "kanban", "epic", "story", "user story", "acceptance", "use case", "persona",
      "user journey", "journey map", "prototype", "wireframe", "mockup", "user flow", "feature",
      "requirement", "spec", "design doc", "release plan", "iteration", "version", "alpha", "beta",
      "GA", "gray release", "A/B test", "experiment", "hypothesis", "metric", "North Star", "funnel",
      "conversion", "activation", "retention", "churn", "cohort", "DAU", "WAU", "MAU", "ARPU",
      "ARPPU", "LTV", "CAC", "NPS", "CSAT", "RICE", "ICE", "MoSCoW", "user research",
      "usability", "survey", "interview", "insight", "pain point", "scenario", "workflow", "playbook",
      "growth", "landing page", "homepage", "pricing", "paywall", "subscription", "trial", "freemium",
      "onboarding", "notification", "push", "inbox", "dashboard", "analytics", "tracking", "event tracking"
    ],
  },
  {
    category: "design",
    tags: ["design", "creative", "tools"],
    context: ["设计", "稿", "页面", "组件", "视觉", "交互", "素材"],
    prefixes: [
      "Figma", "FigJam", "Sketch", "Photoshop", "Illustrator", "Canva", "Miro", "Framer", "Principle",
      "After Effects", "Premiere", "Final Cut", "Keynote", "PowerPoint", "PPT", "Google Slides", "template",
      "theme", "layout", "grid", "spacing", "margin", "padding", "typography", "font", "icon",
      "illustration", "banner", "poster", "cover", "thumbnail", "mockup", "prototype", "interaction",
      "animation", "transition", "hover", "click", "component", "variant", "auto layout", "design system",
      "style guide", "brand guideline", "wireframe", "user flow", "sitemap", "responsive", "mobile",
      "desktop", "tablet", "dark mode", "light mode", "logo", "brand", "palette", "token", "asset"
    ],
  },
  {
    category: "workplace",
    tags: ["office", "meeting"],
    context: ["会议", "同步", "安排", "汇报", "项目", "团队", "客户", "文档"],
    prefixes: [
      "meeting", "agenda", "minutes", "memo", "brief", "briefing", "presentation", "deck", "slide",
      "workshop", "brainstorm", "standup", "stand-up", "one-on-one", "townhall", "all hands", "kickoff",
      "sync", "alignment", "checkpoint", "review", "feedback", "follow up", "action item", "to do",
      "todo", "handover", "onboarding", "offboarding", "training", "sharing", "Q&A", "FAQ", "deadline",
      "timeline", "schedule", "calendar", "invite", "booking", "check in", "update", "weekly", "monthly",
      "quarterly", "OKR", "KPI", "target", "goal", "owner", "stakeholder", "decision maker", "priority",
      "blocker", "risk", "issue", "escalation", "status", "progress", "milestone", "deliverable",
      "output", "input", "scope", "out of scope", "resource", "capacity", "bandwidth", "backup"
    ],
  },
  {
    category: "hk-tw-drama-code-mix",
    tags: ["hong-kong", "taiwan", "daily", "drama-dialogue"],
    regions: ["HK", "TW", "CN"],
    context: ["朋友", "同事", "客户", "老板", "家人", "约", "讲", "发", "看", "帮我"],
    prefixes: [
      "check 一下", "check 下", "check 咗", "check 返", "check 清楚", "check schedule",
      "confirm 一下", "confirm 下", "confirm 咗", "confirm 返", "confirm booking",
      "book 位", "book 房", "book 台", "book 酒店", "booking reference", "reservation",
      "cancel 咗", "cancel booking", "reschedule 一下", "mark 低", "mark 住",
      "call 我", "call 你", "call 返", "miss call", "video call", "conference call",
      "send 给我", "send 畀我", "send 个 file", "send email", "send message", "forward 给我",
      "reply 我", "reply email", "CC 我", "BCC 我", "follow up 一下", "follow 返",
      "update 我", "update 下", "remind 我", "set reminder", "set alarm",
      "save 低", "save 住", "backup 一份", "print 出来", "scan 一下", "upload 上去",
      "download 落嚟", "share link", "copy link", "paste 上去", "login 进去",
      "logout 先", "password 错", "reset password", "account locked",
      "WhatsApp 我", "WhatsApp group", "Line 我", "Telegram 我", "Signal 我",
      "Zoom meeting", "Teams meeting", "Google Meet", "send 个 invite",
      "open camera", "mute 咗", "unmute 先", "share screen", "record meeting",
      "file 唔见", "folder 入面", "drive 入面", "document version", "Excel file",
      "Word file", "PPT deck", "presentation deck", "proposal draft", "report draft",
      "project 跟进", "case 跟进", "client 到咗", "customer call", "boss 找你",
      "manager approve", "HR call", "interview schedule", "offer letter",
      "happy hour", "after party", "shopping mall", "coffee shop", "take away",
      "delivery 到咗", "order 咗", "payment 过咗", "refund 申请", "coupon code",
      "VIP room", "check in", "check out", "boarding pass", "gate number",
      "delay 咗", "traffic jam", "parking 位", "taxi stand", "Uber 叫咗",
      "meeting room", "conference room", "office hour", "lunch time", "tea time",
      "deadline 到", "schedule 满", "budget 唔够", "plan B", "make sure", "double check",
      "no problem", "okay 啦", "sure 啦", "sorry 啦", "thanks 啦", "bye 先",
      "feel 到", "care 你", "support 你", "trust 我", "promise 我", "relax 下",
      "chill 下", "focus 一下", "low battery", "phone 没电", "charger 借我",
      "Wi-Fi password", "network 断咗", "signal 差", "app crash", "screen lock",
      "notification 弹出", "profile photo", "status update", "story post", "live stream"
    ],
  },
  {
    category: "collaboration-tools",
    tags: ["tool", "saas"],
    context: ["工具", "文档", "会议", "平台", "消息", "链接", "账号"],
    prefixes: [
      "Slack", "Teams", "Zoom", "Google Meet", "Meet", "Webex", "Lark", "Feishu", "DingTalk",
      "WeCom", "WeChat Work", "Notion", "Confluence", "Google Docs", "Google Drive", "OneDrive",
      "Dropbox", "SharePoint", "Airtable", "Excel", "Word", "PowerPoint", "Outlook", "Gmail",
      "Calendar", "Trello", "Asana", "Linear", "Monday", "ClickUp", "Jira", "Zendesk", "Intercom",
      "Salesforce", "HubSpot", "Shopify", "Stripe", "PayPal", "Wise", "Zapier", "Make", "IFTTT",
      "GitHub", "GitLab", "Bitbucket", "Vercel", "Netlify", "Cloudflare", "AWS", "Azure", "GCP",
      "Aliyun", "Tencent Cloud", "Volcengine", "Hugging Face", "OpenAI", "Anthropic", "Gemini",
      "DeepSeek", "Qwen", "Kimi", "MiniMax", "Doubao", "Zhipu", "Moonshot"
    ],
  },
  {
    category: "sales-marketing-ecommerce",
    tags: ["sales", "marketing", "ecommerce"],
    context: ["销售", "客户", "投放", "电商", "转化", "订单", "库存", "直播"],
    prefixes: [
      "sales", "BD", "lead", "prospect", "pipeline", "CRM", "customer success", "CS", "account",
      "account manager", "AM", "key account", "KA", "quotation", "quote", "PO", "SO", "invoice",
      "contract", "renewal", "upsell", "cross-sell", "churn", "retention", "campaign", "SEO",
      "SEM", "ads", "ad group", "keyword", "CPC", "CPM", "CPA", "CTR", "CVR", "ROI", "ROAS",
      "impression", "click", "traffic", "landing page", "conversion", "funnel", "KOL", "KOC",
      "influencer", "livestream", "live streaming", "GMV", "SKU", "SPU", "inventory", "stock",
      "fulfillment", "logistics", "warehouse", "supply chain", "coupon", "voucher", "discount",
      "promotion", "bundle", "affiliate", "marketplace", "merchant", "shop", "store",
      "product listing", "checkout", "payment", "refund"
    ],
  },
  {
    category: "business-finance-legal",
    tags: ["business", "finance", "legal"],
    context: ["财务", "合同", "采购", "法务", "预算", "审计", "合规"],
    prefixes: [
      "budget", "forecast", "P&L", "profit and loss", "revenue", "cost", "gross margin", "margin",
      "EBITDA", "ARR", "MRR", "GMV", "ARPU", "LTV", "CAC", "ROI", "cash flow", "capex", "opex",
      "invoice", "receipt", "reimbursement", "expense", "procurement", "vendor", "supplier", "RFP",
      "RFQ", "POC", "pilot", "contract", "NDA", "SLA", "SOW", "MSA", "compliance", "audit",
      "due diligence", "risk control", "KYC", "AML", "legal", "privacy", "GDPR", "DPA", "security",
      "ISO", "SOC 2", "license", "copyright", "trademark", "patent", "approval", "settlement"
    ],
  },
  {
    category: "education-research",
    tags: ["education", "research"],
    context: ["论文", "实验", "课程", "申请", "考试", "研究", "数据"],
    prefixes: [
      "paper", "abstract", "introduction", "method", "methodology", "experiment", "result",
      "discussion", "conclusion", "reference", "citation", "dataset", "baseline", "ablation",
      "case study", "survey", "questionnaire", "thesis", "proposal", "seminar", "lecture",
      "course", "assignment", "quiz", "exam", "GPA", "IELTS", "TOEFL", "GRE", "GMAT", "SAT",
      "application", "offer", "deadline", "scholarship", "recommendation letter", "CV", "resume",
      "lab", "notebook", "review", "peer review", "conference", "journal", "preprint"
    ],
  },
  {
    category: "medical-health",
    tags: ["medical", "health"],
    context: ["医院", "检查", "治疗", "病例", "患者", "临床", "报告"],
    prefixes: [
      "CT", "MRI", "ECG", "ICU", "ER", "DNA", "RNA", "PCR", "antigen", "antibody", "vaccine",
      "booster", "diagnosis", "screening", "follow up", "clinic", "therapy", "rehab", "BMI",
      "blood pressure", "glucose", "cholesterol", "medical record", "case report", "guideline",
      "trial", "phase 1", "phase 2", "phase 3", "placebo", "randomized", "control group",
      "patient", "doctor", "nurse", "hospital", "pharmacy", "prescription"
    ],
  },
];

const ARTIFACTS = [
  "platform", "dashboard", "console", "portal", "app", "client", "server", "engine", "service",
  "system", "module", "component", "widget", "plugin", "extension", "connector", "integration",
  "automation", "workflow", "pipeline", "template", "framework", "library", "package", "runtime",
  "agent", "assistant", "bot", "copilot", "model", "dataset", "vector", "index", "database",
  "cache", "queue", "topic", "stream", "event", "job", "worker", "scheduler", "trigger", "rule",
  "policy", "guardrail", "gateway", "proxy", "endpoint", "webhook", "callback", "API", "SDK",
  "CLI", "UI", "UX", "page", "flow", "funnel", "journey", "persona", "scenario", "use case",
  "feature", "requirement", "spec", "PRD", "roadmap", "backlog", "sprint", "epic", "story",
  "experiment", "metric", "KPI", "OKR", "report", "chart", "insight", "alert", "monitor",
  "log", "trace", "profile", "audit", "compliance", "risk", "permission", "role", "token",
  "session", "certificate", "license", "invoice", "quote", "contract", "renewal", "plan",
  "pricing", "subscription", "payment", "checkout", "order", "shipment", "inventory", "campaign",
  "lead", "account", "contact", "ticket", "case", "knowledge base", "FAQ", "document", "file",
  "folder", "drive", "calendar", "reminder", "checklist", "minutes", "memo", "brief", "playbook",
  "runbook", "SOP", "helpdesk", "support", "feedback", "survey", "notification", "message",
  "inbox", "search", "recommendation", "ranking", "translation", "transcription", "summary"
];

const ACTIONS = [
  "create", "edit", "review", "approve", "publish", "release", "deploy", "rollback", "sync",
  "import", "export", "upload", "download", "share", "archive", "restore", "merge", "split",
  "schedule", "reschedule", "track", "monitor", "alert", "analyze", "optimize", "automate",
  "integrate", "migrate", "backup", "restore", "validate", "verify", "test", "debug", "fix",
  "refactor", "generate", "summarize", "translate", "transcribe", "classify", "rerank", "search"
];

const HK_TW_DRAMA_VERBS = [
  "check", "confirm", "book", "send", "forward", "reply", "call", "WhatsApp", "Line", "Telegram",
  "DM", "message", "update", "follow up", "remind", "save", "mark", "copy", "paste", "print",
  "scan", "upload", "download", "share", "login", "reset", "cancel", "reschedule", "reserve",
  "order", "refund", "pay", "transfer", "charge", "focus", "relax", "chill", "support", "trust"
];

const HK_TW_DRAMA_OBJECTS = [
  "meeting", "schedule", "booking", "file", "email", "message", "link", "photo", "video", "voice",
  "document", "Excel", "Word", "PPT", "deck", "proposal", "report", "contract", "invoice",
  "payment", "order", "coupon", "reservation", "table", "room", "hotel", "flight", "taxi",
  "Uber", "address", "location", "password", "account", "Wi-Fi", "camera", "screen", "group",
  "client", "customer", "boss", "manager", "HR", "interview", "offer", "deadline", "budget",
  "plan", "plan B", "case", "project", "task", "ticket", "profile", "status", "story", "post"
];

const HK_TW_DRAMA_PATTERNS = [
  "{verb} 一下",
  "{verb} 下",
  "{verb} 咗",
  "{verb} 返",
  "{verb} 个 {object}",
  "{verb} 個 {object}",
  "{verb} 份 {object}",
  "{verb} 个{object}",
  "{verb} {object}",
  "{verb} {object} 俾我",
  "{verb} {object} 畀我",
  "{verb} {object} 给我",
  "帮我 {verb} {object}",
  "幫我 {verb} {object}",
  "我哋 {verb} {object}",
  "我們 {verb} {object}",
  "你有冇 {verb} {object}",
  "你有没有 {verb} {object}",
  "{object} {verb} 咗未",
  "{object} {verb} 了没",
];

const MANUAL_ALIASES = {
  meeting: ["密厅", "咪厅", "米听", "开meeting", "开个meeting"],
  deadline: ["带的line", "带的赖", "戴德line", "死线", "截止deadline"],
  review: ["瑞view", "re view", "瑞由", "瑞优", "做review"],
  sync: ["辛克", "sink", "同步sync", "sync一下"],
  schedule: ["skedule", "赛究", "赛久", "排schedule"],
  PPT: ["ppt", "皮皮踢", "批批踢", "屁屁踢", "做PPT"],
  PR: ["pr", "P R", "P R", "皮阿", "批阿", "披儿", "pull request"],
  API: ["api", "A P I", "诶批爱", "欸批唉", "接口API"],
  KPI: ["kpi", "K P I", "开皮爱", "考核KPI"],
  OKR: ["okr", "O K R", "欧开啊", "目标OKR"],
  GitHub: ["github", "git hub", "吉特哈布", "鸡特哈布"],
  Figma: ["figma", "figma稿", "飞igma", "菲格马"],
  Zoom: ["zoom", "zoom会议", "祖母会议", "租母会议"],
  Teams: ["teams", "team上", "提姆斯"],
  Notion: ["notion", "诺神", "糯tion", "notion文档"],
  commit: ["康密特", "提交commit", "commit一下"],
  deploy: ["迪ploy", "地ploy", "部署deploy", "deploy一下"],
  merge: ["么之", "合并merge", "merge进去"],
  release: ["瑞lease", "发版release", "版本release"],
  roadmap: ["路线图roadmap", "肉map", "罗德map"],
  backlog: ["back log", "需求池backlog", "摆log"],
  sprint: ["斯print", "迭代sprint", "冲刺sprint"],
  PRD: ["prd", "P R D", "产品文档PRD", "皮阿地"],
  MVP: ["mvp", "M V P", "最小可用MVP", "诶木维皮"],
  QA: ["qa", "Q A", "扣诶", "测试QA"],
  bug: ["Bug", "八哥", "霸哥", "这个bug"],
  demo: ["Demo", "得摸", "演示demo", "demo一下"],
  prompt: ["普rompt", "提示词prompt", "写prompt"],
  token: ["Token", "托肯", "扣token"],
  workflow: ["work flow", "工作流workflow", "沃克flow"]
};

const FALSE_POSITIVES = {
  PR: ["披啊", "皮啊", "公关"],
  review: ["评审材料", "评审会"],
};

const SHORT_HIGH_RISK = new Set(["PR", "AE", "AM", "CS", "DB", "ER", "GA", "KA", "MR", "QA", "SO", "UI", "UX"]);

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function riskFor(term, fallback = "low") {
  if (SHORT_HIGH_RISK.has(term)) {
    return "high";
  }
  if (/^[A-Z]{2,3}$/.test(term) || term.length <= 3) {
    return "medium";
  }
  return fallback;
}

function aliasesFor(term) {
  const aliases = new Set([term]);
  const lower = term.toLowerCase();
  const upper = term.toUpperCase();
  if (lower !== term) aliases.add(lower);
  if (/^[A-Za-z]{2,6}$/.test(term)) {
    aliases.add(upper);
    aliases.add(Array.from(upper).join(" "));
  }
  if (term.includes(" ")) {
    aliases.add(term.replace(/\s+/g, "-"));
    aliases.add(term.replace(/\s+/g, ""));
  }
  for (const alias of MANUAL_ALIASES[term] || []) {
    aliases.add(alias);
  }
  aliases.add(`做${term}`);
  aliases.add(`${term}一下`);
  aliases.add(`${term}会议`);
  aliases.add(`${term}文档`);
  return Array.from(aliases);
}

function makeEntry(term, meta) {
  return {
    term,
    aliases: dedupe(aliasesFor(term)),
    category: meta.category,
    regions: meta.regions || REGIONS,
    tags: dedupe(meta.tags || []),
    risk: meta.risk || riskFor(term),
    ...(meta.context ? { context_keywords: dedupe(meta.context) } : {}),
    ...(FALSE_POSITIVES[term] ? { false_positive_context: FALSE_POSITIVES[term] } : {}),
  };
}

function mergeEntry(map, entry) {
  const term = String(entry.term || "").trim();
  if (!term) return false;
  const existing = map.get(term);
  const normalized = {
    term,
    aliases: dedupe([term, ...(entry.aliases || [])]),
    category: entry.category || "general",
    regions: dedupe(entry.regions || REGIONS),
    tags: dedupe(entry.tags || []),
    risk: ["low", "medium", "high"].includes(entry.risk) ? entry.risk : riskFor(term),
    ...(entry.context_keywords ? { context_keywords: dedupe(entry.context_keywords) } : {}),
    ...(entry.false_positive_context ? { false_positive_context: dedupe(entry.false_positive_context) } : {}),
  };
  if (!existing) {
    map.set(term, normalized);
    return true;
  }
  existing.aliases = dedupe([...existing.aliases, ...normalized.aliases]);
  existing.regions = dedupe([...existing.regions, ...normalized.regions]);
  existing.tags = dedupe([...existing.tags, ...normalized.tags]);
  existing.context_keywords = dedupe([...(existing.context_keywords || []), ...(normalized.context_keywords || [])]);
  existing.false_positive_context = dedupe([...(existing.false_positive_context || []), ...(normalized.false_positive_context || [])]);
  return false;
}

function addGeneratedEntries(map) {
  for (const group of DOMAIN_GROUPS) {
    for (const prefix of group.prefixes) {
      mergeEntry(map, makeEntry(prefix, group));
    }
  }

  addDramaPhraseEntries(map, 3500);

  for (const artifact of ARTIFACTS) {
    for (const group of DOMAIN_GROUPS) {
      for (const prefix of group.prefixes) {
        if (map.size >= TARGET_ENTRY_COUNT) return;
        if (prefix.toLowerCase() === artifact.toLowerCase()) continue;
        mergeEntry(map, makeEntry(`${prefix} ${artifact}`, group));
      }
    }
  }

  for (const action of ACTIONS) {
    for (const group of DOMAIN_GROUPS) {
      for (const prefix of group.prefixes) {
        if (map.size >= TARGET_ENTRY_COUNT) return;
        mergeEntry(map, makeEntry(`${action} ${prefix}`, group));
      }
    }
  }
}

function addDramaPhraseEntries(map, maxNewEntries) {
  const group = DOMAIN_GROUPS.find((item) => item.category === "hk-tw-drama-code-mix");
  if (!group) return;

  let added = 0;
  for (const verb of HK_TW_DRAMA_VERBS) {
    for (const object of HK_TW_DRAMA_OBJECTS) {
      for (const pattern of HK_TW_DRAMA_PATTERNS) {
        if (map.size >= TARGET_ENTRY_COUNT || added >= maxNewEntries) return;
        const phrase = pattern.replace("{verb}", verb).replace("{object}", object);
        if (mergeEntry(map, makeEntry(phrase, group))) {
          added += 1;
        }
      }
    }
  }
}

const entriesByTerm = new Map();
addGeneratedEntries(entriesByTerm);

if (entriesByTerm.size < TARGET_ENTRY_COUNT) {
  throw new Error(`code-switch lexicon only has ${entriesByTerm.size} entries; expected ${TARGET_ENTRY_COUNT}`);
}

const entries = Array.from(entriesByTerm.values()).slice(0, TARGET_ENTRY_COUNT);

const output = {
  version: 1,
  target_entry_count: TARGET_ENTRY_COUNT,
  generated_at: "2026-06-04",
  entries,
};

fs.mkdirSync(path.dirname(lexiconPath), { recursive: true });
fs.writeFileSync(lexiconPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`code-switch lexicon: ${entries.length} entries -> ${lexiconPath}`);
