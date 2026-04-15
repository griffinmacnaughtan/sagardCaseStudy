import { NavLink, Outlet, Link } from 'react-router-dom';
import { useDataMode } from '../lib/mode';

const navItems = [
  { to: '/', label: 'Portfolio' },
  { to: '/audit', label: 'Audit Trail' },
  { to: '/live', label: 'Extraction' },
];

function SagardLogo() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}sagard-logo.webp`}
      alt="Sagard"
      width="26"
      height="26"
      className="shrink-0 rounded-full"
    />
  );
}

function ModeToggle() {
  const { mode, setMode } = useDataMode();
  const isLive = mode === 'live';
  return (
    <button
      onClick={() => setMode(isLive ? 'demo' : 'live')}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold tracking-wider rounded border transition-colors ${
        isLive
          ? 'bg-success/15 text-success border-success/40 hover:bg-success/25'
          : 'bg-accent/15 text-accent border-accent/40 hover:bg-accent/25'
      }`}
      title={
        isLive
          ? 'Live mode - reading from FastAPI backend (api.py). Click to switch back to the baked demo snapshot.'
          : 'Demo mode - reading from baked static data (works without any backend). Click to switch to live mode (requires api.py running).'
      }
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isLive ? 'bg-success animate-pulse' : 'bg-accent'
        }`}
      />
      {isLive ? 'LIVE' : 'DEMO'}
    </button>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <nav className="border-b border-border bg-bg-panel sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 flex items-center h-14">
          <Link
            to="/"
            className="flex items-center gap-2.5 mr-8 rounded -mx-2 px-2 py-1 hover:bg-bg-hover transition-colors"
            title="Back to portfolio overview"
          >
            <SagardLogo />
            <span className="text-text-primary font-semibold text-sm tracking-wide">
              SAGARD PORTFOLIO METRICS
            </span>
          </Link>
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-4 py-2 rounded text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-dim text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <ModeToggle />
            <span className="text-xs text-text-muted">Sagard FDE Case Study</span>
            <div className="flex items-center gap-2.5">
              <a
                href="https://github.com/griffinmacnaughtan"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-text-primary transition-colors"
                title="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/in/griffin-macnaughtan/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-text-primary transition-colors"
                title="LinkedIn"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
