"""按规则文件把敏感字符串替换成通用占位符。

规则文件默认读 tools/privacy_rules.local.json（已 gitignore，不入库），格式：

    {
      "files": ["AddIn/lyrics-server/batch_list.txt", "..."],
      "rules": [
        ["<要替换的原始字符串>", "<占位符>"],
        ["<另一个原始字符串>", "<另一个占位符>"]
      ]
    }

规则按数组顺序应用，因此**长的、完整的字符串要排在前面**，
否则短规则会先把长字符串切碎，导致后面的规则匹配不到。

用法：
    python tools/sanitize_privacy.py              # dry-run，只报告
    python tools/sanitize_privacy.py --apply      # 实际写入
    python tools/sanitize_privacy.py --rules my.json
"""
import json
import os
import sys

DEFAULT_RULES = os.path.join(os.path.dirname(__file__), "privacy_rules.local.json")


def main():
    args = sys.argv[1:]
    apply = "--apply" in args
    rules_path = DEFAULT_RULES
    if "--rules" in args:
        rules_path = args[args.index("--rules") + 1]

    if not os.path.exists(rules_path):
        print(f"找不到规则文件：{rules_path}")
        print("请参考 tools/privacy_rules.example.json 创建后重试。")
        return 1

    cfg = json.load(open(rules_path, encoding="utf-8"))
    files = cfg.get("files", [])
    rules = [(str(a), str(b)) for a, b in cfg.get("rules", [])]

    changed = 0
    for path in files:
        if not os.path.exists(path):
            print("跳过（不存在）:", path)
            continue
        text = open(path, encoding="utf-8").read()
        new = text
        hits = []
        for old, rep in rules:
            n = new.count(old)
            if n:
                hits.append((old, rep, n))
                new = new.replace(old, rep)
        if new == text:
            print("无需修改:", path)
            continue
        print(f"\n{path}")
        for old, rep, n in hits:
            # 只显示长度，不回显原文，避免把敏感内容打到日志里
            print(f"  {n} 处  {len(old)} 字符  →  {rep!r}")
        changed += 1
        if apply:
            open(path, "w", encoding="utf-8", newline="").write(new)

    print(f"\n{'已写入' if apply else 'dry-run'}：{changed} 个文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
