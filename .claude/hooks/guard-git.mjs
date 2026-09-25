// PreToolUse guard for Claude Code. Permission deny rules match command prefixes only, so this
// inspects the full command text as a second layer. Exit code 2 blocks the tool call and sends
// stderr to Claude. It is a seatbelt, not a vault: GitHub rulesets + CI are the real enforcement.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};

const block = (reason) => {
  process.stderr.write(
    `Blocked by repository Git policy: ${reason}\n` +
      'This is an automated guard, not a bug to work around. Do not retry with a different spelling; ' +
      'mention it in the end-of-session report so the developer can do it themselves.\n',
  );
  process.exit(2);
};

if (tool === 'Bash') {
  const cmd = String(args.command ?? '');
  const rules = [
    [/\bgit\b[^\n;&|]*\s(push|merge|rebase|tag|filter-branch|filter-repo|update-ref|replace)\b/, 'push/merge/rebase/tag/history rewrites are done by the developer'],
    [/\bgit\b[^\n;&|]*\sreset\s+--hard\b/, 'git reset --hard can destroy work'],
    [/\bgit\b[^\n;&|]*\sclean\s+-\w*f/, 'git clean -f deletes untracked files'],
    [/\bgit\b[^\n;&|]*\sconfig\b/, 'git configuration (including core.hooksPath) is owned by the developer'],
    [/--no-verify\b/, 'hooks must not be skipped'],
    [/\bgit\b[^\n;&|]*\scommit\b[^\n;&|]*\s-[a-zA-Z]*n[a-zA-Z]*\b/, 'git commit -n skips hooks'],
    [/\bgit\b[^\n;&|]*\scheckout\s+(master|pre-release|release\/\S+)\s*$/m, 'stay on the session branch; branch from master with: git switch -c feature/<name> master'],
    [/\bgh\s+(pr\s+merge|api|repo\s+edit|release)\b/, 'repository administration is done by the developer'],
    [/\b(sh|bash)\s+-c\b[^\n]*\bgit\b|\beval\b[^\n]*\bgit\b/, 'wrapped git commands are not allowed'],
    [/\b(cat|type|more|less|head|tail|grep|sed|awk)\b[^\n]*[\s\/'"]\.env(?![\w.])/, '.env holds secrets; use .env.example'],
  ];
  for (const [pattern, reason] of rules) if (pattern.test(cmd)) block(reason);
}

if (['Edit', 'MultiEdit', 'Write'].includes(tool)) {
  const file = String(args.file_path ?? '').replaceAll('\\', '/');
  const protectedPaths = [/\/\.githooks\//, /\/scripts\/git\//, /\/\.claude\//, /\/\.github\/workflows\/git-policy\.yml$/, /(^|\/)\.env$/];
  if (protectedPaths.some((p) => p.test(file))) block(`${file} is part of the policy or holds secrets`);
}
process.exit(0);
