/** Settings contract shared by the Host plugin and its browser configuration card. */

export const REFERENCE_LIBRARY_SETTINGS_NAMESPACE = 'reference-library'

/** User-editable reference-library values exposed through DSH Settings. */
export interface ReferenceLibrarySettings {
  libraryRoot?: string
  pinterestDefaultQuery?: string
  pinterestResultLimit?: number
  zlibraryDomain?: string
  zlibraryDefaultQuery?: string
  zlibraryRequestTimeoutMs?: number
  zlibraryResultLimit?: number
}
