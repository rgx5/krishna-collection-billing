import { useApp } from '../state'
import { CloudSignIn } from '../components/CloudSignIn'
import { fetchSnapshot, hydrateFromSnapshot } from '../lib/cloud'

/** First launch on a new device: sign in and bring the store down from the cloud. */
export default function Setup() {
  const { finishSetup, loginWithToken, toast } = useApp()

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="row gap-6" style={{ marginBottom: 18 }}>
          <div className="brand-mark">KC</div>
          <div>
            <h1 style={{ fontSize: 18 }}>Welcome to Krishna Collection</h1>
            <div className="small muted">Sign in to load your store onto this device</div>
          </div>
        </div>

        <CloudSignIn
          submitLabel="Sign in & load my store"
          onError={() => undefined}
          onSignedIn={async (result, apiUrl) => {
            const snapshot = await fetchSnapshot(apiUrl, result.token)
            await hydrateFromSnapshot(apiUrl, snapshot)
            finishSetup()
            loginWithToken(result.user.id, apiUrl, result.store.id, result.token)
            toast(`Welcome, ${result.user.name.split(' ')[0]}`, 'ok')
          }}
        />

        <div className="tiny muted center" style={{ marginTop: 16 }}>
          Billing keeps working offline after this — changes upload automatically when you're back online.
        </div>
      </div>
    </div>
  )
}
