import { SRD_LEGAL_ATTRIBUTION, SRD_VERSION } from '@srd5/data';
import { getTransportInfo } from '@srd5/transport';

export function App() {
  const transportInfo = getTransportInfo();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-8">
      <header className="max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold tracking-tight text-amber-400">
          SRD {SRD_VERSION} Tactical Dungeon Crawler
        </h1>
        <p className="mt-2 text-slate-400">
          Engine v{transportInfo.engine.engineVersion} &middot; Transport v
          {transportInfo.transportVersion}
        </p>
      </header>

      <footer className="max-w-4xl mx-auto w-full border-t border-slate-800 pt-4 text-xs text-slate-500">
        <p>{SRD_LEGAL_ATTRIBUTION}</p>
      </footer>
    </main>
  );
}
