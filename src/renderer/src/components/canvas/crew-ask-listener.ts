import { dispatchCrewAsk, type AskPayload } from './crew-ask-routing'

let installed = false

export function installCrewAskListener(): void {
  if (installed) {
    return
  }
  installed = true
  window.api.crew.onAsk((payload: AskPayload) => {
    void dispatchCrewAsk(payload)
  })
}
