import { groupBySection } from '../src/features/commands/grouping';

const c = (id: string, section?: string) => ({ id, label: id, section: section as string, confirm: false });

it('keeps first-appearance order and falls back to General', () => {
  const out = groupBySection([c('1', 'B'), c('2', 'A'), c('3', 'B'), c('4'), c('5', '  ')]);
  expect(out.map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([
    ['B', ['1', '3']],
    ['A', ['2']],
    ['General', ['4', '5']],
  ]);
});

it('returns nothing for no commands', () => {
  expect(groupBySection([])).toEqual([]);
});
