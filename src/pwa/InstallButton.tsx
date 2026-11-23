import { promptInstall, useInstallPrompt } from './install'

/** Button that appears only while the browser offers installation. */
export function InstallButton({ className }: { className?: string }) {
  const { canInstall } = useInstallPrompt()
  if (!canInstall) return null
  return (
    <button className={className} onClick={() => void promptInstall()} data-testid="install-app">
      App installieren
    </button>
  )
}

/** Settings section: button, "installed" note, or a hint where to find it in the browser menu. */
export function InstallSection() {
  const { canInstall, installed } = useInstallPrompt()
  if (installed) return <p className="ok">✓ Läuft als installierte App.</p>
  return (
    <>
      <p className="muted">
        Installiert startet der Blatt-Reader wie eine eigene App, ohne Browserleiste, und der Browser löscht seine Daten
        nicht so leicht.
      </p>
      {canInstall ? (
        <div className="row">
          <InstallButton className="primary" />
        </div>
      ) : (
        <p className="muted" data-testid="install-hint">
          Dein Browser bietet die Installation gerade nicht an. In Chrome: Menü ⋮ → „App installieren“ (erst nach dem
          Anmelden und einmal Neuladen). Auf dem iPhone: Teilen → „Zum Home-Bildschirm“.
        </p>
      )}
    </>
  )
}
