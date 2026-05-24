# typetype 内置系统基础词库来源

typetype 的系统基础词库只用于本地术语保护、转写纠错辅助和 LLM 润写保留提示，不会上传用户数据，也不会强制替换原文。

## 来源

- 人工整理安全词：typetype 项目维护。
- jieba 中文分词词典：https://github.com/fxsjy/jieba ，MIT License。
- THUOCL 清华开放中文词库：https://github.com/thunlp/THUOCL ，MIT License。
- OpenCC 短语词典：https://github.com/BYVoid/OpenCC ，Apache License 2.0。

## 处理方式

- 保留 2-80 个字符的常用词、专业词、短语和中英文混合术语。
- 去除纯数字、空行和明显无效条目。
- 重复词按首次来源保留；人工高权重词优先，其次为 THUOCL、OpenCC、jieba。
