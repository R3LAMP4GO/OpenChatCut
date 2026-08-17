import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EN } from './dict/en';
import { t } from './locale';

const screenshotStrings = [
  ['示例工程', 'Sample Project'],
  [
    '把新闻素材粗剪为一条内容完整、逻辑清晰、节奏紧凑的新闻短视频，不加任何外部声音。',
    'Turn news footage into a complete, clear, tightly paced news short without adding external audio.',
  ],
  [
    '把重复流程或想法做成可复用的自定义技能（SKILL.md），并安装到本机技能目录。',
    'Turn repeatable workflows or ideas into reusable custom skills (SKILL.md) installed on this machine.',
  ],
] as const;

for (const [source, expected] of screenshotStrings) {
  assert.equal(EN[source], expected, `English dictionary is missing screenshot text: ${source}`);
  assert.equal(t(source), expected, `English UI did not translate screenshot text: ${source}`);
  assert(!/[\u3400-\u9fff]/u.test(t(source)), `English UI still contains Han characters: ${t(source)}`);
}

const topBar = await readFile(new URL('../components/TopBar.tsx', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../components/dashboard/DashboardViews.tsx', import.meta.url), 'utf8');
const skillPanel = await readFile(new URL('../library/SkillsTabPanel.tsx', import.meta.url), 'utf8');
assert.match(topBar, />\{t\(projectName\)\}<\/span>/, 'top bar must localize a legacy default project name');
assert.match(dashboard, />\{t\(project\.name\)\}<\/div>/, 'dashboard must localize a legacy default project name');
assert.match(skillPanel, /\{t\(skill\.summary\)\}/, 'skill summaries must pass through English localization');

console.log('ENGLISH_UI_NO_CHINESE_PASSED: screenshot project title and skill summaries render in English');
