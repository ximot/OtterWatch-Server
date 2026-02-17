import { useEffect, useState } from 'react';

const ASCII_LOGO = `\u00A0██████╗ ████████╗████████╗███████╗██████╗ ██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗
██╔═══██╗╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║
██║   ██║   ██║      ██║   █████╗  ██████╔╝██║ █╗ ██║███████║   ██║   ██║     ███████║
██║   ██║   ██║      ██║   ██╔══╝  ██╔══██╗██║███╗██║██╔══██║   ██║   ██║     ██╔══██║
╚██████╔╝   ██║      ██║   ███████╗██║  ██║╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║
\u00A0╚═════╝    ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝`;

export function Header() {
  const [time, setTime] = useState(new Date());
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    const timeInterval = setInterval(() => setTime(new Date()), 1000);
    const cursorInterval = setInterval(() => setShowCursor(s => !s), 530);
    return () => {
      clearInterval(timeInterval);
      clearInterval(cursorInterval);
    };
  }, []);

  return (
    <header className="border-b border-terminal-border bg-terminal-panel/50 px-6 py-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <pre
            className="text-phosphor text-[8px] leading-[1.1] sm:text-[10px] md:text-xs font-bold select-none"
            style={{
              textShadow: '0 0 10px var(--color-phosphor-glow), 0 0 20px var(--color-phosphor-glow)',
            }}
          >
            {ASCII_LOGO}
          </pre>
        </div>
        <div className="text-right font-mono text-sm">
          <div className="text-terminal-dim">SYSTEM TIME</div>
          <div className="text-phosphor text-lg tabular-nums" style={{ textShadow: '0 0 8px var(--color-phosphor-glow)' }}>
            {time.toLocaleTimeString('en-GB', { hour12: false })}
            <span className={showCursor ? 'opacity-100' : 'opacity-0'}>_</span>
          </div>
          <div className="text-terminal-dim text-xs mt-1">
            {time.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
    </header>
  );
}
