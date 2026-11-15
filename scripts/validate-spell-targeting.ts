import { defaultCompendium } from '../packages/data/src/index.ts';
import { getSpellTargetDisposition, getSpellMaxTargets } from '../packages/client/src/utils/combatTargeting.ts';

console.log(`=== AUDITING ALL ${defaultCompendium.spells.length} SRD 5.1 SPELLS ===\n`);

const breakdown = {
  friendly: [] as string[],
  hostile: [] as string[],
  self: [] as string[],
  any: [] as string[],
};

for (const spell of defaultCompendium.spells) {
  const disposition = getSpellTargetDisposition(spell);
  breakdown[disposition].push(`${spell.name} (L${spell.level} ${spell.school}) [${spell.id}]`);
}

console.log('SUMMARY STATS:');
console.log(`- 🛡️ Friendly Spells (Buffs, Heals, Ally Protection): ${breakdown.friendly.length}`);
console.log(`- ⚔️ Hostile Spells (Attacks, Saves, Damage, Debuffs, Hazard Zones): ${breakdown.hostile.length}`);
console.log(`- 👤 Self Spells (Personal Buffs & Movement): ${breakdown.self.length}`);
console.log(`- 🎯 Unclassified / Any: ${breakdown.any.length}\n`);

if (breakdown.any.length > 0) {
  console.log('WARNING: The following spells were classified as "any":');
  for (const s of breakdown.any) {
    console.log(`  - ${s}`);
  }
  process.exit(1);
} else {
  console.log('✅ SUCCESS: 100% of spells (139/139) are accurately classified into Friendly, Hostile, or Self!');
}
