// The plain, complete instructions for choosing this PC's backup folder. Shown in the one-time banner and in
// Admin > Data Care > Backup. The browser itself opens the folder window, so the steps name every click.
export const BACKUP_FOLDER_NAME = 'BSM-Backup'
export const BACKUP_FOLDER_PATH = 'C:\\BSM-Backup'

function BackupFolderSteps({ renew = false }) {
  if (renew) {
    return (
      <ol className="list-decimal space-y-1 pl-5 text-xs text-neutral-300">
        <li>Press <b className="font-medium text-app-text">Allow</b>.</li>
        <li>The browser asks whether this site may edit files in the folder. Press <b className="font-medium text-app-text">Allow on every visit</b> if you see it, or <b className="font-medium text-app-text">Edit files</b>. That is all.</li>
      </ol>
    )
  }
  return (
    <ol className="list-decimal space-y-1 pl-5 text-xs text-neutral-300">
      <li>Press <b className="font-medium text-app-text">Choose folder</b>. A window opens.</li>
      <li>In that window click <b className="font-medium text-app-text">This PC</b>, then <b className="font-medium text-app-text">Local Disk (C:)</b>, then the folder <b className="font-medium text-app-text">{BACKUP_FOLDER_NAME}</b>. If it is not there yet, press <b className="font-medium text-app-text">New folder</b> and name it exactly <b className="font-medium text-app-text">{BACKUP_FOLDER_NAME}</b> (the full path is <span className="font-mono text-app-text">{BACKUP_FOLDER_PATH}</span>).</li>
      <li>With that folder selected, press <b className="font-medium text-app-text">Select Folder</b>.</li>
      <li>The browser asks whether this site may edit files in it. Press <b className="font-medium text-app-text">Edit files</b> (or <b className="font-medium text-app-text">Allow on every visit</b> if you see it).</li>
    </ol>
  )
}

export function BackupFolderNote() {
  return (
    <p className="text-[11px] text-neutral-500">
      After that nothing else is needed: while the app is open the PC saves a backup file here once a day, by itself, only when you are not working, and keeps the last 45 days. Please do not delete, move or rename this folder. Every PC uses the same folder name.
    </p>
  )
}

export default BackupFolderSteps
