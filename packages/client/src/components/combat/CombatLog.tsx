import React, { useEffect, useRef, useState } from 'react';
import type { GameEvent, DiceRollRecord } from '@srd5/engine';
import type { CombatLogFilter, CombatLogProps } from './types.js';

interface FormattedLogEntry {
  id: string;
  timestamp: string;
  type: string;
  category: CombatLogFilter;
  title: string;
  summary: string;
  badge?: { label: string; color: string };
  breakdown?: {
    title: string;
    formula?: string;
    rolls?: number[];
    kept?: number[];
    dropped?: number[];
    modifier?: number;
    total?: number;
    vsTarget?: string;
    details?: string[];
  };
  rawEvent?: GameEvent;
}

export function CombatLog({
  events = [],
  combatants = {},
  maxEntries = 100,
  activeFilter: controlledFilter,
  onFilterChange,
  onInspectRoll,
  onClearLog,
  className = '',
}: CombatLogProps) {
  const [internalFilter, setInternalFilter] = useState<CombatLogFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const activeFilter = controlledFilter ?? internalFilter;

  const handleFilterClick = (filter: CombatLogFilter) => {
    if (onFilterChange) {
      onFilterChange(filter);
    } else {
      setInternalFilter(filter);
    }
  };

  const getCombatantName = (id?: string) => {
    if (!id) return 'Unknown';
    return combatants[id]?.name ?? id;
  };

  // Convert raw GameEvent[] into rich UI log entries
  const formatEvents = (rawEvents: GameEvent[]): FormattedLogEntry[] => {
    return rawEvents.map((event, idx) => {
      const entryId = `log-${idx}-${event.type}`;
      const timeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      switch (event.type) {
        case 'ATTACK_RESOLVED': {
          const attacker = getCombatantName(event.attackerId);
          const target = getCombatantName(event.targetId);
          const isCrit = event.outcome === 'critical_hit';
          const isHit = event.outcome === 'hit' || isCrit;

          let badgeColor = isCrit
            ? 'bg-amber-500 text-slate-950 font-bold'
            : isHit
              ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40'
              : 'bg-slate-700/50 text-slate-400 border-slate-600/40';

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'attacks',
            title: `${attacker} attacks ${target}`,
            summary: `${event.weaponOrSpellName}: Roll ${event.totalToHit} vs AC ${event.targetAc}`,
            badge: {
              label: isCrit ? 'CRITICAL HIT' : isHit ? 'HIT' : 'MISS',
              color: badgeColor,
            },
            breakdown: {
              title: `Attack Roll Breakdown: ${attacker} vs ${target}`,
              total: event.totalToHit,
              vsTarget: `Target AC ${event.targetAc}${event.cover ? ` (${event.cover.replace('_', ' ')})` : ''}`,
              details: [
                `Weapon / Spell: ${event.weaponOrSpellName} (${event.attackType.replace('_', ' ')})`,
                `Natural d20: ${event.roll}`,
                `Total to Hit: ${event.totalToHit} vs AC ${event.targetAc}`,
                `Outcome: ${event.outcome.toUpperCase()}`,
                ...(event.damage
                  ? [`Follow-up Damage: ${event.damage.total} ${event.damage.damageType} (${event.damage.diceFormula})`]
                  : []),
              ],
            },
            rawEvent: event,
          };
        }

        case 'DAMAGE_APPLIED': {
          const target = getCombatantName(event.targetId);
          const parts: string[] = [];
          if (event.tempHpAbsorbed > 0) {
            parts.push(`${event.tempHpAbsorbed} absorbed by Temp HP`);
          }
          if (event.resistanceApplied) {
            parts.push('Resistance halved');
          }
          if (event.vulnerabilityApplied) {
            parts.push('Vulnerability doubled');
          }
          if (event.immunityApplied) {
            parts.push('Immunity negated all damage');
          }

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'damage',
            title: `${target} takes damage`,
            summary: `${event.finalAmount} ${event.damageType} damage (HP remaining: ${event.hpRemaining})`,
            badge: {
              label: `${event.finalAmount} ${event.damageType.toUpperCase()}`,
              color: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
            },
            breakdown: {
              title: `Damage Application Breakdown: ${target}`,
              total: event.finalAmount,
              details: [
                `Target: ${target}`,
                `Damage Type: ${event.damageType}`,
                `Raw Damage: ${event.rawAmount}`,
                `Final Damage Applied: ${event.finalAmount}`,
                `Current HP Remaining: ${event.hpRemaining}`,
                ...(parts.length > 0 ? [`Modifiers: ${parts.join(', ')}`] : []),
                ...(event.instantDeath ? ['Triggered Instant Death!'] : []),
                ...(event.deathSaveFailuresAdded ? [`Added ${event.deathSaveFailuresAdded} Death Save failure(s)`] : []),
              ],
            },
            rawEvent: event,
          };
        }

        case 'SAVING_THROW_RESOLVED': {
          const creature = getCombatantName(event.entityId);
          const isSuccess = event.outcome === 'success';

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'saves',
            title: `${creature} ${event.ability.toUpperCase()} Save`,
            summary: `Rolled ${event.total} vs DC ${event.dc} (${event.outcome.toUpperCase()})`,
            badge: {
              label: isSuccess ? 'SUCCESS' : 'FAILED',
              color: isSuccess
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-red-500/20 text-red-300 border-red-500/40',
            },
            breakdown: {
              title: `${event.ability.toUpperCase()} Saving Throw Breakdown`,
              total: event.total,
              vsTarget: `DC ${event.dc}`,
              details: [
                `Creature: ${creature}`,
                `Save Ability: ${event.ability.toUpperCase()}`,
                `Natural Roll: ${event.roll}`,
                `Total with Modifiers: ${event.total}`,
                `Difficulty Class (DC): ${event.dc}`,
                `Outcome: ${event.outcome.toUpperCase()}`,
                ...(event.sourceSpellOrAbilityName
                  ? [`Source Effect: ${event.sourceSpellOrAbilityName}`]
                  : []),
              ],
            },
            rawEvent: event,
          };
        }

        case 'SPELL_CAST': {
          const caster = getCombatantName(event.actorId);
          const targets = event.targetEntityIds.map(getCombatantName).join(', ');

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'spells',
            title: `${caster} casts ${event.spellName}`,
            summary: `Level ${event.castAtLevel} (${event.actionCost})${targets ? ` -> ${targets}` : ''}`,
            badge: {
              label: `SPELL L${event.castAtLevel}`,
              color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
            },
            breakdown: {
              title: `Spell Cast: ${event.spellName}`,
              details: [
                `Caster: ${caster}`,
                `Spell Level: ${event.spellLevel} (Cast at Level ${event.castAtLevel})`,
                `Action Cost: ${event.actionCost}`,
                `Slot Expended: ${event.slotExpended !== undefined ? `Level ${event.slotExpended}` : 'None (Cantrip/Innate)'}`,
                `Targets: ${targets || 'Self / Area'}`,
              ],
            },
            rawEvent: event,
          };
        }

        case 'CONDITION_ADDED': {
          const target = getCombatantName(event.targetId);
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'conditions',
            title: `${target} gained condition`,
            summary: `Gained [${event.conditionId}]${event.sourceName ? ` from ${event.sourceName}` : ''}`,
            badge: {
              label: `+ ${event.conditionId}`,
              color: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
            },
            rawEvent: event,
          };
        }

        case 'CONDITION_REMOVED': {
          const target = getCombatantName(event.targetId);
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'conditions',
            title: `${target} cleared condition`,
            summary: `Removed [${event.conditionId}]`,
            badge: {
              label: `- ${event.conditionId}`,
              color: 'bg-slate-700/50 text-slate-300 border-slate-600',
            },
            rawEvent: event,
          };
        }

        case 'DEATH_SAVE_ROLLED': {
          const creature = getCombatantName(event.entityId);
          const isNat20 = event.roll === 20;
          const isNat1 = event.roll === 1;

          let badgeText = event.outcome.toUpperCase();
          if (isNat20) badgeText = 'NAT 20 (REVIVED!)';
          if (isNat1) badgeText = 'NAT 1 (2 FAILS)';

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'saves',
            title: `${creature} Death Save`,
            summary: `Rolled ${event.roll} -> ${event.outcome} (${event.deathSaves.successes}/3 succ, ${event.deathSaves.failures}/3 fail)`,
            badge: {
              label: badgeText,
              color:
                event.outcome === 'revived' || event.outcome === 'success'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border-red-500/40',
            },
            breakdown: {
              title: `Death Saving Throw: ${creature}`,
              total: event.roll,
              details: [
                `Natural Roll: ${event.roll}`,
                `Outcome: ${event.outcome.toUpperCase()}`,
                `Total Successes: ${event.deathSaves.successes} / 3`,
                `Total Failures: ${event.deathSaves.failures} / 3`,
                `Current HP: ${event.currentHp}`,
              ],
            },
            rawEvent: event,
          };
        }

        case 'REACTION_PROMPTED': {
          const reactor = getCombatantName(event.prompt.reactorEntityId);
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'reactions',
            title: `Reaction Prompted: ${reactor}`,
            summary: event.prompt.triggerDescription,
            badge: {
              label: 'INTERRUPT',
              color: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
            },
            rawEvent: event,
          };
        }

        case 'REACTION_RESOLVED': {
          const reactor = getCombatantName(event.reactorEntityId);
          const actionTaken =
            event.actionTaken === 'executed'
              ? `Executed ${event.reactionType ?? event.reactionId ?? 'reaction'}`
              : 'Passed reaction';

          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'reactions',
            title: `Reaction Resolved: ${reactor}`,
            summary: actionTaken,
            badge: {
              label: event.actionTaken.toUpperCase(),
              color:
                event.actionTaken === 'executed'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-700 text-slate-400',
            },
            rawEvent: event,
          };
        }

        case 'ROUND_STARTED': {
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'system',
            title: `Round ${event.round} Begun`,
            summary: `All combatant reactions refreshed`,
            badge: {
              label: `ROUND ${event.round}`,
              color: 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-bold',
            },
            rawEvent: event,
          };
        }

        case 'TURN_STARTED': {
          const creature = getCombatantName(event.entityId);
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'system',
            title: `Turn: ${creature}`,
            summary: `Round ${event.round} turn started`,
            badge: {
              label: 'TURN',
              color: 'bg-slate-800 text-slate-300 border-slate-700',
            },
            rawEvent: event,
          };
        }

        case 'ENCOUNTER_VICTORY': {
          const isPartyVictory = event.outcome !== 'party_defeat';
          const outcomeLabel = event.outcome
            ? event.outcome.replace('_', ' ').toUpperCase()
            : 'PARTY VICTORY';
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'system',
            title: `Combat Ended`,
            summary: `Victory Outcome: ${outcomeLabel}${event.round ? ` (Round ${event.round})` : ''}`,
            badge: {
              label: isPartyVictory ? 'VICTORY' : 'DEFEAT',
              color: isPartyVictory
                ? 'bg-amber-500 text-slate-950 font-black'
                : 'bg-rose-600 text-white font-black',
            },
            rawEvent: event,
          };
        }

        case 'DICE_ROLLED': {
          const actor = getCombatantName(event.actorId);
          return {
            id: entryId,
            timestamp: timeStr,
            type: event.type,
            category: 'attacks',
            title: `${actor} - ${event.rollPurpose}`,
            summary: `${event.notation}: ${event.rolls.join(', ')} = ${event.total}`,
            badge: {
              label: `${event.total}`,
              color: event.naturalCrit
                ? 'bg-amber-500 text-slate-950 font-bold'
                : event.naturalFumble
                  ? 'bg-rose-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-300 border-slate-700',
            },
            breakdown: {
              title: `${event.rollPurpose} Breakdown`,
              formula: event.notation,
              rolls: event.rolls,
              kept: event.kept,
              modifier: event.modifier,
              total: event.total,
              details: [
                `Actor: ${actor}`,
                `Purpose: ${event.rollPurpose}`,
                `Notation: ${event.notation}`,
                `Dice: [${event.rolls.join(', ')}] (Kept: [${event.kept.join(', ')}])`,
                `Modifier: ${event.modifier >= 0 ? `+${event.modifier}` : event.modifier}`,
                `Total: ${event.total}`,
                `Roll Mode: ${event.mode.toUpperCase()}`,
              ],
            },
            rawEvent: event,
          };
        }

        default:
          return {
            id: entryId,
            timestamp: timeStr,
            type: (event as any).type ?? 'UNKNOWN',
            category: 'system',
            title: (event as any).type ?? 'System Event',
            summary: JSON.stringify(event),
            rawEvent: event,
          };
      }
    });
  };

  const formattedEntries = formatEvents(events);

  // Apply filters and search query
  const filteredEntries = formattedEntries.filter((entry) => {
    if (activeFilter !== 'all' && entry.category !== activeFilter) {
      return false;
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        (entry.badge?.label.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  // Copy plain text log to clipboard
  const handleCopyLog = async () => {
    const text = filteredEntries
      .map(
        (e) =>
          `[${e.timestamp}] [${e.category.toUpperCase()}] ${e.title} - ${e.summary} ${e.badge ? `(${e.badge.label})` : ''}`,
      )
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const activeHoveredEntry = formattedEntries.find((e) => e.id === hoveredEntryId);

  return (
    <div
      data-testid="combat-log"
      className={`flex flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden text-xs text-slate-200 select-text ${className}`}
    >
      {/* Header with Title & Filter Tabs */}
      <div className="flex flex-col bg-slate-950/80 border-b border-slate-800 p-2.5 gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-sm">📜</span>
            <h4 className="font-bold text-slate-100 uppercase tracking-wide text-xs">
              Combat Log ({filteredEntries.length})
            </h4>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="combat-log-copy-btn"
              onClick={handleCopyLog}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 hover:text-white transition-colors"
              title="Copy log to clipboard"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>

            {onClearLog && (
              <button
                type="button"
                data-testid="combat-log-clear-btn"
                onClick={onClearLog}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 hover:text-white transition-colors"
                title="Clear log"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-1 items-center">
          {(
            [
              'all',
              'attacks',
              'damage',
              'saves',
              'spells',
              'conditions',
              'reactions',
              'system',
            ] as CombatLogFilter[]
          ).map((filter) => (
            <button
              key={filter}
              type="button"
              data-testid={`combat-log-filter-${filter}`}
              onClick={() => handleFilterClick(filter)}
              className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold transition-colors ${
                activeFilter === filter
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Search Input & Auto-scroll toggle */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            data-testid="combat-log-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search log (e.g. Goblin, AC)..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />

          <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-amber-500"
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Log Entries Container */}
      <div
        ref={logContainerRef}
        data-testid="combat-log-scroll-area"
        className="relative flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[180px] max-h-[380px] scrollbar-thin font-sans"
      >
        {filteredEntries.length > 0 ? (
          filteredEntries.slice(-maxEntries).map((entry) => (
            <div
              key={entry.id}
              data-testid="combat-log-entry"
              onMouseEnter={() => setHoveredEntryId(entry.id)}
              onMouseLeave={() => setHoveredEntryId((cur) => (cur === entry.id ? null : cur))}
              className="group relative p-2 rounded-lg bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/80 hover:border-amber-500/40 transition-colors flex flex-col gap-1 cursor-default"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {entry.timestamp}
                  </span>
                  <span className="font-semibold text-slate-200 truncate">
                    {entry.title}
                  </span>
                </div>

                {entry.badge && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] border shrink-0 ${entry.badge.color}`}
                  >
                    {entry.badge.label}
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>{entry.summary}</span>

                {entry.breakdown && (
                  <span className="text-[10px] text-amber-400/80 group-hover:text-amber-300 font-mono underline cursor-help ml-2 shrink-0">
                    Formula [?]
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-xs text-slate-500 italic">
            No events match the selected criteria.
          </div>
        )}
      </div>

      {/* Floating Formula Breakdown Tooltip on Hover (Spec 05 Section 4.2) */}
      {activeHoveredEntry?.breakdown && (
        <div
          data-testid="combat-log-tooltip"
          className="p-3 bg-slate-950 border-t-2 border-amber-500 text-xs shadow-2xl space-y-1.5 animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1">
            <span className="font-bold text-amber-300">
              {activeHoveredEntry.breakdown.title}
            </span>
            {activeHoveredEntry.breakdown.vsTarget && (
              <span className="text-slate-400 font-semibold">
                {activeHoveredEntry.breakdown.vsTarget}
              </span>
            )}
          </div>

          <div className="space-y-0.5">
            {activeHoveredEntry.breakdown.details?.map((detail, idx) => (
              <div key={idx} className="text-slate-300 font-mono text-[11px]">
                {detail}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
