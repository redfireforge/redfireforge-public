// ─── Requests & Gallery ──────────────────────────────────────────
//
// All selectors here must work with document.querySelector().
// Used by demo lessons (REQ-1..6), E2E tests, and test scenarios.
//
export const REQ = {
  // ── Navigation ────────────────────────────────────────────────
  AB_API:                   '[data-testid="ab-api"]',
  AB_GALLERY:               '[data-testid="ab-gallery"]',
  NAV_REQUESTS:             '[data-testid="nav-tab-requests"]',
  NAV_GALLERY:              '[data-testid="nav-tab-gallery"]',

  // ── Gallery Page ──────────────────────────────────────────────
  GALLERY_PAGE:             '[data-testid="gallery-page"]',
  GALLERY_SEARCH:           '[data-testid="gallery-search-input"]',
  GALLERY_DOMAIN_REQUESTS:  '[data-testid="gallery-domain-requests"]',
  GALLERY_DOMAIN_CATALOG:   '[data-testid="gallery-domain-catalog"]',
  GALLERY_DOMAIN_API_MOCK:  '[data-testid="gallery-domain-api-mock"]',
  GALLERY_DETAIL_PANEL:     '[data-testid="gallery-detail-panel"]',
  GALLERY_DETAIL_ACTION:    '[data-testid="gallery-detail-action"]',
  GALLERY_DETAIL_SECONDARY: '[data-testid="gallery-detail-secondary"]',
  GALLERY_DETAIL_CLOSE:     '[data-testid="gallery-detail-close"]',
  galleryCard: (id: string) => `[data-testid="gallery-card-${id}"]`,

  // ── Sidebar ───────────────────────────────────────────────────
  SIDEBAR:                  '[data-testid="req-sidebar"]',
  SIDEBAR_SEARCH:           '[data-testid="req-sidebar-search"]',
  SIDEBAR_ADD_BTN:          '[data-testid="req-sidebar-add-btn"]',
  SIDEBAR_IMPORT_BTN:       '[data-testid="req-sidebar-import"]',
  SIDEBAR_EXPORT_BTN:       '[data-testid="req-sidebar-export-all"]',
  SIDEBAR_EXPAND_ALL:       '[data-testid="req-sidebar-expand-all"]',
  ADD_DROPDOWN:             '[data-testid="req-add-dropdown"]',
  ADD_URL_COLLECTION:       '[data-testid="req-add-url-collection"]',
  ADD_ENV_COLLECTION:       '[data-testid="req-add-env-collection"]',
  ADD_GROUP:                '[data-testid="req-add-group"]',
  COL_ITEM:                 '[data-testid="req-col-item"]',
  REQ_ITEM:                 '[data-testid="req-req-item"]',
  CONTEXT_MENU:             '[data-testid="req-context-menu"]',
  CTX_EXPORT_TO_MOCK:       '[data-testid="req-ctx-export-to-mock"]',
  FOLDER_NAME_INPUT:        '[data-testid="req-folder-name-input"]',
  colByName: (name: string) => `[data-col-name="${name}"]`,
  reqByName: (name: string) => `[data-req-name="${name}"]`,
  /** Request under a specific collection (header + list share `.req-col-group`). */
  reqInCollection: (colName: string, reqName: string) =>
    `.req-col-group:has([data-col-name="${colName}"]) [data-req-name="${reqName}"]`,

  // ── Tab Bar ──────────────────────────────────────────────────
  TAB_BAR:                  '[data-testid="req-tab-bar"]',
  TAB_ADD:                  '[data-testid="req-tab-add"]',
  TAB_ITEM:                 '[data-testid="req-tab-item"]',
  TAB_CLOSE:                '[data-testid="req-tab-close"]',
  TAB_CLOSE_ALL:            '[data-testid="req-tab-close-all"]',
  TAB_LABEL:                '[data-testid="req-tab-label"]',
  tabById: (id: string) => `[data-testid="req-tab-item"][data-tab-id="${id}"]`,

  // ── New Request Prompt ──────────────────────────────────────
  NEW_REQ_PROMPT:           '[data-testid="req-new-request-prompt"]',
  NEW_REQ_NAME:             '[data-testid="req-new-request-name"]',

  // ── Duplicate Request Prompt ──────────────────────────────
  DUP_REQ_PROMPT:           '[data-testid="req-dup-request-prompt"]',
  DUP_REQ_NAME:             '[data-testid="req-dup-request-name"]',

  // ── Bulk Select ─────────────────────────────────────────────
  BULK_CHECKBOX:            '[data-testid="req-bulk-checkbox"]',
  BULK_BAR:                 '[data-testid="req-bulk-bar"]',
  BULK_DELETE:              '[data-testid="req-bulk-delete"]',
  BULK_DELETE_CONFIRM:      '[data-testid="req-bulk-delete-confirm"]',
  BULK_DELETE_CONFIRM_OK:   '[data-testid="req-bulk-delete-confirm-ok"]',
  CLEAR_SELECTION:          '[data-testid="req-sidebar-clear-selection"]',

  // ── Request Editor ────────────────────────────────────────────
  EDITOR:                   '[data-testid="req-editor"]',
  METHOD_SELECT:            '[data-testid="req-method-select"]',
  URL_INPUT:                '[data-testid="req-url-input"]',
  SEND_BTN:                 '[data-testid="req-send-btn"]',
  STATUS_PILL:              '[data-testid="req-status-pill"]',
  RESPONSE_TIME:            '[data-testid="req-response-time"]',
  RESPONSE_SIZE:            '[data-testid="req-response-size"]',
  NAME_DISPLAY:             '[data-testid="req-name-display"]',
  ENV_BAR:                  '[data-testid="req-env-bar"]',
  ENV_PILL:                 '[data-testid="req-env-pill"]',
  envPillByName: (name: string) => `[data-testid="req-env-pill"][data-env-name="${name}"]`,
  RESOLVED_URL:             '[data-testid="req-resolved-url"]',
  SEND_HARNESS_BTN:         '[data-testid="req-send-harness-btn"]',
  ACTION_MENU_BTN:          '[data-testid="req-action-menu-btn"]',

  // ── Request Tabs (left pane) ──────────────────────────────────
  TAB_PARAMS:               '[data-testid="req-tab-params"]',
  TAB_BODY:                 '[data-testid="req-tab-body"]',
  TAB_AUTH:                 '[data-testid="req-tab-auth"]',
  TAB_HEADERS:              '[data-testid="req-tab-headers"]',
  TAB_HISTORY:              '[data-testid="req-tab-definition-history"]',

  // ── Body Editor ─────────────────────────────────────────────────
  BODY_EDITOR:              '[data-testid="req-body-editor"]',
  BODY_TYPE_TRIGGER:        '[data-testid="req-body-type-trigger"]',
  BODY_TYPE_DROPDOWN:       '[data-testid="req-body-type-dropdown"]',

  // ── Auth Editor ─────────────────────────────────────────────────
  AUTH_EDITOR:              '[data-testid="req-auth-editor"]',
  AUTH_TYPE_SELECT:          '[data-testid="req-auth-type-select"]',
  AUTH_BEARER_FIELDS:       '[data-testid="req-auth-bearer-fields"]',
  AUTH_PREFIX_INPUT:         '[data-testid="req-auth-prefix-input"]',
  AUTH_TOKEN_INPUT:          '[data-testid="req-auth-token-input"]',

  // ── Action Menu & cURL ──────────────────────────────────────────
  ACTION_DROPDOWN:          '[data-testid="req-action-dropdown"]',
  CURL_IMPORT_BTN:          '[data-testid="req-curl-import-btn"]',
  CURL_EXPORT_BTN:          '[data-testid="req-curl-export-btn"]',
  CURL_IMPORT_PANEL:        '[data-testid="req-curl-import-panel"]',
  CURL_EXPORT_PANEL:        '[data-testid="req-curl-export-panel"]',
  CURL_TEXTAREA:            '[data-testid="req-curl-textarea"]',
  CURL_EXPORT_TEXTAREA:     '[data-testid="req-curl-export-textarea"]',
  CURL_APPLY_BTN:           '[data-testid="req-curl-apply-btn"]',

  // ── Response Tabs (right pane) ────────────────────────────────
  RESP_TAB_PREVIEW:         '[data-testid="req-resp-tab-preview"]',
  RESP_TAB_HEADERS:         '[data-testid="req-resp-tab-headers"]',
  RESP_TAB_CONSOLE:         '[data-testid="req-resp-tab-console"]',

  // ── Response Body ─────────────────────────────────────────────
  RESP_CONTENT:             '[data-testid="req-resp-content"]',
  JSON_PREVIEW:             '[data-testid="req-json-preview"]',
  CANCELLED_PREVIEW:        '[data-testid="req-cancelled-preview"]',
  RESP_SEARCH_INPUT:        '.req-resp-search-input',
  RESP_SEARCH_COUNT:        '[data-testid="req-resp-search-count"]',
  RESP_EXPAND_ALL:          '[data-testid="req-resp-expand-all"]',
  RESP_COLLAPSE_ALL:        '[data-testid="req-resp-collapse-all"]',
  RESP_PLACEHOLDER:         '[data-testid="req-resp-placeholder"]',
  RESP_LOADING:             '[data-testid="req-resp-loading"]',
  SENDING_OVERLAY:          '[data-testid="req-sending-overlay"]',
  SENDING_LABEL:            '[data-testid="req-sending-label"]',
  SENDING_ELAPSED:          '[data-testid="req-sending-elapsed"]',
  SENDING_CANCEL:           '[data-testid="req-sending-cancel"]',

  // ── Console & History ─────────────────────────────────────────
  CONSOLE_LOG:              '[data-testid="req-console-log"]',
  HISTORY_TRIGGER:          '[data-testid="req-resp-history-trigger"]',
  HISTORY_DROPDOWN:         '[data-testid="req-resp-history-dropdown"]',
  HISTORY_ENTRY:            '[data-testid="req-resp-history-entry"]',

  // ── Collection Modal ──────────────────────────────────────────
  COLLECTION_MODAL:         '[data-testid="req-collection-modal"]',
  SVC_SELECT:               '[data-testid="req-svc-select"]',
  BASE_URL_MAP:             '[data-testid="req-base-url-map"]',
  BASE_URL_INPUT:           '[data-testid="req-base-url-input"]',

  // ── Send to Harness Modal ─────────────────────────────────────
  HARNESS_MODAL:            '[data-testid="req-send-harness-modal"]',
  BATCH_HARNESS_MODAL:      '[data-testid="req-batch-harness-modal"]',
  HARNESS_BADGE:            '[data-testid="req-in-harness-badge"]',
  HARNESS_NEXT_BTN:         '[data-testid="send-harness-next"]',
  HARNESS_CONFIRM_BTN:      '[data-testid="send-harness-confirm"]',
  HARNESS_CANCEL_BTN:       '[data-testid="send-harness-cancel"]',
  HARNESS_CASCADE_ENV:      '[data-testid="send-harness-cascade-environment"]',
  HARNESS_CASCADE_SVC:      '[data-testid="send-harness-cascade-microservice"]',
  HARNESS_CASCADE_GROUP:    '[data-testid="send-harness-cascade-feature-group"]',
  HARNESS_CASCADE_SCENARIO: '[data-testid="send-harness-cascade-test-scenario"]',

  // ── Version History ───────────────────────────────────────────
  VERSION_PANEL:            '[data-testid="version-history-panel"]',
  VERSION_ITEM:             '[data-testid="version-item"]',
  VERSION_COMPARE_BTN:      '[data-testid="version-compare-btn"]',
  VERSION_VIEW_BTN:         '[data-testid="version-view-btn"]',
  VERSION_RESTORE_BTN:      '[data-testid="version-restore-btn"]',
  VERSION_RENAME_BTN:       '[data-testid="version-rename-btn"]',
  VERSION_RENAME_INPUT:     '[data-testid="version-rename-input"]',
} as const;
