// Barra di navigazione condivisa del sito completo (design/recupera.css, classi .rc-*):
// stessi link e stesso markup della landing, di Prenota e del test server.
const SEZIONI = [
  { href: '/', label: 'Home' },
  { href: '/prenota/', label: 'Prenota' },
  { href: '/dashboard/', label: 'Dashboard', corrente: true },
  { href: '/test-server/', label: 'Test server' },
];

export default function SiteBar({ children }) {
  return (
    <header className="rc-sitebar">
      <div className="rc-sitebar__inner">
        <a className="rc-brand" href="/" aria-label="reCUPera, pagina iniziale">
          <span className="rc-brand__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>reCUPera</span>
          <span className="rc-brand__tag">Centro operativo</span>
        </a>
        <nav className="rc-sitenav" aria-label="Sezioni del sito">
          {SEZIONI.map((sezione) => (
            <a key={sezione.href} href={sezione.href} aria-current={sezione.corrente ? 'page' : undefined}>
              {sezione.label}
            </a>
          ))}
        </nav>
        {children && <div className="rc-sitebar__actions">{children}</div>}
      </div>
    </header>
  );
}
