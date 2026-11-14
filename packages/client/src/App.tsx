import { useState } from 'react';
import { SRD_LEGAL_ATTRIBUTION, SRD_VERSION, defaultCompendium } from '@srd5/data';
import { getTransportInfo } from '@srd5/transport';
import { CharacterBuilderWizard } from './components/builder/index.js';
import { CompendiumBrowser } from './components/compendium/index.js';

export type AppViewMode = 'builder' | 'compendium';

export interface AppProps {
  initialView?: AppViewMode;
}

export function App({ initialView = 'builder' }: AppProps) {
  const [activeView, setActiveView] = useState<AppViewMode>(initialView);
  const transportInfo = getTransportInfo();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-8 gap-6">
      <div className="max-w-7xl mx-auto w-full space-y-6 flex-1">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-amber-400">
              SRD {SRD_VERSION} Tactical Dungeon Crawler
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-400">
              Official SRD 5.1 Character Builder &amp; Compendium &middot; Engine v
              {transportInfo.engine.engineVersion} &middot; Transport v
              {transportInfo.transportVersion}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                data-testid="app-nav-builder"
                aria-pressed={activeView === 'builder'}
                onClick={() => setActiveView('builder')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'builder'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Character Builder
              </button>
              <button
                type="button"
                data-testid="app-nav-compendium"
                aria-pressed={activeView === 'compendium'}
                onClick={() => setActiveView('compendium')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'compendium'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                SRD 5.1 Compendium
              </button>
            </div>

            <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-amber-300 text-xs font-medium">
              {defaultCompendium.races.length} Races &middot;{' '}
              {defaultCompendium.classes.length} Classes &middot;{' '}
              {defaultCompendium.spells.length} Spells &middot;{' '}
              {defaultCompendium.monsters.length} Monsters
            </span>
          </div>
        </header>

        {activeView === 'builder' ? (
          <CharacterBuilderWizard compendium={defaultCompendium} />
        ) : (
          <CompendiumBrowser compendium={defaultCompendium} />
        )}
      </div>

      <footer className="max-w-7xl mx-auto w-full border-t border-slate-800 pt-4 text-xs text-slate-500">
        <p>{SRD_LEGAL_ATTRIBUTION}</p>
      </footer>
    </main>
  );
}
