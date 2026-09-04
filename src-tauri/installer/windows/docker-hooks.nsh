; Learning Hub NSIS hooks.
; In-app "Prepare to Uninstall" removes images via `docker compose down --rmi all`.
; This hook wipes leftover extracted compose trees if the user skipped that step.
; Docker Desktop may already be stopped — do not fail the uninstaller.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$APPDATA\com.redfireforge.desktop.demo\docker"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
