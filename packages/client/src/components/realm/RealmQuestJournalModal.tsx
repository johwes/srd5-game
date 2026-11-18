import React, { useEffect, useState } from 'react';
import {
  type OverworldQuest,
  type QuestChainDefinition,
  type QuestChainProgress,
  type QuestChainLog,
  type QuestLog,
} from '@srd5/engine';

/**
 * Quest journal + settlement quest board modal (SRD-805). The Board tab shows
 * available postings at the party's current settlement; Active and Completed
 * tabs track the party's journal across the realm.
 */

export type RealmQuestTab = 'board' | 'active' | 'chains' | 'completed';

const KIND_BADGES: Record<string, { icon: string; label: string; cls: string }> = {
  bounty: { icon: '🎯', label: 'Bounty', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
  dungeon: { icon: '🕳️', label: 'Dungeon', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/40' },
  fetch: { icon: '📦', label: 'Fetch', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  escort: { icon: '🛡️', label: 'Escort', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
};

export interface RealmQuestJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  questLog: QuestLog;
  chainLog?: QuestChainLog;
  currentPoiId: string | null;
  currentDay: number;
  initialTab?: RealmQuestTab;
  onAccept: (questId: string) => void;
  onAbandon: (questId: string) => void;
  onStartChain?: (chainId: string) => void;
  onChooseChainOption?: (chainId: string, optionId: string) => void;
  onAbandonChain?: (chainId: string) => void;
}

function QuestCard({
  quest,
  currentDay,
  action,
}: {
  quest: OverworldQuest;
  currentDay: number;
  action?: React.ReactNode;
}) {
  const badge = KIND_BADGES[quest.kind] ?? KIND_BADGES.fetch!;
  const expired = quest.expiresDay !== undefined && currentDay > quest.expiresDay;
  return (
    <li
      data-testid={`realm-quest-card-${quest.id}`}
      className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-100">{quest.title}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${badge.cls}`}>
          {badge.icon} {badge.label} · Tier {quest.difficultyTier}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-snug">{quest.description}</p>
      {quest.giverName && (
        <p data-testid={`realm-quest-giver-${quest.id}`} className="text-[11px] text-amber-200/90 italic leading-snug">
          — {quest.giverName}: “{quest.giverBlurb}”
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {quest.targetName && (
          <span className="text-slate-300">📍 {quest.targetName}</span>
        )}
        <span className="text-yellow-300 font-bold">💰 {quest.rewardGold} gp</span>
        <span className="text-purple-300 font-bold">🚩 +{quest.reputationReward} rep</span>
        {quest.expiresDay !== undefined && quest.status === 'available' && (
          <span className={expired ? 'text-red-400' : 'text-slate-500'}>
            ⏳ expires day {quest.expiresDay}
          </span>
        )}
        {quest.status === 'completed' && quest.completedDay !== undefined && (
          <span className="text-emerald-400">✓ completed day {quest.completedDay}</span>
        )}
        {quest.status === 'failed' && (
          <span className="text-red-400">✗ failed</span>
        )}
      </div>
      {action}
    </li>
  );
}

const STAGE_KIND_HINTS: Record<string, { icon: string; label: string }> = {
  talk: { icon: '🗣️', label: 'Speak' },
  bounty: { icon: '⚔️', label: 'Battle' },
  dungeon: { icon: '🕳️', label: 'Delve' },
  fetch: { icon: '📦', label: 'Recover' },
  escort: { icon: '🛡️', label: 'Escort' },
  choice: { icon: '🔀', label: 'Choose' },
  turn_in: { icon: '📜', label: 'Turn in' },
};

function ChainCard({
  definition,
  progress,
  currentDay,
  onStartChain,
  onChooseChainOption,
  onAbandonChain,
}: {
  definition: QuestChainDefinition;
  progress: QuestChainProgress;
  currentDay: number;
  onStartChain?: (chainId: string) => void;
  onChooseChainOption?: (chainId: string, optionId: string) => void;
  onAbandonChain?: (chainId: string) => void;
}) {
  const current =
    progress.status === 'active'
      ? definition.stages.find((stage) => stage.id === progress.currentStageId)
      : undefined;
  const statusBadge =
    progress.status === 'active'
      ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
      : progress.status === 'completed'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
        : progress.status === 'failed'
          ? 'bg-red-500/15 text-red-300 border-red-500/40'
          : progress.status === 'locked'
            ? 'bg-slate-500/15 text-slate-400 border-slate-600'
            : 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  return (
    <li
      data-testid={`realm-chain-card-${definition.id}`}
      className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-100">⛓️ {definition.title}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge}`}>
          {progress.status}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-snug">{definition.description}</p>
      {definition.giverName && (
        <p className="text-[11px] text-amber-200/90 italic leading-snug">
          — {definition.giverName}: “{definition.giverBlurb}”
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-yellow-300 font-bold">💰 {definition.finalRewardGold} gp</span>
        {progress.expiresDay !== undefined && progress.status === 'active' && (
          <span className={currentDay > progress.expiresDay ? 'text-red-400' : 'text-slate-500'}>
            ⏳ expires day {progress.expiresDay}
          </span>
        )}
      </div>
      {progress.status === 'locked' && progress.lockedReason && (
        <p className="text-[11px] text-slate-500 italic">🔒 {progress.lockedReason}</p>
      )}
      {definition.stages.map((stage) => {
        const done = progress.completedStageIds.includes(stage.id);
        const isCurrent = current?.id === stage.id;
        const hint = STAGE_KIND_HINTS[stage.kind] ?? STAGE_KIND_HINTS.talk!;
        return (
          <div
            key={stage.id}
            data-testid={`realm-chain-stage-${definition.id}-${stage.id}`}
            data-stage-status={done ? 'done' : isCurrent ? 'current' : 'upcoming'}
            className={`rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
              done
                ? 'border-emerald-900 bg-emerald-950/30 text-emerald-200/80'
                : isCurrent
                  ? 'border-sky-700 bg-sky-950/40 text-sky-100'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500'
            }`}
          >
            <span className="font-semibold">
              {done ? '✓' : isCurrent ? '▶' : '·'} {hint.icon} {stage.title}
            </span>
            {isCurrent && stage.targetName && stage.kind !== 'choice' && (
              <span className="text-slate-300"> — 📍 {stage.targetName}</span>
            )}
            {isCurrent && stage.kind === 'choice' && (
              <span className="text-slate-300"> — choose a path below</span>
            )}
          </div>
        );
      })}
      {progress.status === 'available' && onStartChain && (
        <button
          type="button"
          data-testid={`realm-chain-start-${definition.id}`}
          onClick={() => onStartChain(definition.id)}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold min-h-[36px]"
        >
          Take Up This Cause
        </button>
      )}
      {progress.status === 'active' && current?.kind === 'choice' && onChooseChainOption && (
        <div className="space-y-1.5">
          {(current.options ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`realm-chain-choose-${definition.id}-${option.id}`}
              onClick={() => onChooseChainOption(definition.id, option.id)}
              className="block w-full text-left px-3 py-2 rounded-lg bg-sky-900/60 hover:bg-sky-800/60 border border-sky-700 text-xs text-sky-100 min-h-[36px]"
            >
              <span className="font-bold">🔀 {option.label}</span>
              {option.description && (
                <span className="block text-sky-200/70 mt-0.5">{option.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {progress.status === 'active' && onAbandonChain && (
        <button
          type="button"
          data-testid={`realm-chain-abandon-${definition.id}`}
          onClick={() => onAbandonChain(definition.id)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900/60 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-red-200 min-h-[36px]"
        >
          Abandon
        </button>
      )}
    </li>
  );
}

export function RealmQuestJournalModal({
  isOpen,
  onClose,
  questLog,
  chainLog,
  currentPoiId,
  currentDay,
  initialTab = 'active',
  onAccept,
  onAbandon,
  onStartChain,
  onChooseChainOption,
  onAbandonChain,
}: RealmQuestJournalModalProps) {
  const [tab, setTab] = useState<RealmQuestTab>(initialTab);

  // Re-sync the active tab each time the modal opens (board vs journal entry).
  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const boardQuests = questLog.quests.filter(
    (q) => q.status === 'available' && q.boardPoiId === currentPoiId,
  );
  const activeQuests = questLog.quests.filter((q) => q.status === 'active');
  const finishedQuests = questLog.quests.filter(
    (q) => q.status === 'completed' || q.status === 'failed',
  );
  const chainDefs = new Map((chainLog?.definitions ?? []).map((def) => [def.id, def]));
  const chainProgress = chainLog?.progress ?? [];
  const openChains = chainProgress.filter((p) => p.status === 'available' || p.status === 'active');
  const closedChains = chainProgress.filter(
    (p) => p.status === 'completed' || p.status === 'failed' || p.status === 'locked',
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-quest-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="realm-quest-title" className="text-xl font-bold text-amber-400">
            📜 Quest Journal
          </h2>
          <button
            type="button"
            data-testid="realm-quest-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-wrap rounded-lg bg-slate-950 p-0.5 border border-slate-800 w-fit gap-0.5">
          {(
            [
              ['board', `📋 Board (${boardQuests.length})`],
              ['active', `⚔️ Active (${activeQuests.length})`],
              ['chains', `⛓️ Chains (${openChains.length})`],
              ['completed', `🏆 Archive (${finishedQuests.length})`],
            ] as Array<[RealmQuestTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`realm-quest-tab-${key}`}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                tab === key ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'board' && (
          <ul data-testid="realm-quest-board-list" className="space-y-2">
            {!currentPoiId && (
              <li className="text-sm text-slate-500 italic">
                Travel to a settlement with a quest board to see postings.
              </li>
            )}
            {currentPoiId && boardQuests.length === 0 && (
              <li className="text-sm text-slate-500 italic">No postings on this board.</li>
            )}
            {boardQuests.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                currentDay={currentDay}
                action={
                  <button
                    type="button"
                    data-testid={`realm-quest-accept-${quest.id}`}
                    onClick={() => onAccept(quest.id)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold min-h-[36px]"
                  >
                    Accept Quest
                  </button>
                }
              />
            ))}
          </ul>
        )}

        {tab === 'active' && (
          <ul data-testid="realm-quest-active-list" className="space-y-2">
            {activeQuests.length === 0 && (
              <li className="text-sm text-slate-500 italic">
                No active quests. Visit a settlement quest board to find work.
              </li>
            )}
            {activeQuests.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                currentDay={currentDay}
                action={
                  <button
                    type="button"
                    data-testid={`realm-quest-abandon-${quest.id}`}
                    onClick={() => onAbandon(quest.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900/60 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-red-200 min-h-[36px]"
                  >
                    Abandon
                  </button>
                }
              />
            ))}
          </ul>
        )}

        {tab === 'chains' && (
          <ul data-testid="realm-quest-chains-list" className="space-y-2">
            {openChains.length === 0 && closedChains.length === 0 && (
              <li className="text-sm text-slate-500 italic">
                No quest chains bind to this realm. Settle a world with rival houses and wild lairs to earn storied causes.
              </li>
            )}
            {openChains.map((progress) => {
              const definition = chainDefs.get(progress.chainId);
              if (!definition) return null;
              return (
                <ChainCard
                  key={progress.chainId}
                  definition={definition}
                  progress={progress}
                  currentDay={currentDay}
                  onStartChain={onStartChain}
                  onChooseChainOption={onChooseChainOption}
                  onAbandonChain={onAbandonChain}
                />
              );
            })}
            {closedChains.length > 0 && (
              <li className="text-[11px] font-bold text-slate-500 uppercase tracking-wide pt-1">
                Resolved & sealed
              </li>
            )}
            {closedChains.map((progress) => {
              const definition = chainDefs.get(progress.chainId);
              if (!definition) return null;
              return (
                <ChainCard
                  key={progress.chainId}
                  definition={definition}
                  progress={progress}
                  currentDay={currentDay}
                />
              );
            })}
          </ul>
        )}

        {tab === 'completed' && (
          <ul data-testid="realm-quest-archive-list" className="space-y-2">
            {finishedQuests.length === 0 && (
              <li className="text-sm text-slate-500 italic">No completed or failed quests yet.</li>
            )}
            {finishedQuests.map((quest) => (
              <QuestCard key={quest.id} quest={quest} currentDay={currentDay} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
