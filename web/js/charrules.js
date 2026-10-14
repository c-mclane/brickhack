// Which roles, races, genders and alignments go together, by the game's own
// rules (exported from the patched engine by tools/roles2json.py): a role and
// a race go together if they share a race group, a gender and an alignment;
// a gender or alignment is allowed if both the role and the race allow it.
// 'random' goes with anything (the game picks something that fits).

let rulesP = null;
export function loadRules() {
  if (!rulesP) rulesP = fetch('assets/slashem/roles.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return rulesP;
}

const shared = (a, b) => a.some((x) => b.includes(x));

// pick: {role, race, gender, align} as the creation screen shows them
// ('Knight', 'elf', 'female', 'lawful', 'random').  Returns the keys of the
// other choices that the value `v` for `key` can't go with ([] if it fits).
export function conflicts(rules, pick, key, v) {
  if (!rules || v === 'random') return [];
  const p = { ...pick, [key]: v };
  const role = p.role !== 'random' ? rules.roles[p.role] : null;
  const race = p.race !== 'random' ? rules.races[p.race] : null;
  const bad = new Set();
  if (role && race && !(shared(role.races, race.races) && shared(role.genders, race.genders) && shared(role.aligns, race.aligns)))
    bad.add(key === 'role' ? 'race' : 'role');
  for (const [k, list] of [['gender', 'genders'], ['align', 'aligns']]) {
    if (p[k] === 'random') continue;
    if (role && !role[list].includes(p[k])) bad.add(k === key ? 'role' : k);
    if (race && !race[list].includes(p[k])) bad.add(k === key ? 'race' : k);
  }
  bad.delete(key);
  return [...bad];
}
